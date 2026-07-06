#!/usr/bin/env bash
# boon-strip-unused-channels.sh
#
# Remove unused upstream channel plugins from the boon fork.
#
# We only ship @openclaw/slack, @openclaw/msteams, and anychat-googlechat to
# the fleet (AMI/host provisioning does `openclaw plugins install @openclaw/...`;
# the fork's checked-in `extensions/<chan>/` dirs are for repo builds/tests
# only). Every other channel plugin is dead weight: upstream churns thousands
# of commits/qtr against them, which we merge for zero benefit.
#
# This script deletes those channel dirs plus every place that references them
# (vitest configs, test-plan cost tables, proxy-capture coverage entries,
# compat registry entries, plugin-sdk facades, package.json publish exclusions,
# workspace globs, tsconfig path maps, CI labeler+codeql globs, external
# channel catalog, opengrep security allow-lists). Idempotent — safe to rerun
# after `git merge upstream/main` reintroduces the files.
#
# Usage:
#   scripts/boon-strip-unused-channels.sh                # apply
#   scripts/boon-strip-unused-channels.sh --dry-run      # list what would change
#   scripts/boon-strip-unused-channels.sh --check        # exit 1 if anything to strip
#
# CI wires the --check mode into a job that fails on any upstream sync PR that
# reintroduces stripped channels. The merger reruns this script without --check
# and includes the resulting diff in the merge commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
CHECK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --check)   CHECK=1 ;;
    -h|--help)
      sed -n '2,27p' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Channels we drop from the fork. Ordered alphabetically. Everything else in
# extensions/ (providers, media, sentry-monitor, and the QA test-infra plugins
# qa-channel/qa-lab/qa-matrix) is preserved.
REMOVED_CHANNELS=(
  clickclack
  discord
  feishu
  imessage
  irc
  line
  matrix
  mattermost
  nextcloud-talk
  nostr
  qqbot
  raft
  signal
  sms
  synology-chat
  telegram
  tlon
  twitch
  whatsapp
  zalo
  zalouser
)

# Channels we keep — used at runtime by the boon fleet.
KEPT_CHANNELS=(slack msteams googlechat)

# Additional per-channel plugin-sdk facade files (one .ts + optional .test.ts)
# to remove alongside each channel dir. Upstream regenerates these; we prune.
REMOVED_PLUGIN_SDK_STEMS=(
  discord
  feishu-security
  matrix
  matrix-deps
  mattermost
  synology-chat
  telegram-account
  telegram-command-config
  telegram-command-ui
  zalouser
)

# Vitest per-channel configs.
REMOVED_VITEST_CONFIGS=(
  test/vitest/vitest.extension-clickclack.config.ts
  test/vitest/vitest.extension-discord.config.ts
  test/vitest/vitest.extension-feishu.config.ts
  test/vitest/vitest.extension-imessage.config.ts
  test/vitest/vitest.extension-irc.config.ts
  test/vitest/vitest.extension-line.config.ts
  test/vitest/vitest.extension-matrix.config.ts
  test/vitest/vitest.extension-mattermost.config.ts
  test/vitest/vitest.extension-signal.config.ts
  test/vitest/vitest.extension-telegram.config.ts
  test/vitest/vitest.extension-whatsapp.config.ts
  test/vitest/vitest.extension-zalo.config.ts
)

# Vitest per-channel path helpers.
REMOVED_VITEST_PATHS=(
  test/vitest/vitest.extension-feishu-paths.mjs
  test/vitest/vitest.extension-irc-paths.mjs
  test/vitest/vitest.extension-matrix-paths.mjs
  test/vitest/vitest.extension-mattermost-paths.mjs
  test/vitest/vitest.extension-telegram-paths.mjs
  test/vitest/vitest.extension-whatsapp-paths.mjs
  test/vitest/vitest.extension-zalo-paths.mjs
)

# Docs to remove for each channel.
REMOVED_DOCS_STEMS=("${REMOVED_CHANNELS[@]}")

pending=0
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

log()   { printf '  %s\n' "$1"; }
would() { if [ "$DRY_RUN" -eq 1 ]; then log "would $1"; else log "$1"; fi; }

apply_or_skip() {
  if [ "$DRY_RUN" -eq 1 ] || [ "$CHECK" -eq 1 ]; then
    return 1
  fi
  return 0
}

remove_path() {
  local p="$1"
  [ -e "$p" ] || [ -L "$p" ] || return 0
  pending=1
  would "remove $p"
  apply_or_skip || return 0
  git rm -rf --quiet --ignore-unmatch -- "$p" >/dev/null 2>&1 || rm -rf -- "$p"
}

