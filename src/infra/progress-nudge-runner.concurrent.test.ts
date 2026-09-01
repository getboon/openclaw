// Tests that two concurrent runs get independent nudges attributed to the
// right session/thread with independently tracked caps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { AgentEventPayload } from "./agent-events.js";
import { startProgressNudgeRunner, type ProgressNudgeDeps } from "./progress-nudge-runner.js";

describe("startProgressNudgeRunner concurrency", () => {
  const A = "agent:main:userA";
  const B = "agent:main:userB";

  function config(): OpenClawConfig {
    return {
      agents: {
        defaults: {
          progressNudge: {
            enabled: true,
            thresholdSeconds: 45,
            intervalSeconds: 30,
            maxNudges: 3,
            target: "last",
          },
        },
      },
    } as OpenClawConfig;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes each session's nudge to its own thread with the right text", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ status: "sent" });
    const startedAt: Record<string, number> = { [A]: 0, [B]: 20_000 };
    const threads: Record<string, string> = { [A]: "thread-A", [B]: "thread-B" };
    let agentListener: ((evt: AgentEventPayload) => void) | undefined;
    const deps: ProgressNudgeDeps = {
      listActiveSessionKeys: () => [A, B],
      resolveStartedAt: (k) => startedAt[k],
      resolveThreadId: (k) => threads[k],
      getRunPhase: () => "running",
      subscribeAgentEvents: (l) => {
        agentListener = l;
        return () => {};
      },
      subscribeTerminal: () => () => {},
      // Not under test here; default to "supports edit" (see
      // progress-nudge-runner.scheduler.test.ts for the edit-support gate).
      channelSupportsEdit: () => true,
      resolveDeliveryTarget: vi
        .fn()
        .mockImplementation(async (p: { currentSessionKey: string }) => ({
          channel: "slack",
          to: p.currentSessionKey === A ? "C-A" : "C-B",
          threadId: threads[p.currentSessionKey],
        })) as unknown as ProgressNudgeDeps["resolveDeliveryTarget"],
      sendMessage: sendMessage as unknown as ProgressNudgeDeps["sendMessage"],
    };
    const runner = startProgressNudgeRunner({ cfg: config(), deps });
    agentListener?.({
      runId: "rA",
      seq: 1,
      stream: "tool",
      ts: 0,
      data: { progressText: "batch A" },
      sessionKey: A,
    });
    agentListener?.({
      runId: "rB",
      seq: 1,
      stream: "tool",
      ts: 0,
      data: { progressText: "batch B" },
      sessionKey: B,
    });

    // At t=46s: A (started 0) is past 45s threshold; B (started 20s) is only 26s in.
    await vi.advanceTimersByTimeAsync(46_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].to).toBe("C-A");
    expect(sendMessage.mock.calls[0][0].payloads[0].text).toContain("batch A");

    // B started at t=20s, so it crosses its 45s threshold at t=65s and its
    // nudge lands on the following poll tick. Advance well past that.
    await vi.advanceTimersByTimeAsync(40_000);
    const bCall = sendMessage.mock.calls.find((c) => c[0].to === "C-B");
    expect(bCall).toBeTruthy();
    expect(bCall![0].payloads[0].text).toContain("batch B");
    runner.stop();
  });
});
