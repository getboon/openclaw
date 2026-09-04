#!/usr/bin/env bash
# obo-e2e-local.sh — local end-to-end check for the gateway-audience OBO
# (ENG-19115/19116/19117): boon-core mints → anychat-boon-web sets
# MsgContext.OboToken → openclaw emits x-boon-gateway-obo-token → boon-llm-gateway
# verifies (fetches the org's signing key from boon-core) → usage is attributed
# internal-test.
#
# Drives one chat turn with boon-cli and asserts each hop from the logs it can
# read. Never prints a token.
#
# Prereqs (all local): boon-core on :3000 (puma + sidekiq consuming
# boon_agent_dispatch), boon-llm-gateway on :8080 with BOON_CORE_URL → :3000,
# openclaw `pnpm dev gateway` on :18789 with the anychat plugin loaded, `boon` on
# PATH, ~/.openclaw/.env holding BOON_API_KEY (+ BOON_CORE_URL).
#
# Usage:
#   OPENCLAW_LOG=/path/to/openclaw-dev.log scripts/boon/obo-e2e-local.sh [org_id]
# Env:
#   BOON_CORE_LOG   boon-core development.log (default: ../boon-clone/packages/boon-core/log/development.log)
#   OPENCLAW_LOG    stdout of `pnpm dev gateway` redirected to a file (optional; enables A3 + wire assertions)
#   ORG_ID          org the turn runs under (default: arg1 or 2)
set -uo pipefail

ORG_ID="${1:-${ORG_ID:-2}}"
BOON_CORE_LOG="${BOON_CORE_LOG:-$HOME/Documents/boon/boon-clone/packages/boon-core/log/development.log}"
OPENCLAW_LOG="${OPENCLAW_LOG:-}"
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
skip() { echo "  SKIP  $1"; }

echo "== preflight"
for p in 3000 8080 18789; do
  ss -ltn 2>/dev/null | grep -q ":$p " && ok "listening :$p" || bad "nothing listening on :$p"
done
command -v boon >/dev/null && ok "boon on PATH" || bad "boon not on PATH"
[ -r "$BOON_CORE_LOG" ] && ok "boon-core log readable" || bad "boon-core log not readable: $BOON_CORE_LOG"
[ -n "$OPENCLAW_LOG" ] && { [ -r "$OPENCLAW_LOG" ] && ok "openclaw log readable" || bad "openclaw log not readable: $OPENCLAW_LOG"; } || skip "OPENCLAW_LOG unset — A3 + wire assertions skipped"
[ "$fail" -eq 0 ] || { echo "preflight failed"; exit 2; }

# A tier-1 verify fetches the org's signing key from boon-core, but the gateway
# caches it (obosign:<org>, 5 min). A fetch inside the last 5 minutes therefore
# also counts as evidence the header arrived on THIS run.
recent_fetch() {
  local since; since=$(date -d '5 minutes ago' '+%Y-%m-%d %H:%M')
  tail -n 20000 "$BOON_CORE_LOG" | grep -E "Started GET \"/api/internal/organizations/${ORG_ID}/openclaw_signing_key" | awk -v s="$since" '{ for (i=1;i<=NF;i++) if ($i ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) { ts=$i" "substr($(i+1),1,5); if (ts >= s) c++ } } END { exit (c>0)?0:1 }'
}

echo "== fire one turn (org $ORG_ID)"
set -a; . "$HOME/.openclaw/.env"; set +a
export BOON_CORE_URL="${BOON_CORE_URL:-http://localhost:3000}"
boff=$(wc -l < "$BOON_CORE_LOG"); ooff=0; [ -n "$OPENCLAW_LOG" ] && ooff=$(wc -l < "$OPENCLAW_LOG")
tid=$(boon agent thread create | jq -r '.thread_id') || { bad "thread create"; exit 2; }
mid=$(boon agent send --thread "$tid" --content "OBO e2e $(date -u +%H:%M:%SZ): reply with the single word PONG" | jq -r '.message_id') || { bad "send"; exit 2; }
reply=$(boon agent poll --thread "$tid" --after "$mid" --timeout 120s 2>/dev/null | jq -r '(.content // .text // .messages[-1].content // "") | tostring' | head -c 40)
[ -n "$reply" ] && ok "turn completed (thread $tid, reply: ${reply})" || bad "no reply within 120s (thread $tid)"

