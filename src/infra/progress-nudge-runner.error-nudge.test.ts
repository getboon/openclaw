// Tests the error/stall nudge: fires once for a run that went long then failed,
// never for user-abort or completed runs, and never for a fast failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyRunTerminalEvent } from "../auto-reply/reply/reply-run-registry.js";
import type { OpenClawConfig } from "../config/config.js";
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

  function makeDeps() {
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
      sendMessage: sendMessage as unknown as ProgressNudgeDeps["sendMessage"],
    };
    return {
      deps,
      sendMessage,
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
