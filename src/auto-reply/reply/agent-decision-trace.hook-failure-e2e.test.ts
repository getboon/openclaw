/**
 * End-to-end (durable half): a before_tool_call hook failure on the
 * `message` tool — the shape of the Egan "Thread tangled — tools aren't landing"
 * incident — must carry its real error text all the way from the per-call
 * tool-meta the execution handler records, through normalization and the trace
 * tool-summary, into the AgentDecisionTrace `evidence[].detail` that boon-core
 * persists in agent_chat_messages.metadata.audit_trace.
 *
 * This stitches the three projection modules together (no full runner / no
 * Sentry) so a regression that drops `detail` at any hop is caught in one place.
 */
import { describe, expect, it } from "vitest";
import { buildTraceToolSummary } from "../../agents/embedded-agent-runner/run.js";
import { normalizeToolMetas } from "../../agents/embedded-agent-runner/run/normalize-tool-metas.js";
import { buildAgentDecisionTrace } from "./agent-decision-trace.js";

const HOOK_ERROR = "Error: suggestedReplies.0.kind: must be equal to one of the allowed values";

describe("Durable projection — message-tool hook failure", () => {
  it("carries the real hook-failure error text into the audit trace evidence", () => {
    // As the tool-execution handler records them: the turn did real work, then
    // the message-delivery tool call was blocked by a thrown before_tool_call
    // hook (status:"blocked" + detail), exactly like the Egan incident's
    // exec×N → message(blocked) shape.
    const rawToolMetas = [
      { toolName: "exec", errored: false },
      { toolName: "message", status: "blocked" as const, detail: HOOK_ERROR },
    ];

    const normalized = normalizeToolMetas(rawToolMetas);
    const summary = buildTraceToolSummary({
      toolMetas: normalized,
      visibleToolNames: ["exec", "message"],
      hadFailure: false,
    });
    const trace = buildAgentDecisionTrace({ toolSummary: summary });

    const blocked = trace.evidence.find((entry) => entry.tool === "message");
    expect(blocked).toEqual({
      kind: "tool_outcome",
      tool: "message",
      status: "blocked",
      detail: HOOK_ERROR,
    });
    // The exec call rode through with no stray detail.
    expect(trace.evidence.find((entry) => entry.tool === "exec")).toEqual({
      kind: "tool_outcome",
      tool: "exec",
      status: "ok",
    });
    // A partially-completed turn (one blocked, others ok) is reported as such.
    expect(trace.reason).toBe("tool_execution_partial");
    expect(trace.disposition).toBe("completed");
  });

  it("does not fabricate detail for a plain veto block along the same path", () => {
    const normalized = normalizeToolMetas([{ toolName: "message", status: "blocked" as const }]);
    const summary = buildTraceToolSummary({
      toolMetas: normalized,
      visibleToolNames: ["message"],
      hadFailure: false,
    });
    const trace = buildAgentDecisionTrace({ toolSummary: summary });

    const blocked = trace.evidence.find((entry) => entry.tool === "message");
    expect(blocked).toEqual({ kind: "tool_outcome", tool: "message", status: "blocked" });
    expect(blocked).not.toHaveProperty("detail");
  });
});
