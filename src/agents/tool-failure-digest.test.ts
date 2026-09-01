import { describe, expect, it } from "vitest";
import type { ToolErrorSummary } from "./tool-error-summary.js";
import { buildToolFailureDigest } from "./tool-failure-digest.js";

const surfaceContext = {
  hasUserFacingReply: true,
  hasUserFacingErrorReply: false,
  hasUserFacingFailureAcknowledgement: false,
  includeDetails: false,
};

function failure(overrides: Partial<ToolErrorSummary & { retried?: boolean }> = {}) {
  return {
    toolName: "exec",
    error: "exited with code 1",
    ...overrides,
  };
}

describe("buildToolFailureDigest", () => {
  it("returns undefined when there are no failures", () => {
    expect(
      buildToolFailureDigest({ toolFailures: [], toolMetas: [], surfaceContext }),
    ).toBeUndefined();
  });

  it("returns undefined when every failure was retried", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [failure({ retried: true }), failure({ toolName: "bash", retried: true })],
      toolMetas: [],
      surfaceContext,
    });
    expect(digest).toBeUndefined();
  });

  it("names every distinct unrecovered failure (ENG-18812 — not just the most recent)", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [
        failure({ toolName: "exec", error: "exited with code 1" }),
        failure({ toolName: "exec", error: "connection timed out", timedOut: true }),
      ],
      toolMetas: [{ errored: false }, { errored: true }, { errored: true }],
      surfaceContext,
    });
    expect(digest).toBeDefined();
    expect(digest?.failures).toEqual([
      { toolName: "exec", reasonCode: "exit_error", reasonText: "exited with an error", count: 1 },
      { toolName: "exec", reasonCode: "timed_out", reasonText: "timed out", count: 1 },
    ]);
    expect(digest?.totalToolCount).toBe(3);
    expect(digest?.completedToolCount).toBe(1);
    expect(digest?.omittedCount).toBe(0);
  });

  it("dedupes identical (tool, reason) pairs into one entry with a count", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [
        failure({ toolName: "exec", errorCode: "ETIMEDOUT", timedOut: true }),
        failure({ toolName: "exec", errorCode: "ETIMEDOUT", timedOut: true }),
        failure({ toolName: "exec", errorCode: "ETIMEDOUT", timedOut: true }),
      ],
      toolMetas: [],
      surfaceContext,
    });
    expect(digest?.failures).toEqual([
      { toolName: "exec", reasonCode: "timed_out", reasonText: "timed out", count: 3 },
    ]);
  });

  it("drops entries the shared suppression predicate silences (sessions_send)", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [failure({ toolName: "sessions_send" }), failure({ toolName: "exec" })],
      toolMetas: [{ errored: true }, { errored: true }],
      surfaceContext,
    });
    expect(digest?.failures).toEqual([
      { toolName: "exec", reasonCode: "exit_error", reasonText: "exited with an error", count: 1 },
    ]);
  });

  it("drops middleware failures once a reply landed, matching resolveToolErrorWarningPolicy", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [failure({ middlewareError: true })],
      toolMetas: [],
      surfaceContext: { ...surfaceContext, hasUserFacingReply: true },
    });
    expect(digest).toBeUndefined();
  });

  it("never carries meta or raw error text onto an entry (ENG-16429 leak guard)", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [
        failure({
          toolName: "exec",
          meta: "rm -rf /secret/customer-data",
          error: "boon-projects takeoff-trigger --scope switches-dimmers failed: exit 1",
        }),
      ],
      toolMetas: [],
      surfaceContext,
    });
    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain("rm -rf");
    expect(serialized).not.toContain("boon-projects");
    expect(serialized).not.toContain("switches-dimmers");
  });

  it("caps the entry list and reports the remainder as omittedCount", () => {
    // mutatingAction: true so an arbitrary non-exec tool name still surfaces
    // regardless of hasUserFacingReply — this test is about the cap, not the
    // surfacing predicate (covered separately above).
    const distinctFailures = Array.from({ length: 10 }, (_, i) =>
      failure({ toolName: `tool-${i}`, error: "exited with code 1", mutatingAction: true }),
    );
    const digest = buildToolFailureDigest({
      toolFailures: distinctFailures,
      toolMetas: [],
      surfaceContext,
    });
    expect(digest?.failures).toHaveLength(8);
    expect(digest?.omittedCount).toBe(2);
  });

  it("treats a blocked call as not completed, matching buildAgentDecisionTrace's three-way disposition", () => {
    const digest = buildToolFailureDigest({
      toolFailures: [failure({ toolName: "write", mutatingAction: true })],
      toolMetas: [{ errored: false }, { errored: true, status: "blocked" }, { errored: true }],
      surfaceContext: { ...surfaceContext, hasUserFacingErrorReply: false },
    });
    expect(digest?.completedToolCount).toBe(1);
    expect(digest?.totalToolCount).toBe(3);
  });
});
