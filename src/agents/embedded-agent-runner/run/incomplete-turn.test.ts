/**
 * Unit tests for incomplete-turn.ts's pure continuation-instruction resolvers.
 */
import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../../runtime/index.js";
import {
  IMPLICIT_YIELD_CONTINUATION_INSTRUCTION,
  resolveImplicitYieldContinuationInstruction,
} from "./incomplete-turn.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

type Attempt = Parameters<typeof resolveImplicitYieldContinuationInstruction>[0]["attempt"];

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
});

// Keeps the test's local Attempt alias honest against the real attempt-result shape.
type _AssertAttemptIsSubsetOfRunAttemptResult =
  Attempt extends Partial<EmbeddedRunAttemptResult> ? true : never;
