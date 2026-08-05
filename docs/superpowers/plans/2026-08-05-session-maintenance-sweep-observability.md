# Session Maintenance Sweep Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Superseded, do not resume verbatim:** Task 1's code blocks below call
> `runCleanup`/`runSessionsCleanup` with `dryRun: false` and read
> `result.appliedSummaries`. A whole-branch review caught that this makes the
> sweep mutate/delete real state (forces the entry cap every tick and deletes
> orphaned artifact files), contradicting this plan's own "zero change to what
> gets protected or evicted" goal. The shipped code uses `dryRun: true` and
> reads `result.previewResults[].summary` instead — see
> `src/infra/session-maintenance-sweep-runner.ts` and the design spec's
> "Explicit non-goal" section for the corrected, actual behavior. Treat this
> plan as historical record of the initial design, not a resumable recipe.

**Goal:** Make `session.maintenance` enforcement observable and reliably-scheduled — without changing what it protects or evicts — by running the existing `openclaw sessions cleanup` sweep on a periodic gateway timer and logging its outcome every tick, even when nothing changed.

**Architecture:** A new self-contained runner module (`src/infra/session-maintenance-sweep-runner.ts`), modeled directly on the existing `startProgressNudgeRunner`/`startHeartbeatRunner` shape (start/stop/updateConfig lifecycle, injectable deps for tests), calls the already-tested `runSessionsCleanup({ allAgents: true })` on a fixed hourly interval plus once immediately on start, and logs an unconditional per-store summary. It is composed into the existing `heartbeatRunner` handle returned by `activateGatewayScheduledServices`, exactly the way `progressNudgeRunner` already is, so no new shutdown/reload wiring is needed anywhere else.

**Tech Stack:** TypeScript (ESM, strict), Vitest with fake timers.

## Global Constraints

- Do not change `isProtectedSessionMaintenanceEntry`, `pruneStaleEntries`, `capEntryCount`, or `enforceSessionDiskBudget` — this fix is observability + cadence only (see `docs/superpowers/specs/2026-08-05-session-maintenance-sweep-observability-design.md`, "Explicit non-goal").
- No new `session.maintenance.*` config key — the sweep interval is a fixed implementation constant, not an operator-tunable value.
- Reuse `runSessionsCleanup` (`src/config/sessions/cleanup-service.ts`) as-is; do not re-implement prune/cap/disk-budget logic in the new runner.
- New runner must be skipped whenever `minimalTestGateway` is true, matching `heartbeatRunner`/`progressNudgeRunner`.
- American spelling; TS strict, no `any`; formatting via `oxfmt` (`pnpm format:fix` if needed), not Prettier.
- Commit via `scripts/committer "<msg>" <file...>`, one message per task.

---

### Task 1: `session-maintenance-sweep-runner` module

**Files:**

- Create: `src/infra/session-maintenance-sweep-runner.ts`
- Test: `src/infra/session-maintenance-sweep-runner.test.ts`

**Interfaces:**

- Consumes: `runSessionsCleanup(params: { cfg: OpenClawConfig; opts: { allAgents?: boolean; dryRun?: boolean } }): Promise<{ mode; previewResults; appliedSummaries: SessionCleanupSummary[] }>` from `../config/sessions/cleanup-service.js`. `SessionCleanupSummary` has fields `agentId: string`, `storePath: string`, `mode: "enforce" | "warn"`, `beforeCount: number`, `afterCount: number`, `pruned: number`, `capped: number`, `diskBudget: { totalBytesBefore; totalBytesAfter; maxBytes; overBudget; ... } | null`, `wouldMutate: boolean`.
- Produces: `startSessionMaintenanceSweepRunner(opts: { cfg: OpenClawConfig; deps?: SessionMaintenanceSweepDeps }): SessionMaintenanceSweepRunner`, where `SessionMaintenanceSweepRunner = { stop: () => void; updateConfig: (cfg: OpenClawConfig) => void }`. Task 2 imports exactly this function and type from `../infra/session-maintenance-sweep-runner.js`.

- [ ] **Step 1: Write the failing test file**

Create `src/infra/session-maintenance-sweep-runner.test.ts`:

