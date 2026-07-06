# Strip unused channel plugins from the boon fork

## Why

Upstream OpenClaw carries ~24 channel plugins. Our fleet uses **three**:

- `@openclaw/slack`
- `@openclaw/msteams`
- `anychat-googlechat` (from `getboon/anychat`, not from this fork)

The 21 unused channels (`clickclack`, `discord`, `feishu`, `imessage`, `irc`,
`line`, `matrix`, `mattermost`, `nextcloud-talk`, `nostr`, `qqbot`, `raft`,
`signal`, `sms`, `synology-chat`, `telegram`, `tlon`, `twitch`, `whatsapp`,
`zalo`, `zalouser`) never activate at runtime on our fleet:

1. Their manifests declare `"activation": {"onStartup": false}`.
2. The gateway loader (`src/plugins/gateway-startup-plugin-ids.ts`) only starts
   a channel plugin when `configuredChannelIds` names it.
3. The npm publish tarball for `openclaw` excludes every `dist/extensions/<chan>/**`
   in the `files` list (`package.json`), and the fleet AMI installs only
   `@openclaw/slack` and `@openclaw/msteams` via `openclaw plugins install`.

So runtime savings from removal: **zero**. But we pay significant fork tax:

- **~3,600 upstream commits** touched unused channel dirs in the last 90 days.
- Our last upstream sync (5.18 → 6.11) hit **2,756 conflicted files in unused
  channel dirs** vs 537 in the three we ship.
- CI (`scripts/lib/extension-test-plan.mjs`) weights unused channels at ~**8×**
  our used ones combined.
- Dependabot noise (undici/baileys/matrix-sdk-crypto) lands in channels we never
  ship.

## What this PR does

- Deletes each unused-channel `extensions/<chan>/` dir.
- Deletes per-channel vitest configs + path helpers.
- Deletes per-channel plugin-sdk facade files.
- Deletes per-channel doc pages under `docs/channels/`.
- Purges references from:
  - `package.json` (publish exclusions)
  - `extensions/tsconfig.package-boundary.paths.json`
  - `scripts/lib/official-external-channel-catalog.json`
  - `scripts/lib/bundled-runtime-sidecar-paths.json`
  - `.github/labeler.yml`
  - `.github/codeql/codeql-*-runtime-boundary-critical-quality.yml`
  - `.github/workflows/codeql-critical-quality.yml`
  - `security/opengrep/precise.yml`
- Adds `scripts/boon-strip-unused-channels.sh` — the deletions above are
  produced by this script, so the mechanical strip is reproducible.
- Adds `.gitattributes` `merge=ours` entries so upstream reintroductions of the
  channel dirs prefer our deleted side.

## Ongoing maintenance

**After every `git merge upstream/<ref>`, the merger runs the strip script:**

```bash
scripts/boon-strip-unused-channels.sh --check   # exit 1 if strip is stale
scripts/boon-strip-unused-channels.sh           # reapply
```

CI wires `--check` into a required job (see `.github/workflows/`, follow-up).

The `.gitattributes` file uses `merge=ours` for the deleted dirs and doc pages,
so simple `git merge` will not resurrect them. But new *references* to removed
channels (a new `paths` glob in a workflow, a new entry in the catalog JSON,
etc.) will still show up on the modification side, and the strip script
mechanically re-purges those.

## Known incomplete — follow-up PRs

This PR removes the channels **without breaking upstream tests catastrophically**
but leaves ~600 stray references that need surgical follow-up:

| Category                             | Approx. files | Follow-up scope                                                                  |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------- |
| `src/plugins/**/*.test.ts`           | ~60           | Snapshot tests + registry tests that enumerate removed channels                  |
| `src/channels/**/*.test.ts`          | ~10           | Catalog + config validation                                                      |
| `src/plugin-sdk/*.test.ts`           | ~5            | Facade contract tests                                                            |
| `src/proxy-capture/coverage.ts`      | 1             | Static coverage entries for Discord/Telegram/Mattermost/Feishu                   |
| `src/plugins/compat/registry.ts`     | 1             | Deprecation entries for Discord/Telegram/Whatsapp                                |
| `extensions/qa-lab/**`               | ~7            | Live-transport dirs for discord/whatsapp — decide if qa-lab drops those transports |
| `extensions/qa-matrix/**`            | ~3            | e2ee client references matrix protocol semantics                                 |
| `scripts/test-projects.test-support.mjs` | 1         | Static test-project enumeration                                                  |
| `scripts/prepare-extension-package-boundary-artifacts.mjs` | 1 | Discord DTS stamp constants                                                      |
| `scripts/lib/extension-package-boundary.ts` | 1        | `@openclaw/discord/api.js` in path map                                           |
| `scripts/generate-plugin-inventory-doc.mjs` | 1        | Inline docs stamps                                                               |
| `scripts/dev/test-device-pair-telegram.ts` | 1         | Dev-only script — delete outright                                                |
| `scripts/check-session-accessor-boundary.mjs` | 1      | Path allow-list                                                                  |
| `scripts/deadcode-unused-files.allowlist.mjs` | 1      | Path allow-list                                                                  |
| `scripts/e2e/lib/upgrade-survivor/assertions.mjs` | 1  | Upgrade-survivor test data                                                       |
| `.github/workflows/mantis-discord-thread-attachment.yml` | 1 | Discord-only workflow — delete outright                                          |
| `.github/workflows/install-smoke.yml` | 1            | Smoke-test enumeration                                                           |
| `.github/codeql/openclaw-boundary/queries/raw-socket-callsite-classification.ql` | 1 | Allow-list of raw-socket callsites — IRC entry              |
| `qa/scenarios/channels/channel-message-flows.yaml` | 1  | Scenario declarations                                                            |
| `extensions/slack/src/message-sent-hook.ts` + `monitor/replies.ts` | 2 | Slack code references sibling channel constants — needs decoupling |
| `AGENTS.md` + `.agents/skills/...` | 2              | Doc mentions                                                                     |
| `test/**` (release-check, catalog, sidecar, boundary tests) | ~15 | Release-time test data / fixture snapshots                                       |

Estimated follow-up: **3-4 more PRs**, each landing one category, so the fork
never sits build-red for more than the merge window. The primary win from this
PR is (a) the reproducible strip script, (b) the ~28MB / ~3,000-file reduction
in fork surface area, and (c) the merge-driver policy that prevents the dirs
from creeping back in.

## Rollback

`git revert <this-pr-merge-sha>` puts everything back — no state migration.
Fleet is unaffected since none of these channels were installed on any
boon-agent.