# Rewrite a file if a Python filter emits different content. Idempotent.
rewrite_python() {
  local file="$1"
  local pyscript="$2"
  [ -f "$file" ] || return 0
  local out="$tmpdir/rewrite.$$"
  REMOVED="${REMOVED_CHANNELS[*]}" python3 -c "$pyscript" "$file" > "$out"
  if ! cmp -s "$file" "$out"; then
    pending=1
    would "patch $file"
    apply_or_skip || return 0
    cat "$out" > "$file"
  fi
}

echo "==> Removing channel extension dirs"
for ch in "${REMOVED_CHANNELS[@]}"; do
  remove_path "extensions/$ch"
done

echo "==> Removing plugin-sdk facade files"
for stem in "${REMOVED_PLUGIN_SDK_STEMS[@]}"; do
  remove_path "src/plugin-sdk/$stem.ts"
  remove_path "src/plugin-sdk/$stem.test.ts"
done

echo "==> Removing per-channel vitest configs"
for f in "${REMOVED_VITEST_CONFIGS[@]}"; do
  remove_path "$f"
done

echo "==> Removing per-channel vitest path helpers"
for f in "${REMOVED_VITEST_PATHS[@]}"; do
  remove_path "$f"
done

echo "==> Removing per-channel docs"
for stem in "${REMOVED_DOCS_STEMS[@]}"; do
  remove_path "docs/channels/$stem.md"
done

echo "==> Purging package.json publish exclusions"
rewrite_python package.json '
import json, os, re, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
out = []
for line in lines:
    m = re.match(r"^(\s*)\"!dist/extensions/([a-z0-9-]+)/\*\*\"(,?)\s*$", line)
    if m and m.group(2) in removed:
        continue
    out.append(line)
sys.stdout.write("".join(out))
'

echo "==> Purging pnpm workspace overrides for removed-channel-only deps"
# No structural change needed — overrides are dep-scoped, not channel-scoped.

echo "==> Purging tsconfig.package-boundary.paths.json"
rewrite_python extensions/tsconfig.package-boundary.paths.json '
import json, os, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
paths = data.get("compilerOptions", {}).get("paths", {})
new_paths = {
    k: v for k, v in paths.items()
    if not any(f"@openclaw/{ch}/" in k or k == f"@openclaw/{ch}" or f"extensions/{ch}/" in " ".join(v) for ch in removed)
}
data["compilerOptions"]["paths"] = new_paths
sys.stdout.write(json.dumps(data, indent=2) + "\n")
'

echo "==> Purging scripts/lib/official-external-channel-catalog.json"
rewrite_python scripts/lib/official-external-channel-catalog.json '
import json, os, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
data["entries"] = [
    e for e in data.get("entries", [])
    if e.get("name") not in {f"@openclaw/{ch}" for ch in removed}
]
sys.stdout.write(json.dumps(data, indent=2) + "\n")
'

echo "==> Purging .github/labeler.yml"
rewrite_python .github/labeler.yml '
import os, re, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    text = f.read()
# Drop top-level blocks whose header names any removed channel.
def keep_block(block: str) -> bool:
    header = block.split("\n", 1)[0]
    for ch in removed:
        if header.startswith(f"\"channel: {ch}\"") or header.startswith(f"channel: {ch}"):
            return False
        if header.startswith(f"\"plugin: {ch}\"") or header.startswith(f"plugin: {ch}"):
            return False
    return True
# Blocks are separated by lines that start at column 0 without leading whitespace.
lines = text.splitlines(keepends=True)
blocks, current = [], []
for line in lines:
    if line and not line[0].isspace() and current:
        blocks.append("".join(current)); current = [line]
    else:
        current.append(line)
if current:
    blocks.append("".join(current))
sys.stdout.write("".join(b for b in blocks if keep_block(b)))
'

echo "==> Purging codeql channel path lists"
for yml in \
    .github/codeql/codeql-channel-runtime-boundary-critical-quality.yml \
    .github/codeql/codeql-network-runtime-boundary-critical-quality.yml; do
  rewrite_python "$yml" '
import os, re, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
out = []
for line in lines:
    m = re.match(r"^(\s*-\s+)(extensions/([a-z0-9-]+)/src\S*)\s*$", line)
    if m and m.group(3) in removed:
        continue
    out.append(line)
sys.stdout.write("".join(out))
'
done

echo "==> Purging codeql-critical-quality workflow"
rewrite_python .github/workflows/codeql-critical-quality.yml '
import os, re, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    text = f.read()
# 1) drop `      - "extensions/<ch>/src/**"` push filter lines
new_lines = []
for line in text.splitlines(keepends=True):
    m = re.match(r"^\s+-\s+\"extensions/([a-z0-9-]+)/src/\*\*\"\s*$", line)
    if m and m.group(1) in removed:
        continue
    new_lines.append(line)
