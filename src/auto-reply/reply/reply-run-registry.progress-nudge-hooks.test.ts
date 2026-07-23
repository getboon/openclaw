// Tests the additive hooks the progress-nudge runner relies on: per-operation
// startedAt, resolveActiveReplyRunStartedAt, and onReplyRunTerminal firing once
// per operation with the final result.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDiagnosticRunActivityForTest } from "../../logging/diagnostic-run-activity.js";
import {
  createReplyOperation,
  onReplyRunTerminal,
  resolveActiveReplyRunStartedAt,
  testing,
  type ReplyRunTerminalEvent,
} from "./reply-run-registry.js";

describe("reply-run-registry progress-nudge hooks", () => {
  afterEach(() => {
    testing.resetReplyRunRegistry();
    resetDiagnosticRunActivityForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stamps startedAt and exposes it via resolveActiveReplyRunStartedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const op = createReplyOperation({
      sessionKey: "agent:main:main",
      sessionId: "s1",
      resetTriggered: false,
    });
    expect(op.startedAt).toBe(1_000);
    expect(resolveActiveReplyRunStartedAt("agent:main:main")).toBe(1_000);
    op.complete();
    // Once cleared, there's no active run for the key.
    expect(resolveActiveReplyRunStartedAt("agent:main:main")).toBeUndefined();
  });

  it("fires a terminal event with the completed result when a run completes", () => {
    const events: ReplyRunTerminalEvent[] = [];
    const off = onReplyRunTerminal((e) => events.push(e));
    const op = createReplyOperation({
      sessionKey: "agent:main:main",
      sessionId: "s1",
      resetTriggered: false,
    });
    op.complete();
    expect(events).toHaveLength(1);
    expect(events[0].sessionKey).toBe("agent:main:main");
    expect(events[0].result).toEqual({ kind: "completed" });
    off();
  });

  it("fires a terminal event with a failed result exactly once", () => {
    const events: ReplyRunTerminalEvent[] = [];
    const off = onReplyRunTerminal((e) => events.push(e));
    const op = createReplyOperation({
      sessionKey: "agent:main:main",
      sessionId: "s1",
      resetTriggered: false,
    });
    op.fail("run_failed");
    // complete() after a fail() should not re-fire (state already cleared).
    op.complete();
    expect(events).toHaveLength(1);
    expect(events[0].result).toMatchObject({ kind: "failed", code: "run_failed" });
    off();
  });

  it("stops delivering terminal events after unsubscribe", () => {
    const events: ReplyRunTerminalEvent[] = [];
    const off = onReplyRunTerminal((e) => events.push(e));
    off();
    const op = createReplyOperation({
      sessionKey: "agent:main:main",
      sessionId: "s1",
      resetTriggered: false,
    });
    op.complete();
    expect(events).toHaveLength(0);
  });

  it("resetReplyRunRegistry clears terminal listeners (no cross-test leak)", () => {
    const events: ReplyRunTerminalEvent[] = [];
    // Subscribe but never unsubscribe — the reset must drop it.
    onReplyRunTerminal((e) => events.push(e));
    testing.resetReplyRunRegistry();
    const op = createReplyOperation({
      sessionKey: "agent:main:main",
      sessionId: "s1",
      resetTriggered: false,
    });
    op.complete();
    expect(events).toHaveLength(0);
  });
});
