import { describe, expect, it } from "vitest";
import { attachAgentDecisionTrace, buildAgentDecisionTrace } from "./agent-decision-trace.js";

describe("buildAgentDecisionTrace", () => {
  it("builds a high-confidence completed trace from successful tool evidence", () => {
    expect(
      buildAgentDecisionTrace({
        toolSummary: {
          calls: 1,
          tools: ["buildingconnected_list_projects"],
          failures: 0,
          visibleTools: ["buildingconnected_list_projects"],
          invocations: [{ name: "buildingconnected_list_projects", status: "ok" }],
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      visibleTools: ["buildingconnected_list_projects"],
      toolInvocations: [{ name: "buildingconnected_list_projects", status: "ok" }],
      evidence: [
        {
          kind: "tool_outcome",
          tool: "buildingconnected_list_projects",
          status: "ok",
        },
      ],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    });
  });

  it("omits malformed and oversized tool names without truncating them", () => {
    expect(
      buildAgentDecisionTrace({
        toolSummary: {
          calls: 3,
          tools: [],
          visibleTools: ["mcp__repo__read", "<unsafe>", "x".repeat(121)],
          invocations: [
            { name: "mcp__repo__read", status: "ok" },
            { name: "<unsafe>", status: "error" },
            { name: "x".repeat(121), status: "blocked" },
            { name: "write", status: "unrecognized" as never },
          ],
        },
      }),
    ).toMatchObject({
      visibleTools: ["mcp__repo__read"],
      toolInvocations: [{ name: "mcp__repo__read", status: "ok" }],
      evidence: [{ kind: "tool_outcome", tool: "mcp__repo__read", status: "ok" }],
    });
  });

  it("marks an unattempted response as unverified when tools were visible", () => {
    expect(
      buildAgentDecisionTrace({
        toolSummary: {
          calls: 0,
          tools: [],
          failures: 0,
          visibleTools: ["read", "exec"],
          invocations: [],
        },
      }),
    ).toMatchObject({
      visibleTools: ["exec", "read"],
      confidence: "low",
      disposition: "unverified",
      reason: "no_tool_invocation",
    });
  });

  it("reports provider refusal without copying assistant prose", () => {
    expect(
      buildAgentDecisionTrace({
        completion: { refusal: true },
        toolSummary: {
          calls: 0,
          tools: [],
          failures: 0,
          visibleTools: ["read"],
          invocations: [],
        },
      }),
    ).toMatchObject({
      confidence: "high",
      disposition: "refused",
      reason: "provider_reported_refusal",
    });
  });
});

describe("attachAgentDecisionTrace", () => {
  it("attaches the trace to the last terminal assistant payload only", () => {
    const payloads = [
      { text: "working", isStatusNotice: true },
      { text: "answer" },
      { text: "usage", isStatusNotice: true },
    ];
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["read"],
        failures: 0,
        visibleTools: ["read"],
        invocations: [{ name: "read", status: "ok" }],
      },
    });

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual([
      { text: "working", isStatusNotice: true },
      { text: "answer", auditTrace },
      { text: "usage", isStatusNotice: true },
    ]);
  });
});
