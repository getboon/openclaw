// Tests the session-maintenance sweep runner: immediate + periodic ticks,
// dry-run-only cleanup calls, unconditional per-store summary logging (every
// store, every tick), overlap guarding, config refresh on updateConfig(), and
// stop() halting future ticks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCleanupSummary } from "../config/sessions/cleanup-service.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  SESSION_MAINTENANCE_SWEEP_INTERVAL_MS,
  startSessionMaintenanceSweepRunner,
  type SessionMaintenanceSweepDeps,
} from "./session-maintenance-sweep-runner.js";

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

function makeDeps(over?: Partial<SessionMaintenanceSweepDeps>) {
  const info = vi.fn();
  const error = vi.fn();
  const runCleanup = vi.fn().mockResolvedValue({
    mode: "enforce",
    previewResults: [{ summary: summaryFixture() }],
    appliedSummaries: [],
  });
  const deps: SessionMaintenanceSweepDeps = {
    // Cast: the mock resolves a plain literal, not the exact
    // `typeof runSessionsCleanup` return type, so `mode`/etc. widen to
    // `string` under structural checking — matches the existing
    // `as unknown as X["field"]` mock-casting convention used in
    // progress-nudge-runner.scheduler.test.ts.
    runCleanup: runCleanup as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    log: { info, error },
    intervalMs: SESSION_MAINTENANCE_SWEEP_INTERVAL_MS,
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
    // dryRun: true keeps the sweep read-only regardless of the operator's
    // configured session.maintenance.mode — observability, never eviction.
    expect(runCleanup).toHaveBeenCalledWith({ cfg, opts: { allAgents: true, dryRun: true } });
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

  it("logs one summary per previewed store", async () => {
    const { deps, info } = makeDeps({
      runCleanup: vi.fn().mockResolvedValue({
        mode: "enforce",
        previewResults: [
          { summary: summaryFixture({ agentId: "main", storePath: "/a/sessions.json" }) },
          {
            summary: summaryFixture({
              agentId: "second",
              storePath: "/b/sessions.json",
              beforeCount: 7,
              afterCount: 5,
              pruned: 2,
              wouldMutate: true,
            }),
          },
        ],
        appliedSummaries: [],
      }) as unknown as SessionMaintenanceSweepDeps["runCleanup"],
    });
    const runner = startSessionMaintenanceSweepRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(0);
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
      opts: { allAgents: true, dryRun: true },
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
    await vi.advanceTimersByTimeAsync(SESSION_MAINTENANCE_SWEEP_INTERVAL_MS);
    expect(runCleanup).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("constructs with the real cleanup/logger defaults without throwing", () => {
    // No deps: exercises the production wiring (real runSessionsCleanup + subsystem
    // logger). Construction must return a handle synchronously; the immediate tick is
    // async and swallows its own failures, and stop() clears the interval so no real
    // periodic sweep outlives the test.
    let runner: ReturnType<typeof startSessionMaintenanceSweepRunner> | undefined;
    expect(() => {
      runner = startSessionMaintenanceSweepRunner({ cfg: config() });
    }).not.toThrow();
    runner?.stop();
  });
});
