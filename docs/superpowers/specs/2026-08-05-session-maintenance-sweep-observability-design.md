# Session maintenance sweep observability + reliable cadence

## Problem

`session.maintenance` (`mode: "enforce"`, `pruneAfter`, `maxEntries`, `maxDiskBytes`) is
configured fleet-wide but has never visibly pruned a session anywhere it's been checked. The
triggering incident: `openclaw-canary` is in an ~85min heap-OOM crash loop because its
synthetic probe workload (a new Slack channel message, and thus a new thread session, every
5 minutes) grew `sessions.json` to 2079 entries / 47MB with the oldest entry at the host's
entire 13-day lifetime — `maxEntries: 200` never capped it.

### Root cause (verified by direct source read, not inference)

The sweep is not dead code and it does read real operator config
(`src/auto-reply/reply/session.ts:285` resolves `session.maintenance` from live `cfg.session`,
not a default). But `isProtectedSessionMaintenanceEntry()`
(`src/config/sessions/store-maintenance.ts:282-301`) treats any session key matching
`<platform>:group:*` / `<platform>:channel:*`, or carrying a `:thread:` suffix, as a
permanently-protected "durable external conversation" — exempt from age pruning
(`pruneStaleEntries`), count capping (`capEntryCount`), **and** disk-budget eviction
(`enforceSessionDiskBudget`'s last-resort tier, `disk-budget.ts:732`). This is intentional,
documented behavior (commit `de0d484236`, "preserve durable conversation entries", fixes
`#58088`; see `docs/concepts/session.md:127-129`, `docs/reference/session-management-compaction.md:88-91`).

The canary's prober posts a real top-level Slack channel message every cycle, which starts a
real thread. Its session key (`agent:main:slack:channel:<id>:thread:<ts>`) is therefore
indistinguishable from a genuine customer conversation to this heuristic — every one of its
2079 entries is protected, so `pruneStaleEntries`/`capEntryCount` both correctly compute
"0 eligible" on every run, forever. The 5 sampled customer hosts show the identical pattern
because their real traffic is predominantly group/channel/thread conversations too, which,
per the documented contract, is *supposed* to be preserved rather than evicted.

So this is not "enforcement silently fails to run." It runs, reads the right config, and
correctly computes zero effect for a fleet shaped like this. Two real gaps remain:

1. **No visibility.** Every log line in this subsystem (`store-maintenance.ts:200-202,453-455`,
   `disk-budget.ts:622-628,819-829`) only fires when something was actually removed. "Ran and
   found 0 eligible" and "never ran" produce byte-identical (silent) output, which is exactly
   why this ticket needed multi-host log archaeology to root-cause instead of being answerable
   by grepping logs.
2. **Reactive-only cadence.** The sweep only runs as a side effect of
   `commitReplySessionInitialization` (a session write). Low-traffic/idle stores can go long
   stretches without ever being (re-)evaluated, even for the synthetic/DM entries that *are*
   eligible.

### Explicit non-goal

Per user decision, this fix does **not** change what gets protected or evicted. `maxDiskBytes`
remaining unable to evict protected group/channel/thread entries as a last resort is a real
product tension (a "hard" disk ceiling that a protected-heavy fleet can never actually hit),
but changing that is a data-safety policy call for the ticket owner/maintainers, not something
to bake in silently here.

## Design

### 1. Periodic sweep runner (closes the cadence gap, feeds the log)

New module `src/infra/session-maintenance-sweep-runner.ts`, following the existing
`startProgressNudgeRunner`/`startHeartbeatRunner` shape (self-rearming `setTimeout`, injectable
deps for tests, `{ stop, updateConfig }` lifecycle, `unref()`'d timer so it never holds the
process open):

- On a fixed interval (60 minutes; no new config knob — an implementation cadence, not an
  operator-tunable policy), calls the existing, already-tested
  `runSessionsCleanup({ cfg, opts: { allAgents: true, dryRun: false } })`
  (`src/config/sessions/cleanup-service.ts`) once per tick. This is the exact same code path
  `openclaw sessions cleanup --all-agents` already exercises — it resolves every configured
  agent's store via `resolveSessionStoreTargets`, respects each store's real configured
  `mode` (enforce vs. warn), and mutates through `applySessionEntryLifecycleMutation`, which
  wraps writes in `runExclusiveSessionStoreWrite` — the same lock hot-path chat writes use, so
  it cannot race or corrupt concurrent live traffic.
- No new sweep logic is written. Reusing `runSessionsCleanup` means no new prune/cap/disk-budget
  code path to trust — the risk surface is "call an existing, tested function on a timer."
- Guard against overlap the same way `server-maintenance.ts`'s `runMediaCleanup` already does
  (in-flight promise dedupe) so a slow sweep on one tick can't stack with the next.
- Skipped under `minimalTestGateway` / vitest runtime, matching every sibling runner.

### 2. Diagnostic log (closes the visibility gap)

After each tick's `runSessionsCleanup` call resolves, log one `info`-level line per store from
its returned `SessionCleanupSummary` (`agentId`, `storePath`, `mode`, `beforeCount`,
`afterCount`, `pruned`, `capped`, `diskBudget` totals, `wouldMutate`) — **unconditionally**,
including when `wouldMutate` is `false`. This is the one new piece of actual log output, and
it's placed on the periodic path specifically so it doesn't add per-message log volume to the
hot chat write path — one line per store per hour, not one line per inbound message.

Because the runner sweeps every store on a fixed schedule regardless of write traffic, this
also covers high-traffic hosts like canary: the periodic tick will independently confirm "ran,
0 eligible, N/N entries protected" on exactly the cadence needed to distinguish that from
"never ran," without touching the existing reactive write-triggered sweep's logging at all.

### 3. Wiring

`activateGatewayScheduledServices` (`src/gateway/server-runtime-services.ts`) starts/stops the
new runner alongside `heartbeatRunner`/`progressNudgeRunner`, composed into the same returned
handle (mirroring how progress-nudge was folded into the heartbeat handle: start together,
`stop()` together on gateway close, `updateConfig()` together on reload) so no new shutdown/
reload wiring is needed elsewhere.

### 4. Stale doc/JSDoc fix (unrelated one-liner found during investigation)

`src/config/types.base.ts:254` and `src/config/schema.help.ts:1691-1692` both claim the default
`session.maintenance.mode` is `"warn"`. It has been `"enforce"` since commit `6a21962552`;
`docs/gateway/config-agents.md:1277,1313` already say the correct default. Fix the two stale
strings to match.

## Testing

- New unit test for `session-maintenance-sweep-runner.ts` (mirrors
  `progress-nudge-runner.test.ts`'s fake-timer/injectable-deps style): verifies each tick calls
  the cleanup seam with `{ allAgents: true }`, logs a summary every tick including when nothing
  changed, does not overlap a slow tick with the next, and that `stop()`/`updateConfig()` behave
  (mirrors sibling runner tests already covering this shape).
- No changes needed to existing `store.pruning.test.ts` /
  `store.pruning.integration.test.ts` — sweep decision logic (protection, pruning, capping,
  disk budget) is unchanged.

## Out of scope (flagged, not built)

- Making `maxDiskBytes` evict protected entries as a true last resort — real product/data-safety
  call, left for a follow-up decision.
- A separate fleet-wide read-only health-check script (ticket's step 3) — this repo has no
  packer/inventory fleet-monitoring surface today; that likely belongs in an ops/infra repo.
- Canary-prober-specific changes (e.g., using a synthetic session-key shape) — the prober isn't
  in this repo.
