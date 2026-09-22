// Coverage for the trace tool-summary projection that feeds the agent decision
// trace. Boon port of openclaw PR #80's run-attempt-result.test.ts, adapted to
// boon's monolithic run.ts (buildTraceToolSummary lives here) and boon's
// per-call `errored` flag (vs upstream `isError`) + `hadFailure` param name.
import { describe, expect, it } from "vitest";
import {
  buildTraceToolSummary,
  collectDelegatedToolInvocationsFromInternalEvents,
  mergeDelegatedToolEvidenceIntoSummary,
} from "./run.js";

describe("buildTraceToolSummary", () => {
  it("keeps visible tools and per-invocation outcomes without arguments or results", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["write", "read", "write"],
        toolMetas: [
          { toolName: "read", meta: "path=/secret", errored: false },
          { toolName: "write", meta: "token=secret", errored: true },
          { toolName: "exec", status: "blocked" },
        ],
        hadFailure: true,
      }),
    ).toEqual({
      calls: 3,
      tools: ["read", "write", "exec"],
      failures: 1,
      visibleTools: ["read", "write"],
      invocations: [
        { name: "read", status: "ok" },
        { name: "write", status: "error" },
        { name: "exec", status: "blocked" },
      ],
    });
  });

  it("returns a summary when tools were visible but none were invoked", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["read"],
        toolMetas: [],
        hadFailure: false,
      }),
    ).toEqual({
      calls: 0,
      tools: [],
      failures: 0,
      visibleTools: ["read"],
      invocations: [],
    });
  });

  it("preserves a partial tool outcome without treating it as an error", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["pdf"],
        toolMetas: [{ toolName: "pdf", status: "partial" }],
        hadFailure: false,
      }),
    ).toEqual({
      calls: 1,
      tools: ["pdf"],
      failures: 0,
      visibleTools: ["pdf"],
      invocations: [{ name: "pdf", status: "partial" }],
    });
  });

  it("returns undefined when neither tools were visible nor invoked", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: [],
        toolMetas: [],
        hadFailure: false,
      }),
    ).toBeUndefined();
  });

  it("carries hook-failure detail on a blocked invocation, but not on ok/error", () => {
    const summary = buildTraceToolSummary({
      visibleToolNames: ["message"],
      toolMetas: [
        { toolName: "exec", errored: false, detail: "stray" },
        { toolName: "message", status: "blocked", detail: "Error: kaboom" },
      ],
      hadFailure: true,
    });
    expect(summary?.invocations).toEqual([
      { name: "exec", status: "ok" },
      { name: "message", status: "blocked", detail: "Error: kaboom" },
    ]);
  });

  it("omits detail on a blocked invocation that never set it (a plain veto)", () => {
    const summary = buildTraceToolSummary({
      visibleToolNames: [],
      toolMetas: [{ toolName: "message", status: "blocked" }],
      hadFailure: true,
    });
    expect(summary?.invocations?.[0]).toEqual({ name: "message", status: "blocked" });
  });

  it("attaches a classified detail to an error invocation when a matching toolFailure exists", () => {
    const summary = buildTraceToolSummary({
      visibleToolNames: ["exec"],
      toolMetas: [{ toolName: "exec", errored: true }],
      hadFailure: true,
      toolFailures: [{ toolName: "exec", errorCode: "ENOENT" }],
    });
    expect(summary?.invocations).toEqual([{ name: "exec", status: "error", detail: "not found" }]);
  });

  it("omits detail on an error invocation when no toolFailures entry matches its name", () => {
    const summary = buildTraceToolSummary({
      visibleToolNames: ["exec"],
      toolMetas: [{ toolName: "exec", errored: true }],
      hadFailure: true,
      toolFailures: [{ toolName: "sessions_spawn", errorCode: "ENOENT" }],
    });
    expect(summary?.invocations).toEqual([{ name: "exec", status: "error" }]);
  });

  it("omits detail on an error invocation when the matching toolFailure classifies to nothing", () => {
    const summary = buildTraceToolSummary({
      visibleToolNames: ["exec"],
      toolMetas: [{ toolName: "exec", errored: true }],
      hadFailure: true,
      toolFailures: [{ toolName: "exec", error: "some totally unclassifiable failure text" }],
    });
    expect(summary?.invocations).toEqual([{ name: "exec", status: "error" }]);
  });

  it("omits detail when a tool records more than one failure in the turn (ambiguous match)", () => {
    // Two exec failures with different reasons: name-only matching cannot tell
    // which reason belongs to which errored call, so no detail is attached to
    // either rather than risk showing the wrong one.
    const summary = buildTraceToolSummary({
      visibleToolNames: ["exec"],
      toolMetas: [
        { toolName: "exec", errored: true },
        { toolName: "exec", errored: true },
      ],
      hadFailure: true,
      toolFailures: [
        { toolName: "exec", errorCode: "ENOENT" },
        { toolName: "exec", timedOut: true },
      ],
    });
    expect(summary?.invocations).toEqual([
      { name: "exec", status: "error" },
      { name: "exec", status: "error" },
    ]);
  });

  it("counts only the failures the runtime never marked retried", () => {
    // A successfully re-run step is retired so it cannot demote a finished
    // turn to "partial".
    const summary = buildTraceToolSummary({
      visibleToolNames: ["exec"],
      toolMetas: [
        { toolName: "exec", errored: true },
        { toolName: "exec", errored: false },
        { toolName: "sessions_spawn", errored: true },
      ],
      hadFailure: true,
      toolFailures: [{ retried: true }, {}],
    });

    expect(summary?.unrecoveredFailures).toBe(1);
    // Per-call outcomes stay untouched: both errors remain visible as evidence.
    expect(summary?.invocations).toEqual([
      { name: "exec", status: "error" },
      { name: "exec", status: "ok" },
      { name: "sessions_spawn", status: "error" },
    ]);
  });

  it("reports zero unrecovered failures once every error was retried", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["exec"],
        toolMetas: [
          { toolName: "exec", errored: true },
          { toolName: "exec", errored: false },
        ],
        hadFailure: true,
        toolFailures: [{ retried: true }],
      })?.unrecoveredFailures,
    ).toBe(0);
  });

  it("omits the recovery count for producers that do not track failures", () => {
    // Producers without a failure list keep the existing disposition.
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["exec"],
        toolMetas: [{ toolName: "exec", errored: true }],
        hadFailure: true,
      }),
    ).not.toHaveProperty("unrecoveredFailures");
  });
});