```typescript
// Tests the session-maintenance sweep runner: immediate + periodic ticks,
// unconditional per-store summary logging, overlap guarding, config refresh
// on updateConfig(), and stop() halting future ticks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  startSessionMaintenanceSweepRunner,
  type SessionMaintenanceSweepDeps,
} from "./session-maintenance-sweep-runner.js";

function config(): OpenClawConfig {
  return {} as OpenClawConfig;
}

function makeDeps(over?: Partial<SessionMaintenanceSweepDeps>) {
  const info = vi.fn();
  const error = vi.fn();
  const runCleanup = vi.fn().mockResolvedValue({
    mode: "enforce",
    previewResults: [],
    appliedSummaries: [
      {
        agentId: "main",
        storePath: "/agents/main/sessions/sessions.json",
        mode: "enforce",
        dryRun: false,
        beforeCount: 10,
        afterCount: 10,
        missing: 0,
        dmScopeRetired: 0,
        pruned: 0,
        capped: 0,
        unreferencedArtifacts: { scannedFiles: 0, removedFiles: 0, freedBytes: 0, olderThanMs: 0 },
        diskBudget: null,
        wouldMutate: false,
      },
    ],
  });
  const deps: SessionMaintenanceSweepDeps = {
    // Cast: the mock resolves a plain literal, not the exact
    // `typeof runSessionsCleanup` return type, so `mode`/etc. widen to
    // `string` under structural checking — matches the existing
    // `as unknown as X["field"]` mock-casting convention used in
    // progress-nudge-runner.scheduler.test.ts.
    runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    log: { info, error },
    intervalMs: 60 * 60_000,
    ...over,
  };
  return { deps, runCleanup, info, error };
}

describe("startSessionMaintenanceSweepRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sweeps immediately on start and logs a summary even when nothing changed", async () => {
    const { deps, runCleanup, info } = makeDeps();
    const cfg = config();
    const runner = startSessionMaintenanceSweepRunner({ cfg, deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    expect(runCleanup).toHaveBeenCalledWith({ cfg, opts: { allAgents: true, dryRun: false } });
    expect(info).toHaveBeenCalledWith(
      "session maintenance sweep",
      expect.objectContaining({
        agentId: "main",
        storePath: "/agents/main/sessions/sessions.json",
        mode: "enforce",
        beforeCount: 10,
        afterCount: 10,
        pruned: 0,
        capped: 0,
        wouldMutate: false,
      }),
    );
    runner.stop();
  });

  it("sweeps again on each interval tick", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(3);
    runner.stop();
  });

  it("does not overlap a slow tick with the next", async () => {
    let resolveFirst: (() => void) | undefined;
    const runCleanup = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () =>
            resolve({ mode: "enforce", previewResults: [], appliedSummaries: [] });
        }),
    );
    const { deps } = makeDeps({
      runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    // Next interval fires while the first sweep is still in flight.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    // advanceTimersByTimeAsync(0) also flushes the pending microtask queue,
    // letting the in-flight tick's `.finally` clear before the next assert —
    // avoids vi.waitFor, whose default polling uses real timers and does not
    // reliably resolve under vi.useFakeTimers().
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("uses the latest config after updateConfig", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    const nextCfg = { session: { maintenance: { mode: "warn" as const } } } as OpenClawConfig;
    runner.updateConfig(nextCfg);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenLastCalledWith({
      cfg: nextCfg,
      opts: { allAgents: true, dryRun: false },
    });
    runner.stop();
  });

  it("stops ticking after stop()", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(1);
  });

  it("logs an error and recovers on the next tick when a sweep throws", async () => {
    const runCleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ mode: "enforce", previewResults: [], appliedSummaries: [] });
    const { deps, error } = makeDeps({
      runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith("session maintenance sweep failed", {
      error: "boom",
    });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    runner.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-vitest.mjs src/infra/session-maintenance-sweep-runner.test.ts`
Expected: FAIL — `Cannot find module './session-maintenance-sweep-runner.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/infra/session-maintenance-sweep-runner.ts`:

