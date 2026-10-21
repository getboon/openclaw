/**
 * Unit tests for incomplete-turn.ts's pure continuation-instruction resolvers.
 */
import { describe, expect, it } from "vitest";
import {
  IMPLICIT_YIELD_CONTINUATION_INSTRUCTION,
  resolveImplicitYieldContinuationInstruction,
} from "./incomplete-turn.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

type Attempt = Parameters<typeof resolveImplicitYieldContinuationInstruction>[0]["attempt"];
type AssistantMessage = NonNullable<EmbeddedRunAttemptResult["currentAttemptAssistant"]>;

function stopAssistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
  } as AssistantMessage;
}

function baseAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    assistantTexts: ["Reading title block and notes tiles."],
    currentAttemptAssistant: stopAssistant("Reading title block and notes tiles."),
    yieldDetected: false,
    didSendDeterministicApprovalPrompt: false,
    lastToolError: undefined,
    clientToolCalls: undefined,
    acceptedSessionSpawns: [{ runId: "run-1", childSessionKey: "child-1" }],
    visibleToolNames: ["sessions_spawn", "sessions_yield"],
    didSendViaMessagingTool: false,
    didDeliverSourceReplyViaMessageTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    messagingToolSourceReplyPayloads: undefined,
    ...overrides,
  } as Attempt;
}

const baseParams = {
  aborted: false,
  timedOut: false,
  hasPendingAcceptedSessionSpawn: true,
};

describe("resolveImplicitYieldContinuationInstruction", () => {
  it("forces a yield continuation when the turn narrated over a live, un-yielded sub-agent spawn", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt(),
    });
    expect(result).toBe(IMPLICIT_YIELD_CONTINUATION_INSTRUCTION);
  });

  it("does nothing when sessions_yield was already called this turn", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({ yieldDetected: true }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the spawned child already completed", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      hasPendingAcceptedSessionSpawn: false,
      attempt: baseAttempt(),
    });
    expect(result).toBeNull();
  });

  it("does nothing when sessions_yield is not in the turn's own tool set", () => {
    // Some tool profiles expose sessions_spawn without sessions_yield
    // (docs/tools/subagents.md); forcing the instruction then would give the
    // model an unfollowable command and waste the one-shot retry.
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({ visibleToolNames: ["sessions_spawn"] }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when no sub-agent was spawned this turn", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({ acceptedSessionSpawns: undefined }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the assistant produced no visible text", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({ assistantTexts: [] }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the turn ended mid-tool-use rather than a normal stop", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({
        currentAttemptAssistant: {
          ...stopAssistant("Reading title block and notes tiles."),
          stopReason: "toolUse",
        } as AssistantMessage,
      }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the run was aborted or timed out", () => {
    expect(
      resolveImplicitYieldContinuationInstruction({
        ...baseParams,
        aborted: true,
        attempt: baseAttempt(),
      }),
    ).toBeNull();
    expect(
      resolveImplicitYieldContinuationInstruction({
        ...baseParams,
        timedOut: true,
        attempt: baseAttempt(),
      }),
    ).toBeNull();
  });

  it("does nothing when the turn already delivered a real reply via the messaging tool", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({
        didSendViaMessagingTool: true,
        messagingToolSentTexts: ["Here is the OCR'd title block."],
      }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when committed messaging-tool media delivery exists without didSendViaMessagingTool", () => {
    // hasCommittedMessagingToolDeliveryEvidence is the second half of the
    // hasMessagingToolDeliveryEvidence OR; exercise it independently of
    // didSendViaMessagingTool so a regression in either half is caught.
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({
        messagingToolSentMediaUrls: ["https://example.com/title-block.png"],
      }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the turn ended with a tool error", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({
        lastToolError: { toolName: "sessions_spawn", error: "spawn failed" },
      }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the turn made a client (hosted) tool call", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({
        clientToolCalls: [{ name: "web_search", params: {} }],
      }),
    });
    expect(result).toBeNull();
  });

  it("does nothing when the turn already sent a deterministic approval prompt", () => {
    const result = resolveImplicitYieldContinuationInstruction({
      ...baseParams,
      attempt: baseAttempt({ didSendDeterministicApprovalPrompt: true }),
    });
    expect(result).toBeNull();
  });
});

// Keeps the test's local Attempt alias honest against the real attempt-result
// shape: AssertTrue only type-checks when the extends-check is literally true,
// so a mismatch is a compile error here rather than a silently-widened `never`.
type AssertTrue<T extends true> = T;
type _AssertAttemptIsSubsetOfRunAttemptResult = AssertTrue<
  Attempt extends Partial<EmbeddedRunAttemptResult> ? true : false
>;