describe("collectDelegatedToolInvocationsFromInternalEvents", () => {
  it("returns empty when internalEvents is undefined", () => {
    expect(collectDelegatedToolInvocationsFromInternalEvents(undefined)).toEqual({
      invocations: [],
      visibleTools: [],
    });
  });

  it("returns empty when no event is a task_completion with childToolEvidence", () => {
    expect(
      collectDelegatedToolInvocationsFromInternalEvents([
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey: "c1",
          announceType: "subagent task",
          taskLabel: "t",
          status: "ok",
          statusLabel: "completed",
          result: "done",
          replyInstruction: "review",
        },
      ]),
    ).toEqual({ invocations: [], visibleTools: [] });
  });

  it("flattens childToolEvidence across events and tags each invocation viaSubagent", () => {
    const result = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
          {
            childSessionKey: "c2",
            toolInvocations: [{ name: "takeoff_status_poll", status: "ok" }],
            visibleTools: ["takeoff_status_poll"],
          },
        ],
      },
    ]);
    expect(result.invocations).toEqual([
      { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
      { name: "takeoff_status_poll", status: "ok", viaSubagent: true },
    ]);
    expect(result.visibleTools.toSorted()).toEqual(["takeoff_dispatch", "takeoff_status_poll"]);
  });
});

describe("buildTraceToolSummary + delegated merge (integration shape)", () => {
  it("merging delegated invocations into an existing summary preserves direct invocations untagged", () => {
    const direct = buildTraceToolSummary({
      visibleToolNames: ["message"],
      toolMetas: [{ toolName: "message", errored: false }],
      hadFailure: false,
    });
    const delegated = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    const merged = mergeDelegatedToolEvidenceIntoSummary(direct, delegated);
    expect(merged?.invocations).toEqual([
      { name: "message", status: "ok" },
      { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
    ]);
  });

  it("keeps calls and tools consistent with the merged invocations array", () => {
    const direct = buildTraceToolSummary({
      visibleToolNames: ["message"],
      toolMetas: [{ toolName: "message", errored: false }],
      hadFailure: false,
    });
    const delegated = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    const merged = mergeDelegatedToolEvidenceIntoSummary(direct, delegated);
    expect(merged?.calls).toBe(2);
    expect(merged?.tools).toEqual(["message", "takeoff_dispatch"]);
    expect(merged?.calls).toBe(merged?.invocations?.length);
  });

  it("is a true no-op (identical reference) when there is nothing delegated to merge", () => {
    const direct = buildTraceToolSummary({
      visibleToolNames: ["message"],
      toolMetas: [{ toolName: "message", errored: false }],
      hadFailure: false,
    });
    const merged = mergeDelegatedToolEvidenceIntoSummary(direct, {
      invocations: [],
      visibleTools: [],
    });
    expect(merged).toBe(direct);
  });

  it("produces a valid, fully-delegated summary when the resumed parent's own attempt made no tool calls at all", () => {
    // The headline ENG-19951 case: a resumed parent attempt whose own
    // buildTraceToolSummary returns undefined (no visible tools, no direct
    // invocations -- exactly the reported "message-only trace" failure
    // mode) must still produce a non-empty, viaSubagent-tagged summary once
    // delegated evidence exists.
    const direct = buildTraceToolSummary({
      visibleToolNames: [],
      toolMetas: [],
      hadFailure: false,
    });
    expect(direct).toBeUndefined();

    const delegated = collectDelegatedToolInvocationsFromInternalEvents([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "c1",
        announceType: "subagent task",
        taskLabel: "t",
        status: "ok",
        statusLabel: "completed",
        result: "done",
        replyInstruction: "review",
        childToolEvidence: [
          {
            childSessionKey: "c1",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    const merged = mergeDelegatedToolEvidenceIntoSummary(direct, delegated);

    expect(merged).not.toBeUndefined();
    expect(merged?.calls).toBe(1);
    expect(merged?.tools).toEqual(["takeoff_dispatch"]);
    expect(merged?.visibleTools).toEqual(["takeoff_dispatch"]);
    expect(merged?.invocations).toEqual([
      { name: "takeoff_dispatch", status: "ok", viaSubagent: true },
    ]);
  });
});
