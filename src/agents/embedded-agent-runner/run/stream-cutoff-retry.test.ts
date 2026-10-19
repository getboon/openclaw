import { describe, expect, it } from "vitest";
import {
  MAX_STREAM_CUTOFF_RETRIES,
  recordStreamCutoffRetry,
  shouldRetryCutOffGeneration,
  STREAM_CUTOFF_RETRY_INSTRUCTION,
  streamCutoffRetriesUsed,
} from "./stream-cutoff-retry.js";

type Params = Parameters<typeof shouldRetryCutOffGeneration>[0];

// A long generation cut off mid-stream after the agent already ran tools.
function params(overrides: Partial<Params> = {}): Params {
  return {
    assistant: { stopReason: "error", errorMessage: "Anthropic stream ended before message_stop" },
    attempt: {} as Params["attempt"],
    aborted: false,
    timedOut: false,
    idleTimedOut: false,
    promptError: undefined,
    authFailure: false,
    rateLimitFailure: false,
    billingFailure: false,
    failoverReason: "timeout",
    priorRetries: 0,
    ...overrides,
  };
}

describe("shouldRetryCutOffGeneration", () => {
  it.each([
    "Anthropic stream ended before message_stop",
    "Bedrock stream ended before messageStop",
    "upstream error during stream",
    "Provider completed stream with an incomplete tool call",
    "Anthropic stream ended with an unclosed content block",
    "Bedrock stream ended with an unclosed content block",
    "Proxy stream ended before terminal event",
  ])("retries a generation cut off mid-stream: %j", (errorMessage) => {
    expect(
      shouldRetryCutOffGeneration(params({ assistant: { stopReason: "error", errorMessage } })),
    ).toBe(true);
  });

  it.each(["server_error", "unknown", "unclassified", "no_error_details", null] as const)(
    "retries for transient failover reason %s",
    (failoverReason) => {
      expect(shouldRetryCutOffGeneration(params({ failoverReason }))).toBe(true);
    },
  );

  it("does not retry other errors", () => {
    expect(
      shouldRetryCutOffGeneration(
        params({ assistant: { stopReason: "error", errorMessage: "Invalid API key" } }),
      ),
    ).toBe(false);
  });

  it("does not retry a turn that did not fail", () => {
    expect(
      shouldRetryCutOffGeneration(
        params({ assistant: { stopReason: "stop", errorMessage: undefined } }),
      ),
    ).toBe(false);
  });

  it.each(["rate_limit", "overloaded", "auth", "billing", "edge_blocked", "format"] as const)(
    "does not retry a wrapped %s failure (it keeps its own handling)",
    (failoverReason) => {
      expect(shouldRetryCutOffGeneration(params({ failoverReason }))).toBe(false);
    },
  );

  it("does not retry when auth, rate-limit, or billing classifiers fired", () => {
    expect(shouldRetryCutOffGeneration(params({ authFailure: true }))).toBe(false);
    expect(shouldRetryCutOffGeneration(params({ rateLimitFailure: true }))).toBe(false);
    expect(shouldRetryCutOffGeneration(params({ billingFailure: true }))).toBe(false);
  });

  it("does not retry an aborted, timed-out, or prompt-failed run", () => {
    expect(shouldRetryCutOffGeneration(params({ aborted: true }))).toBe(false);
    expect(shouldRetryCutOffGeneration(params({ timedOut: true }))).toBe(false);
    expect(shouldRetryCutOffGeneration(params({ idleTimedOut: true }))).toBe(false);
    expect(shouldRetryCutOffGeneration(params({ promptError: new Error("x") }))).toBe(false);
  });

  it.each([
    ["a pending client tool call", { clientToolCalls: [{ name: "pick_file" }] }],
    ["a yield", { yieldDetected: true }],
    ["a reply delivered via the message tool", { didDeliverSourceReplyViaMessageTool: true }],
    ["tool media", { toolMediaUrls: ["https://example.com/a.png"] }],
  ])("does not retry when the attempt left terminal evidence: %s", (_label, attempt) => {
    expect(
      shouldRetryCutOffGeneration(params({ attempt: attempt as unknown as Params["attempt"] })),
    ).toBe(false);
  });

  it("allows one autonomous retry per run", () => {
    expect(MAX_STREAM_CUTOFF_RETRIES).toBe(1);
    expect(shouldRetryCutOffGeneration(params({ priorRetries: 0 }))).toBe(true);
    expect(shouldRetryCutOffGeneration(params({ priorRetries: 1 }))).toBe(false);
  });

  it("asks for the cut-off step again in smaller pieces", () => {
    expect(STREAM_CUTOFF_RETRY_INSTRUCTION).toMatch(/smaller/i);
    expect(STREAM_CUTOFF_RETRY_INSTRUCTION).toMatch(/nothing from that step was applied/i);
  });
});

describe("per-run retry budget", () => {
  it("counts retries per runId", () => {
    expect(streamCutoffRetriesUsed("budget-run-a")).toBe(0);
    expect(recordStreamCutoffRetry("budget-run-a")).toBe(1);
    expect(streamCutoffRetriesUsed("budget-run-a")).toBe(1);
    expect(streamCutoffRetriesUsed("budget-run-b")).toBe(0);
  });

  it("stays bounded by dropping the oldest runs", () => {
    recordStreamCutoffRetry("budget-oldest");
    for (let i = 0; i < 1000; i += 1) {
      recordStreamCutoffRetry(`budget-filler-${i}`);
    }
    expect(streamCutoffRetriesUsed("budget-oldest")).toBe(0);
    expect(streamCutoffRetriesUsed("budget-filler-999")).toBe(1);
  });
});
