// Tests the session-maintenance sweep runner: immediate + periodic ticks,
// dry-run-only cleanup calls resolved and swept one target at a time,
// unconditional per-store summary logging (every store, every tick), a
// single failing store not hiding the others, live config resolution via
// getConfig(), overlap guarding, config refresh on updateConfig(), and
// stop() halting future ticks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCleanupSummary } from "../config/sessions/cleanup-service.js";
import type { SessionStoreTarget } from "../config/sessions/targets.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  SESSION_MAINTENANCE_SWEEP_INTERVAL_MS,
  startSessionMaintenanceSweepRunner,
  type SessionMaintenanceSweepDeps,
} from "./session-maintenance-sweep-runner.js";

const MAIN_TARGET: SessionStoreTarget = {
  agentId: "main",
  storePath: "/agents/main/sessions/sessions.json",
};

function config(): OpenClawConfig {
  return {} as OpenClawConfig;
}

function summaryFixture(over?: Partial<SessionCleanupSummary>): SessionCleanupSummary {
  return {
    agentId: "main",
    storePath: "/agents/main/sessions/sessions.json",
    mode: "enforce",
    dryRun: true,
    beforeCount: 10,
    afterCount: 10,
    missing: 0,
    dmScopeRetired: 0,
    pruned: 0,
    capped: 0,
    unreferencedArtifacts: { scannedFiles: 4, removedFiles: 0, freedBytes: 0, olderThanMs: 0 },
    diskBudget: null,
    wouldMutate: false,
    ...over,
  };
}

