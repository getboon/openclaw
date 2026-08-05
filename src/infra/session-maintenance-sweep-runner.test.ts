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