```typescript
// Periodically sweeps every configured agent's session store through the
// same enforce/warn-aware cleanup the `openclaw sessions cleanup` CLI
// already uses, and logs a summary every tick, including when nothing
// changed. session.maintenance today only runs as a side effect of session
// writes (commitReplySessionInitialization), so idle/low-traffic stores can
// go long stretches unevaluated, and every existing prune/cap/disk-budget log
// line only fires on nonzero effect — "ran, 0 eligible" and "never ran" were
// otherwise indistinguishable. This intentionally does not
// change what gets protected or evicted; see
// docs/superpowers/specs/2026-08-05-session-maintenance-sweep-observability-design.md.
import {
  runSessionsCleanup,
  type SessionCleanupSummary,
} from "../config/sessions/cleanup-service.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/session-maintenance-sweep");

/** No new config knob: this is an implementation cadence, not operator policy. */
export const SESSION_MAINTENANCE_SWEEP_INTERVAL_MS = 60 * 60_000;

export type SessionMaintenanceSweepRunner = {
  stop: () => void;
  updateConfig: (cfg: OpenClawConfig) => void;
};

type SessionMaintenanceSweepLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

/** Injectable seams so tests can drive ticks without real session stores or timers. */
export type SessionMaintenanceSweepDeps = {
  runCleanup?: typeof runSessionsCleanup;
  log?: SessionMaintenanceSweepLogger;
  intervalMs?: number;
};

function logSweepSummary(
  logger: SessionMaintenanceSweepLogger,
  summary: SessionCleanupSummary,
): void {
  logger.info("session maintenance sweep", {
    agentId: summary.agentId,
    storePath: summary.storePath,
    mode: summary.mode,
    beforeCount: summary.beforeCount,
    afterCount: summary.afterCount,
    pruned: summary.pruned,
    capped: summary.capped,
    diskBudget: summary.diskBudget
      ? {
          totalBytesBefore: summary.diskBudget.totalBytesBefore,
          totalBytesAfter: summary.diskBudget.totalBytesAfter,
          maxBytes: summary.diskBudget.maxBytes,
          overBudget: summary.diskBudget.overBudget,
        }
      : null,
    wouldMutate: summary.wouldMutate,
  });
}

export function startSessionMaintenanceSweepRunner(opts: {
  cfg: OpenClawConfig;
  deps?: SessionMaintenanceSweepDeps;
}): SessionMaintenanceSweepRunner {
  const runCleanup = opts.deps?.runCleanup ?? runSessionsCleanup;
  const logger = opts.deps?.log ?? log;
  const intervalMs = opts.deps?.intervalMs ?? SESSION_MAINTENANCE_SWEEP_INTERVAL_MS;

  const state = { cfg: opts.cfg, stopped: false };
  let inFlight: Promise<void> | null = null;

  const tick = (): Promise<void> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = (async () => {
      try {
        const result = await runCleanup({
          cfg: state.cfg,
          opts: { allAgents: true, dryRun: false },
        });
        for (const summary of result.appliedSummaries) {
          logSweepSummary(logger, summary);
        }
      } catch (err) {
        logger.error("session maintenance sweep failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const interval = setInterval(() => {
    if (!state.stopped) {
      void tick();
    }
  }, intervalMs);
  interval.unref?.();

  void tick();

  return {
    stop: () => {
      state.stopped = true;
      clearInterval(interval);
    },
    updateConfig: (cfg: OpenClawConfig) => {
      state.cfg = cfg;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-vitest.mjs src/infra/session-maintenance-sweep-runner.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format and commit**

```bash
pnpm format:fix src/infra/session-maintenance-sweep-runner.ts src/infra/session-maintenance-sweep-runner.test.ts
scripts/committer "feat(sessions): add periodic session-maintenance sweep runner with unconditional summary logging" src/infra/session-maintenance-sweep-runner.ts src/infra/session-maintenance-sweep-runner.test.ts
```

---

### Task 2: Wire the runner into gateway scheduled services

**Files:**

- Modify: `src/gateway/server-runtime-services.ts:213-269` (`activateGatewayScheduledServices`)
- Modify: `src/gateway/server-runtime-services.test.ts`

**Interfaces:**

- Consumes: `startSessionMaintenanceSweepRunner` from Task 1 (`../infra/session-maintenance-sweep-runner.js`).
- Produces: no new exports — `activateGatewayScheduledServices`'s existing return shape (`{ heartbeatRunner: HeartbeatRunner; stopModelPricingRefresh: () => void }`) is unchanged; `heartbeatRunner.stop()`/`.updateConfig()` now also delegate to the sweep runner.

- [ ] **Step 1: Extend the existing test to expect the new runner (failing first)**

In `src/gateway/server-runtime-services.test.ts`, add to the hoisted mock block (after the `progressNudgeRunner` entry):

```typescript
const sessionMaintenanceSweepRunner = {
  stop: vi.fn(),
  updateConfig: vi.fn(),
};
```

and to the returned object:

```typescript
    sessionMaintenanceSweepRunner,
    startSessionMaintenanceSweepRunner: vi.fn(() => sessionMaintenanceSweepRunner),
