// Tests the error/stall nudge: fires once for a run that went long then failed,
// never for user-abort or completed runs, and never for a fast failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../agents/subagent-registry.js";
import type { SubagentRunRecord } from "../agents/subagent-registry.types.js";
import type { ReplyRunTerminalEvent } from "../auto-reply/reply/reply-run-registry.js";
import { messageOriginCodeCopy } from "../channels/message/message-origin.js";
import type { OpenClawConfig } from "../config/config.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import { startProgressNudgeRunner, type ProgressNudgeDeps } from "./progress-nudge-runner.js";

describe("startProgressNudgeRunner error nudge", () => {
  const SESSION = "agent:main";

  function config(overrides?: Record<string, unknown>): OpenClawConfig {
    return {
      agents: {
        defaults: {
          progressNudge: {
            enabled: true,
            thresholdSeconds: 45,
            intervalSeconds: 30,
            maxNudges: 3,
            target: "last",
            ...overrides,
          },
        },
      },
    } as OpenClawConfig;
  }

  function makeDeps(over?: Partial<ProgressNudgeDeps>) {
    const sendMessage = vi.fn().mockResolvedValue({ status: "sent" });
    const resolveDeliveryTarget = vi.fn().mockResolvedValue({
      channel: "slack",
      to: "C123",
      threadId: "thread-1",
    });
    const startedAt = { value: 0 as number | undefined };
    const active = { keys: [SESSION] };
    const phase = { value: "running" };
    let terminalListener: ((evt: ReplyRunTerminalEvent) => void) | undefined;
    const deps: ProgressNudgeDeps = {
      listActiveSessionKeys: () => active.keys,
      resolveStartedAt: () => startedAt.value,
      resolveThreadId: () => "thread-1",
      getRunPhase: () => phase.value,
      subscribeAgentEvents: () => () => {},
      subscribeTerminal: (l) => {
        terminalListener = l;
        return () => {
          terminalListener = undefined;
        };
      },
      resolveDeliveryTarget:
        resolveDeliveryTarget as unknown as ProgressNudgeDeps["resolveDeliveryTarget"],
      // Not under test here (see progress-nudge-runner.scheduler.test.ts for
      // the edit-support gate); default to "supports edit" so the terminal
      // failure-nudge path is unaffected by it.
      channelSupportsEdit: () => true,
      channelReportsTurnOutcome: () => false,
      countActiveChildRuns: () => 0,
      sendMessage: sendMessage as unknown as ProgressNudgeDeps["sendMessage"],
      ...over,
    };
    return {
      deps,
      sendMessage,
      resolveDeliveryTarget,
      startedAt,
      active,
      phase,
      emitTerminal: (evt: ReplyRunTerminalEvent) => terminalListener?.(evt),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends exactly one error nudge for a run that went long then failed", async () => {
    const { deps, sendMessage, active, emitTerminal } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(46_000); // one "still working" nudge fires
    expect(sendMessage).toHaveBeenCalledTimes(1);
    active.keys = []; // run no longer active
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 0, // ran ~46s → well past threshold
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const errText = sendMessage.mock.calls[1][0].payloads[0].text;
    expect(errText.toLowerCase()).toContain("again");
    // A second terminal for the same (already-cleared) session must not re-nudge.
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("error-nudges a run that crossed the threshold then failed BETWEEN ticks (no nudge sent)", async () => {
    // The run went long (started at 0, fails ~50s in) but failed before any
    // poll tick fired a "still working" nudge — elapsed-based wentLong must still
    // trigger the failure message. Suppress in-turn nudges by keeping the run out
    // of the active list so only the terminal path can send.
    const { deps, sendMessage, active, emitTerminal } = makeDeps();
    active.keys = []; // never appears as active → no "still working" nudge
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sendMessage).not.toHaveBeenCalled();
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 0, // elapsed ~50s ≥ 45s threshold
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // A repeat terminal must NOT re-fire even though wentLong is elapsed-based and
    // no "still working" nudge (nudgeCount) ever ran — the fire-once guard must
    // survive on the kept bookkeeping entry.
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it("does not error-nudge on a user abort", async () => {
    const { deps, sendMessage, active, emitTerminal } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(46_000);
    active.keys = [];
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "aborted_by_user" },
      startedAt: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(1); // only the "still working" nudge
    runner.stop();
  });

  it("does not error-nudge on a completed run", async () => {
    const { deps, sendMessage, active, emitTerminal } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(46_000);
    active.keys = [];
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "completed" },
      startedAt: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it("does not error-nudge when the delivery target is none", async () => {
    const { deps, sendMessage, active, emitTerminal } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config({ target: "none" }), deps });
    await vi.advanceTimersByTimeAsync(46_000);
    active.keys = [];
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 0,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });

  async function emitLongFailure(
    emitTerminal: (evt: ReplyRunTerminalEvent) => void,
    startedAt = 0,
  ): Promise<void> {
    await vi.advanceTimersByTimeAsync(startedAt + 50_000);
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt,
    });
    await vi.advanceTimersByTimeAsync(1000);
  }

  describe("turn outcome ownership", () => {
    it("skips the failure notice on a channel that reports its own turn outcome", async () => {
      const { deps, sendMessage, resolveDeliveryTarget, active, emitTerminal } = makeDeps({
        channelReportsTurnOutcome: ({ channel }) => channel === "slack",
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(resolveDeliveryTarget).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      runner.stop();
    });

    it("still sends the failure notice on a channel that does not report its turn outcome", async () => {
      const { deps, sendMessage, active, emitTerminal } = makeDeps({
        channelReportsTurnOutcome: () => false,
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0].payloads[0].text.toLowerCase()).toContain("again");
      runner.stop();
    });

    it("uses the background copy when sub-agent runs are still live", async () => {
      const countActiveChildRuns = vi.fn(({ sessionKey }: { sessionKey: string }) =>
        sessionKey === SESSION ? 1 : 0,
      );
      const { deps, sendMessage, active, emitTerminal } = makeDeps({
        channelReportsTurnOutcome: () => false,
        countActiveChildRuns,
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal, 2_000);
      expect(countActiveChildRuns).toHaveBeenCalledWith({
        sessionKey: SESSION,
        spawnedSinceMs: 2_000,
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const text = sendMessage.mock.calls[0][0].payloads[0].text;
      expect(text).toBe(messageOriginCodeCopy("subagent_still_working"));
      expect(text).not.toContain("send the request again");
      runner.stop();
    });

    it("keeps the failure copy when no sub-agent runs are live", async () => {
      const { deps, sendMessage, active, emitTerminal } = makeDeps({
        countActiveChildRuns: () => 0,
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0].payloads[0].text).toContain("send the request again");
      runner.stop();
    });

    it("keeps the failure copy when counting sub-agent runs throws", async () => {
      const { deps, sendMessage, active, emitTerminal } = makeDeps({
        countActiveChildRuns: () => {
          throw new Error("registry unavailable");
        },
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0].payloads[0].text).toContain("send the request again");
      runner.stop();
    });

    it("skips on a reporting channel even when sub-agent runs are live", async () => {
      const { deps, sendMessage, active, emitTerminal } = makeDeps({
        channelReportsTurnOutcome: () => true,
        countActiveChildRuns: () => 1,
      });
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).not.toHaveBeenCalled();
      runner.stop();
    });

    it("does not edit the progress anchor into a failure notice on a reporting channel", async () => {
      const sendMessage = vi.fn().mockResolvedValue({
        status: "sent",
        results: [],
        receipt: { primaryPlatformMessageId: "nudge-1" },
      });
      const editMessage = vi.fn().mockResolvedValue(true);
      const { deps, active, emitTerminal } = makeDeps({
        channelReportsTurnOutcome: () => true,
        sendMessage: sendMessage as unknown as ProgressNudgeDeps["sendMessage"],
        editMessage,
      });
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await vi.advanceTimersByTimeAsync(46_000);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      active.keys = [];
      emitTerminal({
        sessionKey: SESSION,
        sessionId: "s1",
        result: { kind: "failed", code: "run_failed" },
        startedAt: 0,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(editMessage).not.toHaveBeenCalled();
      runner.stop();
    });
  });

  describe("turn outcome ownership from the channel plugin registry", () => {
    afterEach(() => {
      resetPluginRuntimeStateForTest();
    });

    function installSlackPlugin(reportsTurnOutcome: boolean | undefined) {
      const plugin = createChannelTestPluginBase({
        id: "slack",
        capabilities: {
          chatTypes: ["direct"],
          ...(reportsTurnOutcome === undefined ? {} : { reportsTurnOutcome }),
        },
      });
      setActivePluginRegistry(createTestRegistry([{ pluginId: "slack", plugin, source: "test" }]));
    }

    function makeRegistryDeps() {
      const fixture = makeDeps();
      delete fixture.deps.channelReportsTurnOutcome;
      fixture.active.keys = [];
      return fixture;
    }

    it("skips the failure notice when the registered plugin declares reportsTurnOutcome", async () => {
      installSlackPlugin(true);
      const { deps, sendMessage, emitTerminal } = makeRegistryDeps();
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).not.toHaveBeenCalled();
      runner.stop();
    });

    it("sends the failure notice when the registered plugin does not declare it", async () => {
      installSlackPlugin(undefined);
      const { deps, sendMessage, emitTerminal } = makeRegistryDeps();
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      runner.stop();
    });
  });

  describe("live sub-agent work from the sub-agent registry", () => {
    const TURN_STARTED_AT = 10_000;

    afterEach(() => {
      resetSubagentRegistryForTests({ persist: false });
    });

    function addChildRun(
      run: Pick<SubagentRunRecord, "runId" | "childSessionKey" | "createdAt"> &
        Partial<SubagentRunRecord>,
    ) {
      addSubagentRunForTests({
        requesterSessionKey: SESSION,
        requesterDisplayKey: "main",
        task: "child task",
        cleanup: "keep",
        startedAt: run.createdAt,
        ...run,
      });
    }

    async function failedTurnText(): Promise<string> {
      const { deps, sendMessage, active, emitTerminal } = makeDeps();
      delete deps.countActiveChildRuns;
      active.keys = [];
      const runner = startProgressNudgeRunner({ cfg: config(), deps });
      await emitLongFailure(emitTerminal, TURN_STARTED_AT);
      runner.stop();
      expect(sendMessage).toHaveBeenCalledTimes(1);
      return sendMessage.mock.calls[0][0].payloads[0].text;
    }

    it("uses the background copy for a live child spawned during the failed turn", async () => {
      addChildRun({
        runId: "run-child",
        childSessionKey: "agent:main:subagent:child",
        createdAt: TURN_STARTED_AT + 5_000,
      });
      expect(await failedTurnText()).toBe(messageOriginCodeCopy("subagent_still_working"));
    });

    it("keeps the failure copy for a live child spawned before the failed turn", async () => {
      addChildRun({
        runId: "run-earlier-child",
        childSessionKey: "agent:main:subagent:earlier",
        createdAt: TURN_STARTED_AT - 5_000,
      });
      expect(await failedTurnText()).toContain("send the request again");
    });

    it("keeps the failure copy for an ended child with no live descendants", async () => {
      addChildRun({
        runId: "run-ended-child",
        childSessionKey: "agent:main:subagent:ended",
        createdAt: TURN_STARTED_AT + 5_000,
        endedAt: TURN_STARTED_AT + 20_000,
      });
      expect(await failedTurnText()).toContain("send the request again");
    });

    it("uses the background copy for an ended child that waits on a live grandchild", async () => {
      addChildRun({
        runId: "run-ended-parent-child",
        childSessionKey: "agent:main:subagent:parent-child",
        createdAt: TURN_STARTED_AT + 5_000,
        endedAt: TURN_STARTED_AT + 20_000,
      });
      addChildRun({
        runId: "run-grandchild",
        childSessionKey: "agent:main:subagent:parent-child:subagent:grandchild",
        requesterSessionKey: "agent:main:subagent:parent-child",
        createdAt: TURN_STARTED_AT + 10_000,
      });
      expect(await failedTurnText()).toBe(messageOriginCodeCopy("subagent_still_working"));
    });
  });

  it("does not error-nudge a fast failure that never went long", async () => {
    const { deps, sendMessage, emitTerminal } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    // Fail before threshold — no "still working" nudge ever fired.
    await vi.advanceTimersByTimeAsync(10_000);
    emitTerminal({
      sessionKey: SESSION,
      sessionId: "s1",
      result: { kind: "failed", code: "run_failed" },
      startedAt: 5_000, // elapsed ~5s < 45s threshold
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });
});
