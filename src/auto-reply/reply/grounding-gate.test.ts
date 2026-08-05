import { describe, expect, it } from "vitest";
import { sanitizeUngroundedClaims } from "./grounding-gate.js";

describe("sanitizeUngroundedClaims", () => {
  it("replaces fabricated measured numbers when no tool result exists", () => {
    const result = sanitizeUngroundedClaims({
      text: "Done - 22 pages verified and 4,288 LF measured.",
      auditTrace: {
        schemaVersion: 1,
        visibleTools: ["read", "exec"],
        toolInvocations: [],
        evidence: [],
        confidence: "low",
        disposition: "unverified",
        reason: "no_tool_invocation",
      },
    });

    expect(result).toBe("I don't have a tool result supporting that statement yet.");
  });

  it("blocks grounding claims when auditTrace is absent", () => {
    expect(
      sanitizeUngroundedClaims({
        text: "22 pages verified.",
      }),
    ).toBe("I don't have a tool result supporting that statement yet.");
  });

  it("blocks processed-set credibility variants and standalone completion claims", () => {
    for (const text of [
      "Pulled from the processed set.",
      "Pulled straight from the processed set.",
      "Done.",
    ]) {
      expect(sanitizeUngroundedClaims({ text })).toBe(
        "I don't have a tool result supporting that statement yet.",
      );
    }
  });

  it("blocks credibility and readiness claims without a number", () => {
    for (const text of ["It's real this time - the pages are ready.", "The pages are ready."]) {
      expect(
        sanitizeUngroundedClaims({
          text,
          auditTrace: {
            schemaVersion: 1,
            visibleTools: ["read"],
            toolInvocations: [],
            evidence: [],
            confidence: "low",
            disposition: "unverified",
            reason: "no_tool_invocation",
          },
        }),
      ).toBe("I don't have a tool result supporting that statement yet.");
    }
  });

  it("preserves tool-backed claims", () => {
    const text = "Done - 22 pages verified and 4,288 LF measured.";

    expect(
      sanitizeUngroundedClaims({
        text,
        auditTrace: {
          schemaVersion: 1,
          visibleTools: ["takeoff"],
          toolInvocations: [{ name: "takeoff", status: "ok" }],
          evidence: [{ kind: "tool_outcome", tool: "takeoff", status: "ok" }],
          confidence: "high",
          disposition: "completed",
          reason: "tool_execution_succeeded",
        },
      }),
    ).toBe(text);
  });

  it("blocks claims when a tool ran but did not produce a successful result", () => {
    expect(
      sanitizeUngroundedClaims({
        text: "The takeoff is confirmed.",
        auditTrace: {
          schemaVersion: 1,
          visibleTools: ["takeoff"],
          toolInvocations: [{ name: "takeoff", status: "error" }],
          evidence: [{ kind: "tool_outcome", tool: "takeoff", status: "error" }],
          confidence: "high",
          disposition: "failed",
          reason: "tool_execution_failed",
        },
      }),
    ).toBe("I don't have a tool result supporting that statement yet.");
  });

  it("does not rewrite ordinary prose or status notices", () => {
    expect(
      sanitizeUngroundedClaims({
        text: "I can help you review the uploaded drawings.",
        auditTrace: undefined,
      }),
    ).toBe("I can help you review the uploaded drawings.");

    expect(
      sanitizeUngroundedClaims({
        text: "Done - here's how to set that up.",
      }),
    ).toBe("Done - here's how to set that up.");

    expect(
      sanitizeUngroundedClaims({
        text: "Done - upload received.",
        isStatusNotice: true,
      }),
    ).toBe("Done - upload received.");

    expect(
      sanitizeUngroundedClaims({
        text: "Done - compaction finished.",
        isCompactionNotice: true,
      }),
    ).toBe("Done - compaction finished.");

    expect(
      sanitizeUngroundedClaims({
        text: "Done - fallback finished.",
        isFallbackNotice: true,
      }),
    ).toBe("Done - fallback finished.");

    for (const flags of [{ isError: true }, { isReasoning: true }, { isCommentary: true }]) {
      expect(
        sanitizeUngroundedClaims({
          text: "22 pages verified.",
          ...flags,
        }),
      ).toBe("22 pages verified.");
    }
  });
});