```

Add a new `vi.mock` call alongside the `progress-nudge-runner.js` one:

```typescript
vi.mock("../infra/session-maintenance-sweep-runner.js", () => ({
  startSessionMaintenanceSweepRunner: hoisted.startSessionMaintenanceSweepRunner,
}));
```

In the `beforeEach`, add clears alongside the progress-nudge ones:

```typescript
hoisted.sessionMaintenanceSweepRunner.stop.mockClear();
hoisted.sessionMaintenanceSweepRunner.updateConfig.mockClear();
hoisted.startSessionMaintenanceSweepRunner.mockClear();
```

In `"activates heartbeat, cron, and delivery recovery after sidecars are ready"`, add after the existing progress-nudge assertions:

```typescript
expect(hoisted.startSessionMaintenanceSweepRunner).toHaveBeenCalledTimes(1);
```

and after the existing `services.heartbeatRunner.stop()` / `.updateConfig()` assertions:

```typescript
expect(hoisted.sessionMaintenanceSweepRunner.stop).toHaveBeenCalledTimes(1);
```

```typescript
expect(hoisted.sessionMaintenanceSweepRunner.updateConfig).toHaveBeenCalledTimes(1);
```

In `"keeps scheduled services disabled for minimal test gateways"`, add:

```typescript
expect(hoisted.startSessionMaintenanceSweepRunner).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-vitest.mjs src/gateway/server-runtime-services.test.ts`
Expected: FAIL — `hoisted.startSessionMaintenanceSweepRunner` mock never called (module not wired yet), and the `vi.mock` target doesn't exist as a real module import in the source file yet (mock is harmless but assertions fail).

- [ ] **Step 3: Wire the runner into `activateGatewayScheduledServices`**

In `src/gateway/server-runtime-services.ts`, add the import alongside the existing runner imports:

```typescript
import { startProgressNudgeRunner } from "../infra/progress-nudge-runner.js";
import { startSessionMaintenanceSweepRunner } from "../infra/session-maintenance-sweep-runner.js";
```

Then in `activateGatewayScheduledServices`, replace:

```typescript
const heartbeatRunnerHandle = startHeartbeatRunner({ cfg: params.cfgAtStart });
// The progress-nudge runner is a sibling gateway-scheduled background loop
// with the same lifecycle as the heartbeat runner (start together, stop on
// close, updateConfig on reload). Compose the two into one handle so the
// existing shutdown/reload plumbing drives both without a new state field.
const progressNudgeRunner = startProgressNudgeRunner({ cfg: params.cfgAtStart });
const heartbeatRunner: HeartbeatRunner = {
  stop: () => {
    heartbeatRunnerHandle.stop();
    progressNudgeRunner.stop();
  },
  updateConfig: (cfg) => {
    heartbeatRunnerHandle.updateConfig(cfg);
    progressNudgeRunner.updateConfig(cfg);
  },
};
```

with:

```typescript
const heartbeatRunnerHandle = startHeartbeatRunner({ cfg: params.cfgAtStart });
// The progress-nudge and session-maintenance-sweep runners are sibling
// gateway-scheduled background loops with the same lifecycle as the
// heartbeat runner (start together, stop on close, updateConfig on
// reload). Compose them into one handle so the existing shutdown/reload
// plumbing drives all three without a new state field.
const progressNudgeRunner = startProgressNudgeRunner({ cfg: params.cfgAtStart });
const sessionMaintenanceSweepRunner = startSessionMaintenanceSweepRunner({
  cfg: params.cfgAtStart,
});
const heartbeatRunner: HeartbeatRunner = {
  stop: () => {
    heartbeatRunnerHandle.stop();
    progressNudgeRunner.stop();
    sessionMaintenanceSweepRunner.stop();
  },
  updateConfig: (cfg) => {
    heartbeatRunnerHandle.updateConfig(cfg);
    progressNudgeRunner.updateConfig(cfg);
    sessionMaintenanceSweepRunner.updateConfig(cfg);
  },
};
```

This sits after the existing `if (params.minimalTestGateway) { return ...; }` early return, so the new runner is skipped for minimal test gateways exactly like `heartbeatRunnerHandle`/`progressNudgeRunner` already are — no separate gate needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-vitest.mjs src/gateway/server-runtime-services.test.ts`
Expected: PASS (all cases, including the new/extended assertions).

