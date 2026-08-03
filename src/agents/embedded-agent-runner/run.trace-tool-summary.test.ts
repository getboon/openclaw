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
});
