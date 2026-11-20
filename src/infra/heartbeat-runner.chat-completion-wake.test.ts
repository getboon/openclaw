// Covers exec completion wakes for chat sessions that are not the heartbeat session.
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelOutboundAdapter } from "../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { runHeartbeatOnce, startHeartbeatRunner } from "./heartbeat-runner.js";
import { seedSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";
import { computeNextHeartbeatPhaseDueMs, resolveHeartbeatPhaseMs } from "./heartbeat-schedule.js";
import {
  HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT,
  hasPendingHeartbeatWake,
  requestHeartbeat,
  resetHeartbeatWakeStateForTests,
} from "./heartbeat-wake.js";
import {
  consumeSelectedSystemEventEntries,
  drainSystemEventEntries,
  enqueueSystemEvent,
  enqueueSystemEventEntry,
  peekSystemEvents,
  resetSystemEventsForTest,
} from "./system-events.js";

const heartbeatLog = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("../logging/subsystem.js", async () => {
  const actual =
    await vi.importActual<typeof import("../logging/subsystem.js")>("../logging/subsystem.js");
  return {
    ...actual,
    createSubsystemLogger: (subsystem: string) => {
      const logger = actual.createSubsystemLogger(subsystem);
      if (subsystem !== "gateway/heartbeat") {
        return logger;
      }
      return {
        ...logger,
        info: (...args: unknown[]) => heartbeatLog.info(...args),
      };
    },
  };
});

type RunOnce = NonNullable<Parameters<typeof startHeartbeatRunner>[0]["runOnce"]>;
type RunOnceOptions = Parameters<RunOnce>[0];

const TEST_SCHEDULER_SEED = "heartbeat-chat-completion-seed";
const HOUR_MS = 60 * 60_000;
const MAIN_KEY = "agent:main:main";
const DM_KEY = "agent:main:msteams:direct:29:peer-1";
const THREAD_KEY = "agent:main:slack:channel:c1:thread:1.2";
const CRON_KEY = "agent:main:cron:nightly:run:abc";
const KILLED = "Exec failed (abcd1234, signal SIGKILL) :: Killed";
const DONE = "Exec completed (abcd1234, code 0) :: done";
const DEFERRED_LOG = "heartbeat: exec event wake deferred";

function heartbeatConfig(overrides: {
  heartbeat?: Record<string, unknown>;
  session?: Record<string, unknown>;
  channels?: Record<string, unknown>;
}): OpenClawConfig {
  return {
    agents: { defaults: { heartbeat: { every: "1h", ...overrides.heartbeat } } },
    session: {
      store: path.join(os.tmpdir(), "openclaw-chat-completion-wake-missing", "sessions.json"),
      dmScope: "per-channel-peer",
      ...overrides.session,
    },
    ...(overrides.channels ? { channels: overrides.channels } : {}),
  } as OpenClawConfig;
}

function firstIntervalDueMs() {
  return computeNextHeartbeatPhaseDueMs({
    nowMs: 0,
    intervalMs: HOUR_MS,
    phaseMs: resolveHeartbeatPhaseMs({
      schedulerSeed: TEST_SCHEDULER_SEED,
      agentId: "main",
      intervalMs: HOUR_MS,
    }),
  });
}

// Mirrors the real run: a completion turn consumes the queued completions.
function createRunSpy(results: Array<Awaited<ReturnType<RunOnce>>> = []) {
  return vi.fn(async (opts: RunOnceOptions) => {
    const result = results.shift() ?? ({ status: "ran", durationMs: 1 } as const);
    if (opts.sessionKey && result.status === "ran") {
      drainSystemEventEntries(opts.sessionKey);
    }
    return result;
  });
}

function startRunner(runOnce: RunOnce, cfg: OpenClawConfig = heartbeatConfig({})) {
  return startHeartbeatRunner({ cfg, runOnce, stableSchedulerSeed: TEST_SCHEDULER_SEED });
}

async function runIntervalTick() {
  await vi.advanceTimersByTimeAsync(firstIntervalDueMs() - Date.now() + 1);
}

async function wakeExecEvent(sessionKey: string) {
  requestHeartbeat({
    source: "exec-event",
    intent: "event",
    reason: "exec-event",
    sessionKey,
    coalesceMs: 0,
  });
  await vi.advanceTimersByTimeAsync(1);
}

function sessionKeysRun(runSpy: ReturnType<typeof createRunSpy>) {
  return runSpy.mock.calls.map(([opts]) => opts.sessionKey);
}

function deferredLogs() {
  return heartbeatLog.info.mock.calls
    .filter(([message]) => message === DEFERRED_LOG)
    .map(([, meta]) => meta as Record<string, unknown>);
}

describe("startHeartbeatRunner chat command completion wakes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    resetSystemEventsForTest();
    heartbeatLog.info.mockClear();
  });

  afterEach(() => {
    resetHeartbeatWakeStateForTests();
    resetSystemEventsForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { label: "killed", text: KILLED },
    { label: "successful", text: DONE },
  ])("runs a $label DM command completion after a heartbeat already ran", async ({ text }) => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();
    expect(sessionKeysRun(runSpy)).toEqual([undefined]);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    enqueueSystemEvent(text, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);

    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);
    runner.stop();
  });

  it("runs a group thread command completion", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    enqueueSystemEvent(KILLED, { sessionKey: THREAD_KEY });
    await wakeExecEvent(THREAD_KEY);

    expect(sessionKeysRun(runSpy)).toEqual([undefined, THREAD_KEY]);
    runner.stop();
  });

  it.each([
    { label: "the heartbeat session", sessionKey: MAIN_KEY, text: KILLED },
    { label: "a DM without a queued completion", sessionKey: DM_KEY, text: "Node connected" },
    { label: "a cron session", sessionKey: CRON_KEY, text: KILLED },
  ])("drops a not-due completion wake for $label", async ({ sessionKey, text }) => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    enqueueSystemEvent(text, { sessionKey });
    await wakeExecEvent(sessionKey);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(sessionKeysRun(runSpy)).toEqual([undefined]);
    expect(deferredLogs()).toEqual([
      { agentId: "main", sessionKey, reason: "not-due", dropped: true },
    ]);
    runner.stop();
  });

  it.each([
    {
      label: "the isolated heartbeat session",
      sessionKey: `${MAIN_KEY}:heartbeat`,
      resolvedKey: `${MAIN_KEY}:heartbeat`,
      cfg: heartbeatConfig({ heartbeat: { isolatedSession: true } }),
    },
    {
      label: "a heartbeat.session override",
      sessionKey: DM_KEY,
      resolvedKey: DM_KEY,
      cfg: heartbeatConfig({ heartbeat: { session: DM_KEY } }),
    },
    {
      label: "a dmScope main DM that resolves to the main session",
      sessionKey: "agent:main:telegram:work:direct:123",
      resolvedKey: MAIN_KEY,
      cfg: heartbeatConfig({
        session: { dmScope: "main" },
        channels: { telegram: { accounts: { work: { allowFrom: ["123"] } } } },
      }),
    },
    {
      label: "global session scope",
      sessionKey: DM_KEY,
      resolvedKey: "global",
      cfg: heartbeatConfig({ session: { scope: "global" } }),
    },
  ])("keeps the not-due gate for $label", async ({ sessionKey, resolvedKey, cfg }) => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy, cfg);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // The runner checks the queue of the session the wake resolves to.
    enqueueSystemEvent(KILLED, { sessionKey });
    enqueueSystemEvent(KILLED, { sessionKey: resolvedKey });
    await wakeExecEvent(sessionKey);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(sessionKeysRun(runSpy)).toEqual([undefined]);
    runner.stop();
  });

  it("retries a min-spacing deferral once without a hot loop", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();
    const lastRunAt = Date.now();

    await vi.advanceTimersByTimeAsync(10_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(sessionKeysRun(runSpy)).toEqual([undefined]);

    await vi.advanceTimersByTimeAsync(lastRunAt + 30_000 - Date.now() - 1);
    expect(sessionKeysRun(runSpy)).toEqual([undefined]);

    await vi.advanceTimersByTimeAsync(2);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);
    expect(deferredLogs()).toEqual([
      { agentId: "main", sessionKey: DM_KEY, reason: "min-spacing", retryInMs: 20_000 },
    ]);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);
    expect(deferredLogs()).toHaveLength(1);
    runner.stop();
  });

  it("retries a flood deferral when the flood window clears", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    const runStarts: number[] = [];
    for (let i = 0; i < 6; i++) {
      runStarts.push(Date.now());
      requestHeartbeat({
        source: "manual",
        intent: "manual",
        reason: "manual",
        sessionKey: MAIN_KEY,
        coalesceMs: 0,
      });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(runSpy).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(40_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(runSpy).toHaveBeenCalledTimes(6);
    expect(deferredLogs()).toEqual([
      expect.objectContaining({ sessionKey: DM_KEY, reason: "flood" }),
    ]);

    // Five starts stay in the window until the second-oldest start expires.
    await vi.advanceTimersByTimeAsync(runStarts[1] + 60_000 - Date.now());
    expect(runSpy).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(2);
    expect(sessionKeysRun(runSpy).at(-1)).toBe(DM_KEY);
    expect(deferredLogs()).toHaveLength(1);
    runner.stop();
  });

  it("stops retrying once the completion was drained", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(10_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    drainSystemEventEntries(DM_KEY);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sessionKeysRun(runSpy)).toEqual([undefined]);
    expect(deferredLogs().map((entry) => entry.reason)).toEqual(["min-spacing", "not-due"]);
    expect(hasPendingHeartbeatWake()).toBe(false);
    runner.stop();
  });

  it("clears pending completion retries on stop", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(10_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(deferredLogs()).toHaveLength(1);
    runner.stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(hasPendingHeartbeatWake()).toBe(false);
    expect(sessionKeysRun(runSpy)).toEqual([undefined]);
  });

  it("retries a busy completion run without the not-due gate", async () => {
    const runSpy = createRunSpy([
      { status: "ran", durationMs: 1 },
      { status: "skipped", reason: HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT },
    ]);
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY, DM_KEY]);
    expect(deferredLogs()).toEqual([]);
    runner.stop();
  });

  it("drops a busy completion retry after the completion was acknowledged", async () => {
    const runSpy = createRunSpy([
      { status: "ran", durationMs: 1 },
      { status: "skipped", reason: HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT },
    ]);
    const runner = startRunner(runSpy);
    await runIntervalTick();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const completion = enqueueSystemEventEntry(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);

    consumeSelectedSystemEventEntries(DM_KEY, completion ? [completion] : []);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);
    expect(deferredLogs()).toEqual([
      { agentId: "main", sessionKey: DM_KEY, reason: "not-due", dropped: true },
    ]);
    expect(hasPendingHeartbeatWake()).toBe(false);
    runner.stop();
  });

  it("keeps the periodic heartbeat cadence after a completion run", async () => {
    const runSpy = createRunSpy();
    const runner = startRunner(runSpy);
    await runIntervalTick();
    const firstDueMs = firstIntervalDueMs();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    enqueueSystemEvent(KILLED, { sessionKey: DM_KEY });
    await wakeExecEvent(DM_KEY);
    expect(sessionKeysRun(runSpy)).toEqual([undefined, DM_KEY]);

    await vi.advanceTimersByTimeAsync(firstDueMs + HOUR_MS - Date.now() + 1);
    const intervalRuns = runSpy.mock.calls.filter(([opts]) => opts.reason === "interval");
    expect(intervalRuns).toHaveLength(2);
    runner.stop();
  });
});

