#!/usr/bin/env bats

# Tests for scripts/dependabot/dependabot-digest-message (ENG-22470, ported from boon ENG-22137): builds the one Slack
# thread per week that lists every open Dependabot PR. The weekly post lists
# them all; later posts that week (thread replies) list only PRs that are new
# or have a new head commit, and nothing at all when nothing changed, so the
# channel isn't spammed.

setup() {
  REPO_ROOT="$(git rev-parse --show-toplevel)"
  cd "$REPO_ROOT"
  PRS="$BATS_TEST_TMPDIR/prs.json"
  ANNOUNCED="$BATS_TEST_TMPDIR/announced.txt"
  : > "$ANNOUNCED"
}

# NOW is 2026-11-09T13:00:00Z, so a PR created 2026-11-02T06:00:00Z is 7 days old.
NOW=1794229200

_digest() {
  run scripts/dependabot/dependabot-digest-message --prs "$PRS" --announced "$ANNOUNCED" --mode "${1:-full}" \
    --repo getboon/boon --automerge "${2:-on}" --now "$NOW"
}

# ready: auto-merge on, no approval yet. approved: auto-merge on, approved at head.
# human: auto-merge off (major, Actions bump, or skipped by the rules).
_three_prs() {
  cat > "$PRS" <<'JSON'
[
  {"number": 101, "title": "Bump the npm-minor-patch group", "url": "https://github.com/getboon/boon/pull/101",
   "createdAt": "2026-11-02T06:00:00Z",
   "headRefOid": "aaaaaaa1111111", "autoMergeRequest": {"mergeMethod": "SQUASH"}, "reviews": []},
  {"number": 102, "title": "Bump rack from 3.1.0 to 3.1.2", "url": "https://github.com/getboon/boon/pull/102",
   "createdAt": "2026-11-09T06:00:00Z",
   "headRefOid": "bbbbbbb2222222", "autoMergeRequest": {"mergeMethod": "SQUASH"},
   "reviews": [{"author": {"login": "boon-hermes-bot"}, "state": "APPROVED", "commit": {"oid": "bbbbbbb2222222"}}]},
  {"number": 103, "title": "Bump vite from 7.1.0 to 8.0.0", "url": "https://github.com/getboon/boon/pull/103",
   "createdAt": "2026-10-19T06:00:00Z",
   "headRefOid": "ccccccc3333333", "autoMergeRequest": null, "reviews": []}
]
JSON
}

@test "full mode lists every PR under the right heading" {
  _three_prs
  _digest full
  [ "$status" -eq 0 ]
  [[ "$output" == *"getboon/boon"*"3 open"* ]]
  [[ "$output" == *"Ready for review"*"<https://github.com/getboon/boon/pull/101|#101>"* ]]
  [[ "$output" == *"Approved, waiting for CI"*"#102"* ]]
  [[ "$output" == *"Needs a human"*"#103"* ]]
}

@test "Gandalf the White is tagged once, only for PRs ready for review" {
  _three_prs
  _digest full
  [ "$(grep -o '<@U0C1B6WUGCB>' <<< "$output" | wc -l | tr -d ' ')" = "1" ]
}

@test "no PR ready for review → Gandalf the White is not tagged" {
  echo '[{"number":103,"title":"Bump vite from 7.1.0 to 8.0.0","url":"https://github.com/getboon/boon/pull/103","headRefOid":"ccccccc3333333","autoMergeRequest":null,"reviews":[]}]' > "$PRS"
  _digest full
  [ "$status" -eq 0 ]
  [[ "$output" != *"<@U0C1B6WUGCB>"* ]]
  [[ "$output" == *"#103"* ]]
}

@test "each PR shows its short head commit, the one to review" {
  _three_prs
  _digest full
  [[ "$output" == *"#101"*'`aaaaaaa`'* ]]
}

@test "each PR shows how many days it has been open" {
  _three_prs
  _digest full
  [[ "$output" == *"#101"*"[age=7d]"* ]]
  [[ "$output" == *"#102"*"[age=0d]"* ]]
  [[ "$output" == *"#103"*"[age=21d]"* ]]
}

@test "on-call is tagged once when a PR needs a human, and told to ask CODEOWNERS" {
  _three_prs
  _digest full
  [ "$(grep -o '<!subteam^S0B3DUQHFDY>' <<< "$output" | wc -l | tr -d ' ')" = "1" ]
  [[ "$output" == *"Needs a human"*"<!subteam^S0B3DUQHFDY>"*"CODEOWNERS"*"#103"* ]]
}

