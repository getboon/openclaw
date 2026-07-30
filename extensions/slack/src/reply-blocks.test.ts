// Slack tests cover reply-blocks plugin behavior.
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { describe, expect, it } from "vitest";
import { resolveSlackAuditTraceBlock, resolveSlackReplyBlocks } from "./reply-blocks.js";

describe("agent decision trace", () => {
  it("renders a compact verification block without tool arguments or result bodies", () => {
    const block = resolveSlackAuditTraceBlock({
      text: "Connected.",
      auditTrace: {
        schemaVersion: 1,
        visibleTools: ["buildingconnected_connect", "read"],
        toolInvocations: [{ name: "buildingconnected_connect", status: "ok" }],
        evidence: [{ kind: "tool_outcome", tool: "buildingconnected_connect", status: "ok" }],
        confidence: "high",
        disposition: "completed",
        reason: "tool_execution_succeeded",
      },
    } as ReplyPayload);

    expect(block).toMatchObject({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: expect.stringContaining("*How this was verified*"),
        },
      ],
    });
    const serialized = JSON.stringify(block);
    expect(serialized).not.toContain("arguments");
    expect(serialized).not.toContain("result");
  });

  it("returns undefined when the payload carries no audit trace", () => {
    expect(resolveSlackAuditTraceBlock({ text: "hi" } as ReplyPayload)).toBeUndefined();
  });

  it("does not inject the audit trace into the primary reply block array", () => {
    // On boon the trace is delivered as a separate trailing message, so it must
    // NOT appear in resolveSlackReplyBlocks (which is sent alongside reply text
    // and would otherwise suppress that text via Slack's fallback demotion).
    const blocks = resolveSlackReplyBlocks({
      text: "Connected.",
      auditTrace: {
        schemaVersion: 1,
        visibleTools: ["read"],
        toolInvocations: [{ name: "read", status: "ok" }],
        evidence: [{ kind: "tool_outcome", tool: "read", status: "ok" }],
        confidence: "high",
        disposition: "completed",
        reason: "tool_execution_succeeded",
      },
    } as ReplyPayload);
    expect(blocks).toBeUndefined();
  });
});