/** Default single-target, single-summary happy path; override either seam per test. */
function makeDeps(over?: Partial<SessionMaintenanceSweepDeps>) {
  const info = vi.fn();
  const error = vi.fn();
  const resolveTargets = vi.fn().mockReturnValue([MAIN_TARGET]);
  const runCleanup = vi.fn().mockResolvedValue({
    mode: "enforce",
    previewResults: [{ summary: summaryFixture() }],
    appliedSummaries: [],
  });
  const deps: SessionMaintenanceSweepDeps = {
    // Cast: the mocks resolve/return plain literals, not the exact
    // `typeof runSessionsCleanup`/`typeof resolveSessionStoreTargets` types,
    // so fields widen under structural checking — matches the existing
    // `as unknown as X["field"]` mock-casting convention used in
    // progress-nudge-runner.scheduler.test.ts.
    runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    resolveTargets: resolveTargets as unknown as SessionMaintenanceSweepDeps["resolveTargets"],
    log: { info, error },
    intervalMs: SESSION_MAINTENANCE_SWEEP_INTERVAL_MS,
    ...over,
  };
  return { deps, runCleanup, resolveTargets, info, error };
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
    // dryRun: true keeps the sweep read-only regardless of the operator's
    // configured session.maintenance.mode — observability, never eviction.
    // One store is resolved via resolveTargets and swept individually.
    expect(runCleanup).toHaveBeenCalledWith({
      cfg,
      opts: { dryRun: true },
      targets: [MAIN_TARGET],
    });
    expect(info).toHaveBeenCalledWith(
      "session maintenance sweep",
      expect.objectContaining({
        agentId: "main",
        storePath: "/agents/main/sessions/sessions.json",
        mode: "enforce",
        dryRun: true,
        beforeCount: 10,
        afterCount: 10,
        pruned: 0,
        capped: 0,
        unreferencedArtifacts: { removedFiles: 0, freedBytes: 0 },
        wouldMutate: false,
      }),
    );
    runner.stop();
  });

  it("logs the previewed artifact-cleanup counts", async () => {
    const { deps, info } = makeDeps({
      runCleanup: vi.fn().mockResolvedValue({
        mode: "enforce",
        previewResults: [
          {
            summary: summaryFixture({
              unreferencedArtifacts: {
                scannedFiles: 12,
                removedFiles: 3,
                freedBytes: 4096,
                olderThanMs: 86_400_000,
              },
              wouldMutate: true,
            }),
          },
        ],
        appliedSummaries: [],
      }) as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(info).toHaveBeenCalledWith(
      "session maintenance sweep",
      expect.objectContaining({
        unreferencedArtifacts: { removedFiles: 3, freedBytes: 4096 },
        wouldMutate: true,
      }),
    );
    runner.stop();
  });

  it("sweeps every resolved store independently and logs one summary each", async () => {
    const targetA: SessionStoreTarget = { agentId: "main", storePath: "/a/sessions.json" };
    const targetB: SessionStoreTarget = { agentId: "second", storePath: "/b/sessions.json" };
    const resolveTargets = vi.fn().mockReturnValue([targetA, targetB]);
    const runCleanup = vi
      .fn()
      .mockImplementation(async (params: { targets: [SessionStoreTarget] }) => {
        const [target] = params.targets;
        const summary =
          target.agentId === "second"
            ? summaryFixture({
                agentId: "second",
                storePath: "/b/sessions.json",
                beforeCount: 7,
                afterCount: 5,
                pruned: 2,
                wouldMutate: true,
              })
            : summaryFixture({ agentId: "main", storePath: "/a/sessions.json" });
        return { mode: "enforce", previewResults: [{ summary }], appliedSummaries: [] };
      });
    const { deps, info } = makeDeps({
      resolveTargets: resolveTargets as unknown as SessionMaintenanceSweepDeps["resolveTargets"],
      runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    // Each resolved store gets its own runCleanup call (isolation, not one
    // allAgents call) — this is what lets one store's failure not hide another's.
    expect(runCleanup).toHaveBeenCalledTimes(2);
    expect(runCleanup).toHaveBeenNthCalledWith(1, {
      cfg: expect.anything(),
      opts: { dryRun: true },
      targets: [targetA],
    });
    expect(runCleanup).toHaveBeenNthCalledWith(2, {
      cfg: expect.anything(),
      opts: { dryRun: true },
      targets: [targetB],
    });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(
      1,
      "session maintenance sweep",
      expect.objectContaining({ agentId: "main", storePath: "/a/sessions.json", pruned: 0 }),
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      "session maintenance sweep",
      expect.objectContaining({
        agentId: "second",
        storePath: "/b/sessions.json",
        beforeCount: 7,
        afterCount: 5,
        pruned: 2,
        wouldMutate: true,
      }),
    );
    runner.stop();
  });

  it("logs the other stores even when one store's sweep fails", async () => {
    const targetA: SessionStoreTarget = { agentId: "broken", storePath: "/broken/sessions.json" };
    const targetB: SessionStoreTarget = { agentId: "healthy", storePath: "/healthy/sessions.json" };
    const resolveTargets = vi.fn().mockReturnValue([targetA, targetB]);
    const runCleanup = vi
      .fn()
      .mockImplementation(async (params: { targets: [SessionStoreTarget] }) => {
        const [target] = params.targets;
        if (target.agentId === "broken") {
          throw new Error("store corrupt");
        }
        return {
          mode: "enforce",
          previewResults: [{ summary: summaryFixture({ agentId: "healthy" }) }],
          appliedSummaries: [],
        };
      });
    const { deps, info, error } = makeDeps({
      resolveTargets: resolveTargets as unknown as SessionMaintenanceSweepDeps["resolveTargets"],
      runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("session maintenance sweep failed for store", {
      agentId: "broken",
      storePath: "/broken/sessions.json",
      error: "store corrupt",
    });
    // The healthy store's summary must still be logged — one bad store cannot
    // hide the fleet-wide observability this runner exists to provide.
    expect(info).toHaveBeenCalledWith(
      "session maintenance sweep",
      expect.objectContaining({ agentId: "healthy" }),
    );
    runner.stop();
  });

  it("logs an error and keeps ticking when target resolution itself fails", async () => {
    const resolveTargets = vi.fn().mockImplementation(() => {
      throw new Error("cannot enumerate agents");
    });
    const { deps, runCleanup, error } = makeDeps({
      resolveTargets: resolveTargets as unknown as SessionMaintenanceSweepDeps["resolveTargets"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("session maintenance sweep failed to resolve stores", {
      error: "cannot enumerate agents",
    });
    runner.stop();
  });

  it("logs an error and keeps ticking when getConfig itself throws", async () => {
    // getConfig() shares the resolveTargets try/catch specifically so a
    // throwing config resolver (e.g. getRuntimeConfig() failing validation in
    // production) can't reject the tick unhandled and silently kill the loop.
    const getConfig = vi.fn().mockImplementation(() => {
      throw new Error("config validation failed");
    });
    const { deps, resolveTargets, runCleanup, error } = makeDeps({ getConfig });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(runCleanup).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("session maintenance sweep failed to resolve stores", {
      error: "config validation failed",
    });
    // Recovers on the next tick once getConfig stops throwing.
    getConfig.mockReturnValue(config());
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it("sweeps again on each interval tick", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
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
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    // advanceTimersByTimeAsync(0) also flushes the pending microtask queue,
    // letting the in-flight tick's `.finally` clear before the next assert —
    // avoids vi.waitFor, whose default polling uses real timers and does not
    // reliably resolve under vi.useFakeTimers().
    await vi.advanceTimersByTimeAsync(0);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("uses the latest config after updateConfig", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    const nextCfg = { session: { maintenance: { mode: "warn" as const } } } as OpenClawConfig;
    runner.updateConfig(nextCfg);
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenLastCalledWith({
      cfg: nextCfg,
      opts: { dryRun: true },
      targets: [MAIN_TARGET],
    });
    runner.stop();
  });

  it("prefers an injected getConfig over the constructor cfg and updateConfig", async () => {
    const constructedCfg = config();
    const liveCfg = { session: { maintenance: { mode: "warn" as const } } } as OpenClawConfig;
    const getConfig = vi.fn().mockReturnValue(liveCfg);
    const { deps, resolveTargets, runCleanup } = makeDeps({ getConfig });
    const runner = startSessionMaintenanceSweepRunner({ cfg: constructedCfg, deps });
    await vi.advanceTimersByTimeAsync(0);
    // session.* config changes never trigger updateConfig() in production (see
    // the runner's getConfig doc) — a real caller wires getConfig to a live
    // read for exactly this reason. Prove that override wins over the cfg the
    // runner was constructed with.
    expect(resolveTargets).toHaveBeenCalledWith(liveCfg, { allAgents: true });
    expect(runCleanup).toHaveBeenCalledWith({
      cfg: liveCfg,
      opts: { dryRun: true },
      targets: [MAIN_TARGET],
    });
    runner.stop();
  });

  it("stops ticking after stop()", async () => {
    const { deps, runCleanup } = makeDeps();
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    await vi.advanceTimersByTimeAsync(3 * SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(1);
  });

  it("logs an error and recovers on the next tick when a store's sweep throws", async () => {
    const runCleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ mode: "enforce", previewResults: [], appliedSummaries: [] });
    const { deps, error } = makeDeps({
      runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith("session maintenance sweep failed for store", {
      agentId: MAIN_TARGET.agentId,
      storePath: MAIN_TARGET.storePath,
      error: "boom",
    });
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("constructs with the real cleanup/logger defaults without throwing", async () => {
    // No deps: exercises the production wiring (real runSessionsCleanup,
    // resolveSessionStoreTargets, and subsystem logger) end-to-end, including
    // its own immediate tick. Construction must return a handle synchronously;
    // awaiting one microtask flush lets that real (dry-run, read-only) tick
    // actually settle before the test ends instead of leaving an un-awaited
    // background operation running past this test's lifetime. stop() then
    // clears the interval so no periodic sweep outlives the test.
    let runner: ReturnType<typeof startSessionMaintenanceSweepRunner> | undefined;
    expect(() => {
      runner = startSessionMaintenanceSweepRunner({ cfg: config() });
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    runner?.stop();
  });
});