describe("runHeartbeatOnce chat command completion delivery", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  afterEach(() => {
    resetSystemEventsForTest();
    vi.restoreAllMocks();
  });

  it("relays a killed DM command to the DM route when target is unset", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = vi.fn<NonNullable<ChannelOutboundAdapter["sendText"]>>(async () => ({
        channel: "msteams",
        messageId: "m1",
      }));
      setActivePluginRegistry(
        createTestRegistry([
          {
            pluginId: "msteams",
            plugin: createOutboundTestPlugin({
              id: "msteams",
              outbound: { deliveryMode: "direct", sendText },
            }),
            source: "test",
          },
        ]),
      );
      const cfg = {
        agents: { defaults: { workspace: tmpDir, heartbeat: { every: "1h" } } },
        session: { store: storePath, dmScope: "per-channel-peer" },
      } as OpenClawConfig;
      await seedSessionStore(storePath, DM_KEY, {
        lastChannel: "msteams",
        lastProvider: "msteams",
        lastTo: "user:29:peer-1",
      });
      enqueueSystemEvent(KILLED, {
        sessionKey: DM_KEY,
        deliveryContext: { channel: "msteams", to: "user:29:peer-1" },
      });
      replySpy.mockResolvedValue({ text: "The takeoff job was killed." });

      const result = await runHeartbeatOnce({
        cfg,
        agentId: "main",
        sessionKey: DM_KEY,
        source: "exec-event",
        intent: "event",
        reason: "exec-event",
        deps: { getReplyFromConfig: replySpy },
      });

      expect(result.status).toBe("ran");
      const [ctx] = replySpy.mock.calls[0] ?? [];
      expect(ctx?.Provider).toBe("exec-event");
      expect(ctx?.SessionKey).toBe(DM_KEY);
      expect(ctx?.Body).toContain("An async command you ran earlier has completed");
      expect(ctx?.Body).toContain(KILLED);
      expect(sendText).toHaveBeenCalledTimes(1);
      expect(sendText.mock.calls[0]?.[0]).toMatchObject({
        to: "user:29:peer-1",
        text: "The takeoff job was killed.",
      });
      expect(peekSystemEvents(DM_KEY)).toEqual([]);
    });
  });
});
