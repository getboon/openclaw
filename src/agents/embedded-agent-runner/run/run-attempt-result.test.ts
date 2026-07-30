import { describe, expect, it } from "vitest";
import { buildTraceToolSummary } from "./run-attempt-result.js";

describe("buildTraceToolSummary", () => {
  it("keeps visible tools and per-invocation outcomes without arguments or results", () => {
    expect(
      buildTraceToolSummary({
        visibleToolNames: ["write", "read", "write"],
        toolMetas: [
          { toolName: "read", meta: "path=/secret", replaySafe: true },
          { toolName: "write", meta: "token=secret", isError: true },
          { toolName: "exec", status: "blocked" },
        ],
        fallbackHadFailure: false,
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
        fallbackHadFailure: false,
      }),
    ).toEqual({
      calls: 0,
      tools: [],
      failures: 0,
      visibleTools: ["read"],
      invocations: [],
    });
  });
});
