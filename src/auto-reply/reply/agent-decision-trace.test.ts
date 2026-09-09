import { describe, expect, it } from "vitest";
import { getReplyPayloadMetadata, setReplyPayloadMetadata } from "../reply-payload.js";
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

  it("carries hook-failure detail on a blocked entry into toolInvocations and evidence", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        failures: 1,
        visibleTools: ["message"],
        invocations: [{ name: "message", status: "blocked", detail: "Error: kaboom" }],
      },
    });
    expect(trace.toolInvocations).toEqual([
      { name: "message", status: "blocked", detail: "Error: kaboom" },
    ]);
    expect(trace.evidence).toEqual([
      { kind: "tool_outcome", tool: "message", status: "blocked", detail: "Error: kaboom" },
    ]);
    expect(trace.reason).toBe("tool_execution_blocked");
  });

  it("omits detail for a veto-blocked entry (no detail supplied)", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        failures: 1,
        visibleTools: ["message"],
        invocations: [{ name: "message", status: "blocked" }],
      },
    });
    expect(trace.toolInvocations[0]).not.toHaveProperty("detail");
    expect(trace.evidence[0]).not.toHaveProperty("detail");
  });

  it("never attaches a stray detail to a non-blocked entry", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["exec", "message"],
        visibleTools: ["exec", "message"],
        invocations: [
          { name: "exec", status: "ok", detail: "stray" },
          { name: "message", status: "error", detail: "stray" },
        ],
      },
    });
    expect(trace.toolInvocations.every((entry) => !("detail" in entry))).toBe(true);
    expect(trace.evidence.every((entry) => !("detail" in entry))).toBe(true);
  });

  it("truncates an oversized detail to the bounded cap", () => {
    const longDetail = "E".repeat(900);
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        visibleTools: ["message"],
        invocations: [{ name: "message", status: "blocked", detail: longDetail }],
      },
    });
    expect(trace.toolInvocations[0].detail).toHaveLength(500);
  });

  it("truncates on a UTF-16 boundary without splitting a surrogate pair", () => {
    // "😀" is two UTF-16 code units straddling the 500-unit cap; the safe
    // truncation drops the whole emoji rather than storing a lone surrogate.
    const detail = `${"E".repeat(499)}😀tail`;
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        visibleTools: ["message"],
        invocations: [{ name: "message", status: "blocked", detail }],
      },
    });
    const truncated = trace.toolInvocations[0].detail ?? "";
    expect(truncated).toBe("E".repeat(499));
    // No lone/unpaired surrogate at the end.
    expect(truncated.charCodeAt(truncated.length - 1)).toBeLessThan(0xd800);
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

  it("caps visibleTools, toolInvocations, and evidence at 128 items", () => {
    const visibleTools = Array.from(
      { length: 200 },
      (_, i) => `tool_${String(i).padStart(3, "0")}`,
    );
    const invocations = visibleTools.map((name) => ({ name, status: "ok" as const }));

    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: invocations.length,
        tools: visibleTools,
        failures: 0,
        visibleTools,
        invocations,
      },
    });

    expect(trace.visibleTools).toHaveLength(128);
    expect(trace.toolInvocations).toHaveLength(128);
    expect(trace.evidence).toHaveLength(128);
  });

  it("derives disposition from the full invocation set even when a failure falls beyond the 128 cap", () => {
    // Regression: truncating before counting let a late failure (index >= 128)
    // be discarded, so the trace reported high-confidence success for a run that
    // actually failed a tool — defeating verifiability.
    const invocations = [
      ...Array.from({ length: 128 }, (_, i) => ({
        name: `tool_${String(i).padStart(3, "0")}`,
        status: "ok" as const,
      })),
      { name: "exec", status: "error" as const },
    ];

    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: invocations.length,
        tools: [],
        failures: 1,
        invocations,
      },
    });

    // Emitted arrays stay bounded, but the outcome reflects the late failure.
    expect(trace.toolInvocations).toHaveLength(128);
    expect(trace.disposition).toBe("completed");
    expect(trace.reason).toBe("tool_execution_partial");
    expect(trace.confidence).toBe("medium");
  });

  it("reports a recovered turn as succeeded once every failure was retried", () => {
    // Recovered errors remain visible as evidence but no longer demote the
    // completed turn to "partial".
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 3,
        tools: ["sessions_spawn", "exec", "message"],
        failures: 1,
        visibleTools: ["sessions_spawn", "exec", "message"],
        invocations: [
          { name: "sessions_spawn", status: "error" },
          { name: "exec", status: "ok" },
          { name: "message", status: "ok" },
        ],
        unrecoveredFailures: 0,
      },
      payloads: [{ text: "The work is complete." }],
    });

    expect(trace.disposition).toBe("completed");
    expect(trace.reason).toBe("tool_execution_succeeded");
    // Medium, not high: calls did error, they were just recovered.
    expect(trace.confidence).toBe("medium");
    // The error is still enumerated for the verification surfaces.
    expect(trace.toolInvocations).toEqual([
      { name: "sessions_spawn", status: "error" },
      { name: "exec", status: "ok" },
      { name: "message", status: "ok" },
    ]);
    expect(trace.evidence).toContainEqual({
      kind: "tool_outcome",
      tool: "sessions_spawn",
      status: "error",
    });
  });

  it("keeps a recovered failure partial when the terminal tool is not message", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["sessions_spawn", "exec"],
        failures: 1,
        invocations: [
          { name: "sessions_spawn", status: "error" },
          { name: "exec", status: "ok" },
        ],
        unrecoveredFailures: 0,
      },
      payloads: [{ text: "The work is complete." }],
    });

    expect(trace.reason).toBe("tool_execution_partial");
  });

  it("keeps a recovered failure partial when the final answer is blank", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["exec", "message"],
        failures: 1,
        invocations: [
          { name: "exec", status: "error" },
          { name: "message", status: "ok" },
        ],
        unrecoveredFailures: 0,
      },
      payloads: [{ text: "   " }],
    });

    expect(trace.reason).toBe("tool_execution_partial");
  });

  it("keeps reporting partial while a failure is still unrecovered", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["exec", "message"],
        failures: 1,
        visibleTools: ["exec", "message"],
        invocations: [
          { name: "exec", status: "error" },
          { name: "message", status: "ok" },
        ],
        unrecoveredFailures: 1,
      },
    });

    expect(trace.disposition).toBe("completed");
    expect(trace.reason).toBe("tool_execution_partial");
    expect(trace.confidence).toBe("medium");
  });

  it("leaves the disposition unchanged when the runtime reports no recovery count", () => {
    // Producers that never populate `unrecoveredFailures` (the CLI runner and
    // every legacy caller) must keep today's output exactly.
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["exec", "message"],
        failures: 1,
        visibleTools: ["exec", "message"],
        invocations: [
          { name: "exec", status: "error" },
          { name: "message", status: "ok" },
        ],
      },
    });

    expect(trace.reason).toBe("tool_execution_partial");
    expect(trace.confidence).toBe("medium");
  });

  it("never treats a blocked call as recovered", () => {
    // A blocked call never ran, so nothing could have retried it — recovery
    // accounting covers errors only.
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 2,
        tools: ["exec", "message"],
        failures: 0,
        visibleTools: ["exec", "message"],
        invocations: [
          { name: "exec", status: "blocked" },
          { name: "message", status: "ok" },
        ],
        unrecoveredFailures: 0,
      },
    });

    expect(trace.reason).toBe("tool_execution_partial");
  });

  it("marks a partial tool result medium-confidence even without an error", () => {
    const trace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["pdf"],
        failures: 0,
        visibleTools: ["pdf"],
        invocations: [{ name: "pdf", status: "partial" }],
      },
    });

    expect(trace.disposition).toBe("completed");
    expect(trace.reason).toBe("tool_execution_partial");
    expect(trace.confidence).toBe("medium");
    expect(trace.evidence).toEqual([{ kind: "tool_outcome", tool: "pdf", status: "partial" }]);
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

  it("preserves WeakMap delivery metadata on the traced terminal payload", () => {
    // Regression: attaching the trace cloned the payload with a bare spread,
    // orphaning its WeakMap-backed metadata (threading/transcript identity).
    const terminal = { text: "answer" };
    setReplyPayloadMetadata(terminal, { replyToIdExplicit: true });
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["read"],
        failures: 0,
        visibleTools: ["read"],
        invocations: [{ name: "read", status: "ok" }],
      },
    });

    const [traced] = attachAgentDecisionTrace([terminal], auditTrace);

    expect(traced.auditTrace).toBe(auditTrace);
    expect(getReplyPayloadMetadata(traced)?.replyToIdExplicit).toBe(true);
  });

  it("attaches the trace to the answer instead of a trailing tool-failure warning", () => {
    // A trailing warning must not steal the answer's audit trace.
    const payloads = [
      { text: "answer" },
      { text: "\u21bb One step didn't finish.", isError: true },
    ];
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["exec"],
        failures: 1,
        visibleTools: ["exec"],
        invocations: [{ name: "exec", status: "error" }],
      },
    });

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual([
      { text: "answer", auditTrace },
      { text: "\u21bb One step didn't finish.", isError: true },
    ]);
  });

  it("does not treat a blank payload as an answer ahead of a warning", () => {
    const payloads = [{ text: "   " }, { text: "\u21bb One step didn't finish.", isError: true }];
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        failures: 1,
        invocations: [{ name: "message", status: "error" }],
      },
    });

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual([
      { text: "   " },
      { text: "\u21bb One step didn't finish.", auditTrace, isError: true },
    ]);
  });

  it("does not attach the trace when the only payload is blank", () => {
    const payloads = [{ text: "   " }];
    const auditTrace = buildAgentDecisionTrace({});

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual(payloads);
  });

  it("still treats a media-only payload as a traceable answer", () => {
    const payloads = [
      { text: "   ", mediaUrls: ["https://example.com/result.png"] },
      { text: "\u21bb One step didn't finish.", isError: true },
    ];
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        failures: 1,
        invocations: [{ name: "message", status: "error" }],
      },
    });

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual([
      {
        text: "   ",
        mediaUrls: ["https://example.com/result.png"],
        auditTrace,
      },
      { text: "\u21bb One step didn't finish.", isError: true },
    ]);
  });

  it("still attaches the trace when every payload is an error notice", () => {
    const payloads = [{ text: "\u26a0\ufe0f message failed", isError: true }];
    const auditTrace = buildAgentDecisionTrace({
      toolSummary: {
        calls: 1,
        tools: ["message"],
        failures: 1,
        visibleTools: ["message"],
        invocations: [{ name: "message", status: "error" }],
      },
    });

    expect(attachAgentDecisionTrace(payloads, auditTrace)).toEqual([
      { text: "\u26a0\ufe0f message failed", auditTrace, isError: true },
    ]);
  });
});
