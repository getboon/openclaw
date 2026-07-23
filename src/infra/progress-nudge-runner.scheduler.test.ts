// Tests progress-nudge scheduling: threshold gating, interval cap, maxNudges cap,
// progress-text sourcing, and timer/subscription cleanup.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyRunTerminalEvent } from "../auto-reply/reply/reply-run-registry.js";
import type { OpenClawConfig } from "../config/config.js";
import type { AgentEventPayload } from "./agent-events.js";
import { startProgressNudgeRunner, type ProgressNudgeDeps } from "./progress-nudge-runner.js";

describe("startProgressNudgeRunner scheduler", () => {
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
    let agentListener: ((evt: AgentEventPayload) => void) | undefined;
    let terminalListener: ((evt: ReplyRunTerminalEvent) => void) | undefined;
    const deps: ProgressNudgeDeps = {
      listActiveSessionKeys: () => active.keys,
      resolveStartedAt: () => startedAt.value,
      resolveThreadId: () => "thread-1",
      getRunPhase: () => phase.value,
      subscribeAgentEvents: (l) => {
        agentListener = l;
        return () => {
          agentListener = undefined;
        };
      },
      subscribeTerminal: (l) => {
        terminalListener = l;
        return () => {
          terminalListener = undefined;
        };
      },
      resolveDeliveryTarget:
        resolveDeliveryTarget as unknown as ProgressNudgeDeps["resolveDeliveryTarget"],
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
      emitAgentEvent: (evt: AgentEventPayload) => agentListener?.(evt),
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

  it("does not nudge before the threshold elapses", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });

  it("sends exactly one nudge once the threshold is crossed", async () => {
    const { deps, sendMessage, emitAgentEvent } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    emitAgentEvent({
      runId: "r1",
      seq: 1,
      stream: "tool",
      ts: 0,
      data: { progressText: "your 40 pages" },
      sessionKey: SESSION,
    });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].payloads[0].text).toContain("your 40 pages");
    runner.stop();
  });

  it("respects the interval cap between nudges", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(46_000); // first nudge at ~45s
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000); // < 30s interval → no new nudge
    expect(sendMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000); // now past the interval
    expect(sendMessage).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("caps at maxNudges", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config({ maxNudges: 2 }), deps });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("uses a generic message when no progress text is available", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(sendMessage.mock.calls[0][0].payloads[0].text).toBe("Still working on your request…");
    runner.stop();
  });

  it("stops the timer and stops nudging after stop()", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    runner.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", async () => {
    const { deps, sendMessage } = makeDeps();
    const runner = startProgressNudgeRunner({ cfg: config({ enabled: false }), deps });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });

  it("suppresses a nudge when the run left the running phase (final-reply race)", async () => {
    const { deps, sendMessage, phase } = makeDeps();
    phase.value = "completed";
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });

  it("does not deliver when the target resolves to none", async () => {
    const resolveDeliveryTarget = vi.fn().mockResolvedValue({ channel: "none" });
    const { deps, sendMessage } = makeDeps({
      resolveDeliveryTarget:
        resolveDeliveryTarget as unknown as ProgressNudgeDeps["resolveDeliveryTarget"],
    });
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendMessage).not.toHaveBeenCalled();
    runner.stop();
  });
});