text = "".join(new_lines)
# 2) shrink the giant alternation like extensions/discord/src/*|... to keep only survivors
def prune_alt(match):
    body = match.group(0)
    parts = body.split("|")
    kept = []
    for p in parts:
        m = re.match(r"extensions/([a-z0-9-]+)/src", p)
        if m and m.group(1) in removed:
            continue
        kept.append(p)
    return "|".join(kept)
text = re.sub(r"(extensions/[a-z0-9-]+/src[^\s|)]*(?:\|extensions/[a-z0-9-]+/src[^\s|)]*)+)", prune_alt, text)
sys.stdout.write(text)
'

echo "==> Purging security/opengrep/precise.yml"
rewrite_python security/opengrep/precise.yml '
import os, re, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
out = []
for line in lines:
    m = re.match(r"^(\s*-\s+)extensions/([a-z0-9-]+)/", line)
    if m and m.group(2) in removed:
        continue
    out.append(line)
sys.stdout.write("".join(out))
'

echo "==> Purging scripts/lib/bundled-runtime-sidecar-paths.json"
rewrite_python scripts/lib/bundled-runtime-sidecar-paths.json '
import json, os, sys
removed = set(os.environ["REMOVED"].split())
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
def keep(p):
    for ch in removed:
        if p.startswith(f"dist/extensions/{ch}/"):
            return False
    return True
if isinstance(data, list):
    data = [p for p in data if keep(p)]
else:
    for k, v in list(data.items()):
        if isinstance(v, list):
            data[k] = [p for p in v if keep(p)]
sys.stdout.write(json.dumps(data, indent=2) + "\n")
'

# Final tripwire: report any refs the automated patches missed. If we are in
# --check mode, this is an error. In apply mode, it becomes a punch-list the
# operator handles by hand (the compat registry and proxy-capture coverage
# tables need domain judgement — see docs/boon/strip-unused-channels.md).
echo "==> Scanning for stray references to removed channels"
: > "$tmpdir/stray"
for ch in "${REMOVED_CHANNELS[@]}"; do
  git grep -nE "extensions/${ch}/|@openclaw/${ch}([\"/]|\$)" -- \
      ':(exclude)docs/**' \
      ':(exclude)CHANGELOG.md' \
      ':(exclude)scripts/boon-strip-unused-channels.sh' \
      ':(exclude)docs/boon/**' \
      ':(exclude)appcast.xml' \
      ':(exclude).gitattributes' \
      2>/dev/null | \
    grep -v "test/vitest/vitest.extension-${ch}" >> "$tmpdir/stray" || true
done

# We accept a baseline of stray refs (upstream files that reference removed
# channels but which we haven't hand-purged yet — tracked in the follow-up
# section of docs/boon/strip-unused-channels.md). The `--check` mode fires
# only when the count grows above the baseline, i.e. an upstream merge added
# new references. Applying the strip still reports the current count for
# situational awareness.
BASELINE_FILE="scripts/boon-strip-unused-channels.baseline"
baseline=0
if [ -f "$BASELINE_FILE" ]; then
  baseline=$(cat "$BASELINE_FILE")
fi
current=0
if [ -s "$tmpdir/stray" ]; then
  current=$(wc -l < "$tmpdir/stray")
fi

if [ "$current" -gt 0 ]; then
  echo "  $current stray reference(s) still present (baseline: $baseline)."
  head -20 "$tmpdir/stray" | sed 's/^/    /'
  if [ "$current" -gt 20 ]; then
    echo "    ... ($((current - 20)) more; see docs/boon/strip-unused-channels.md)"
  fi
fi

if [ "$CHECK" -eq 1 ]; then
  # Only the DIRECTORY-level strip must be idempotent; the residual reference
  # count is compared against baseline. `pending` flips on any deletion or
  # automated patch that would run, so CI catches upstream-reintroduced files
  # even before hitting the reference scanner.
  strict_pending=$pending
  if [ "$current" -gt "$baseline" ]; then
    strict_pending=1
    echo "==> New stray refs beyond baseline ($current > $baseline)."
  fi
  if [ "$strict_pending" -eq 1 ]; then
    echo "==> CHECK FAILED: run \`scripts/boon-strip-unused-channels.sh\` to reapply strip."
    echo "    If new stray refs are legitimate follow-up carry-over, update the baseline:"
    echo "    echo $current > $BASELINE_FILE"
    exit 1
  fi
  echo "==> CHECK OK: fork strip is up to date."
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> Dry run complete. Rerun without --dry-run to apply."
  exit 0
fi

echo "==> Done. Kept channels: ${KEPT_CHANNELS[*]}"
echo "    Run \`pnpm install\` + typecheck before committing."