- [ ] **Step 5: Format and commit**

```bash
pnpm format:fix src/gateway/server-runtime-services.ts src/gateway/server-runtime-services.test.ts
scripts/committer "feat(gateway): schedule the session-maintenance sweep runner alongside heartbeat/progress-nudge" src/gateway/server-runtime-services.ts src/gateway/server-runtime-services.test.ts
```

---

### Task 3: Fix stale `session.maintenance.mode` default documentation

**Files:**

- Modify: `src/config/types.base.ts:254`
- Modify: `src/config/schema.help.ts:1691-1692`

**Interfaces:**

- Consumes: none (doc-only strings).
- Produces: none (no other task depends on this task's output).

Both strings currently claim the default is `"warn"`. It has been `"enforce"` since commit
`6a21962552` ("fix(sessions): enforce maintenance by default and prune on load to prevent
gateway OOM"), and `docs/gateway/config-agents.md:1277,1313` already documents the correct
`"enforce"` default — only these two strings are stale.

- [ ] **Step 1: Fix the JSDoc default in `types.base.ts`**

In `src/config/types.base.ts`, change line 254 from:

```typescript
/** Whether to enforce maintenance or warn only. Default: "warn". */
```

to:

```typescript
/** Whether to enforce maintenance or warn only. Default: "enforce". */
```

- [ ] **Step 2: Fix the CLI help string in `schema.help.ts`**

In `src/config/schema.help.ts`, change (around line 1691-1692) from:

```typescript
  "session.maintenance.mode":
    'Determines whether maintenance policies are only reported ("warn") or actively applied ("enforce"). Keep "warn" during rollout and switch to "enforce" after validating safe thresholds.',
```

to:

```typescript
  "session.maintenance.mode":
    'Determines whether maintenance policies are only reported ("warn") or actively applied ("enforce"). Default: "enforce"; set to "warn" to observe what would be pruned/capped/evicted before trusting it.',
```

- [ ] **Step 3: Run the affected quality test to confirm nothing else asserts the old wording**

Run: `node scripts/run-vitest.mjs src/config/schema.help.quality.test.ts`
Expected: PASS. (No test in this file asserts specific wording for `session.maintenance.mode`;
the closest check, `"covers the target confusing fields with non-trivial explanations"`, only
requires the string to match `/(default|keep|use|enable|disable|controls|selects|sets|defines)/i`,
which the new wording satisfies via "Default".)

- [ ] **Step 4: Commit**

```bash
scripts/committer "docs(sessions): fix stale session.maintenance.mode default docs (enforce, not warn)" src/config/types.base.ts src/config/schema.help.ts
```

---

## Final verification (after all tasks)

- [ ] Run the full touched-surface suite: `node scripts/run-vitest.mjs src/infra/session-maintenance-sweep-runner.test.ts src/gateway/server-runtime-services.test.ts src/config/schema.help.quality.test.ts`
- [ ] Run `pnpm check:changed` (or the Codex-worktree wrapper if this session is in one — see root `AGENTS.md` → Validation) to catch lint/format/type issues across the touched files.
- [ ] Confirm `git diff --numstat` shows only the three intended files plus their tests/docs — no unrelated churn.
- [ ] Run the mandatory pre-land review gate (`superpowers:requesting-code-review` / `$autoreview` per root `AGENTS.md`) before landing.