# Snapshot the new log slices to files and grep the files: `tail | grep -q` under
# pipefail dies with SIGPIPE (141) when grep exits on the first match, which reads
# as a failed assertion. Files also mean one tail per log instead of one per check.
snap=$(mktemp -d); trap 'rm -rf "$snap"' EXIT
BC="$snap/boon-core.log"; OCL="$snap/openclaw.log"; : > "$OCL"
resnap() {
  tail -n +$((boff+1)) "$BOON_CORE_LOG" > "$BC"
  [ -n "$OPENCLAW_LOG" ] && tail -n +$((ooff+1)) "$OPENCLAW_LOG" > "$OCL"
}

# Sidekiq (the dispatch job) and the gateway's usage flush write to boon-core's
# log a few seconds after the reply is visible. Wait for the mint line (bounded)
# before asserting so a flush lag doesn't read as a missing hop.
waited=0
for _ in $(seq 1 30); do
  resnap
  grep -qE "add_gateway_obo_token\] minted \+ attached: account=${ORG_ID}" "$BC" && break
  sleep 1; waited=$((waited+1))
done
sleep 2; resnap   # let the gateway's request-log POSTs land too
[ -n "${OBO_E2E_DEBUG:-}" ] && echo "  (debug: boon-core offset=$boff now=$(wc -l < "$BOON_CORE_LOG") waited=${waited}s)"

echo "== assertions"
# A2 boon-core minted + attached
grep -qE "add_gateway_obo_token\] minted \+ attached: account=${ORG_ID} internal_test=true" "$BC" \
  && ok "A2 boon-core minted + attached (account=$ORG_ID internal_test=true)" \
  || bad "A2 no mint line for account=$ORG_ID (sender blank/staff-authored, or signing key missing on BoonAgent::Instance)"

# A3 plugin saw the token on the inbound
if [ -n "$OPENCLAW_LOG" ]; then
  grep -q '"gatewayOboPresent":true' "$OCL" && ok "A3 plugin: gatewayOboPresent:true" || bad "A3 plugin never logged gatewayOboPresent:true (stale dist? plugin < v0.0.38?)"
  # Wire: openclaw attached the header (names-only debug log, requires logging.level=debug)
  if grep -q 'boon usage headers attached:' "$OCL"; then
    grep -qE 'x-boon-gateway-obo-token[^]]*\] obo=present' "$OCL" \
      && ok "WIRE openclaw attached x-boon-gateway-obo-token (obo=present)" \
      || bad "WIRE openclaw built headers WITHOUT the OBO: $(grep -oE 'boon usage headers attached: \[[^]]*\] obo=[a-z]+' "$OCL" | tail -1)"
  else
    skip "WIRE header-names log not seen (openclaw logging.level must be debug, and build must include the attach log)"
  fi
fi

# A4 gateway verified: fetched the org's signing key from boon-core (tier-1 only)
if grep -qE "Started GET \"/api/internal/organizations/${ORG_ID}/openclaw_signing_key" "$BC"; then
  status=$(grep -A8 "organizations/${ORG_ID}/openclaw_signing_key" "$BC" | grep -oE 'Completed [0-9]+' | head -1)
  [ "$status" = "Completed 200" ] \
    && ok "A4 gateway fetched org $ORG_ID signing key from boon-core → 200 (OBO arrived + verified)" \
    || bad "A4 gateway fetched signing key but boon-core answered: ${status:-<no Completed line>}"
elif recent_fetch; then
  skip "A4 inconclusive: org $ORG_ID signing key was fetched <5 min ago and is cached (obosign:$ORG_ID) — rely on WIRE, or rerun after 5 min"
else
  bad "A4 gateway never fetched org $ORG_ID signing key → no OBO header reached it (or gateway OBO verifier not wired)"
fi

# Usage report back to boon-core carries internal_test=true
[ "$(grep -A3 "organizations/${ORG_ID}/llm_request_logs" "$BC" | grep -c '"internal_test"=>true')" -gt 0 ] \
  && ok "A5 gateway → boon-core llm_request_logs internal_test=true" \
  || bad "A5 no llm_request_logs with internal_test=true for org $ORG_ID"

echo "== result: $pass passed, $fail failed"
echo "   (tier-1 vs tier-2 'source' is only on the gateway's own stdout — check it for '[usage] internal-test: customer meter skipped' with a non-getboon_email source)"
[ "$fail" -eq 0 ]
