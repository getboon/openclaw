// Coverage for the trace tool-summary projection that feeds the agent decision
// trace. Boon port of openclaw PR #80's run-attempt-result.test.ts, adapted to
// boon's monolithic run.ts (buildTraceToolSummary lives here) and boon's
// per-call `errored` flag (vs upstream `isError`) + `hadFailure` param name.
import { describe, expect, it } from "vitest";
import { buildTraceToolSummary } from "./run.js";

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

  it("returns undefined when neither tools were visible nor invoked", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: [],
        toolMetas: [],
        hadFailure: false,
      }),
    ).toBeUndefined();
  });

  it("carries hook-failure detail on a blocked invocation, but not on ok/error (ENG-19492)", () => {
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
