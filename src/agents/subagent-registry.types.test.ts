import { describe, expect, it } from "vitest";
import type {
  PendingFinalDeliveryPayload,
  SubagentCompletionState,
} from "./subagent-registry.types.js";

describe("subagent registry types carry the recorded audit trace", () => {
  it("SubagentCompletionState accepts resultAuditTrace", () => {
    const completion: SubagentCompletionState = {
      required: true,
      resultText: "done",
      resultAuditTrace: {
        schemaVersion: 1,
        visibleTools: [],
        toolInvocations: [],
        evidence: [],
        confidence: "medium",
        disposition: "completed",
        reason: "no_tools_visible",
      },
    };
    expect(completion.resultAuditTrace?.disposition).toBe("completed");
  });

  it("PendingFinalDeliveryPayload accepts frozenAuditTrace", () => {
    const payload: PendingFinalDeliveryPayload = {
      requesterSessionKey: "s1",
      requesterDisplayKey: "s1",
      childSessionKey: "s2",
      childRunId: "r1",
      task: "run takeoff",
      frozenAuditTrace: {
        schemaVersion: 1,
        visibleTools: [],
        toolInvocations: [],
        evidence: [],
        confidence: "medium",
        disposition: "completed",
        reason: "no_tools_visible",
      },
    };
    expect(payload.frozenAuditTrace?.reason).toBe("no_tools_visible");
  });
});