@test "no PR needs a human → on-call is not tagged" {
  echo '[{"number":101,"title":"Bump the npm-minor-patch group","url":"https://github.com/getboon/boon/pull/101","createdAt":"2026-11-09T06:00:00Z","headRefOid":"aaaaaaa1111111","autoMergeRequest":{"mergeMethod":"SQUASH"},"reviews":[]}]' > "$PRS"
  _digest full
  [ "$status" -eq 0 ]
  [[ "$output" != *"subteam"* ]]
}

@test "auto-merge switched off → the message says so and every PR goes to on-call" {
  echo '[{"number":101,"title":"Bump the npm-minor-patch group","url":"https://github.com/getboon/boon/pull/101","createdAt":"2026-11-09T06:00:00Z","headRefOid":"aaaaaaa1111111","autoMergeRequest":null,"reviews":[]}]' > "$PRS"
  _digest full off
  [ "$status" -eq 0 ]
  [[ "$output" == *"Auto-merge is off"* ]]
  [[ "$output" == *"Needs a human"*"<!subteam^S0B3DUQHFDY>"*"#101"* ]]
  [[ "$output" != *"<@U0C1B6WUGCB>"* ]]
}

@test "auto-merge off but PRs still queued → the notice says they will still merge" {
  _three_prs
  _digest full off
  [[ "$output" != *"nothing merges by itself"* ]]
  [[ "$output" == *"2 PRs below still have auto-merge queued"* ]]
  [[ "$output" == *"dependabot-auto-merge.yml"* ]]
}

@test "auto-merge off → the notice is in the first post only, not in replies" {
  _three_prs
  printf '%s\n' "101@aaaaaaa1111111" "102@bbbbbbb2222222" > "$ANNOUNCED"
  _digest new off
  [[ "$output" == *"#103"* ]]
  [[ "$output" != *"Auto-merge is off"* ]]
}

@test "auto-merge on → no auto-merge-off notice" {
  _three_prs
  _digest full on
  [[ "$output" != *"Auto-merge is off"* ]]
}

@test "an approval of an older commit does not count as approved" {
  echo '[{"number":104,"title":"Bump pg","url":"https://github.com/getboon/boon/pull/104","headRefOid":"new1234567","autoMergeRequest":{"mergeMethod":"SQUASH"},"reviews":[{"author":{"login":"boon-hermes-bot"},"state":"APPROVED","commit":{"oid":"old1234567"}}]}]' > "$PRS"
  _digest full
  [[ "$output" == *"Ready for review"*"#104"* ]]
  [[ "$output" != *"Approved, waiting for CI"* ]]
}

@test "new mode lists only PRs not announced at their current head" {
  _three_prs
  printf '%s\n' "101@aaaaaaa1111111" "102@bbbbbbb2222222" > "$ANNOUNCED"
  _digest new
  [ "$status" -eq 0 ]
  [[ "$output" == *"#103"* ]]
  [[ "$output" != *"#101"* ]]
  [[ "$output" != *"#102"* ]]
}

@test "new mode re-lists a PR whose head changed (old approval was dismissed)" {
  _three_prs
  printf '%s\n' "101@0000000old" "102@bbbbbbb2222222" "103@ccccccc3333333" > "$ANNOUNCED"
  _digest new
  [[ "$output" == *"#101"* ]]
  [[ "$output" != *"#102"* ]]
}

@test "new mode with nothing new prints nothing (caller posts nothing)" {
  _three_prs
  printf '%s\n' "101@aaaaaaa1111111" "102@bbbbbbb2222222" "103@ccccccc3333333" > "$ANNOUNCED"
  _digest new
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "full mode with no open PRs prints nothing (caller posts nothing)" {
  echo '[]' > "$PRS"
  _digest full
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "Slack control characters in titles are escaped" {
  echo '[{"number":105,"title":"Bump a & <b> > c","url":"https://github.com/getboon/boon/pull/105","headRefOid":"ddddddd4444","autoMergeRequest":null,"reviews":[]}]' > "$PRS"
  _digest full
  [[ "$output" == *"Bump a &amp; &lt;b&gt; &gt; c"* ]]
}

@test "unreadable PR JSON → non-zero exit" {
  echo 'not json' > "$PRS"
  _digest full
  [ "$status" -ne 0 ]
}

@test "bad args → exit 2" {
  run scripts/dependabot/dependabot-digest-message --prs "$PRS" --mode sometimes --repo getboon/boon --announced "$ANNOUNCED"
  [ "$status" -eq 2 ]
  echo '[]' > "$PRS"
  run scripts/dependabot/dependabot-digest-message --prs "$PRS" --mode full --repo getboon/boon --announced "$ANNOUNCED" --now soon
  [ "$status" -eq 2 ]
}
