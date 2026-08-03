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

  it("keeps the context element within Slack's 3000-char text-object limit", () => {
    // 12 max-length (120-char) tool names on each list would exceed 3000 chars
    // without the total-text budget guard, which Slack rejects with a 400.
    const longName = "a".repeat(120);
    const names = Array.from({ length: 12 }, (_, i) => `${longName.slice(0, 118)}${i}`);
    const block = resolveSlackAuditTraceBlock({
      text: "done",
      auditTrace: {
        schemaVersion: 1,
        visibleTools: names,
        toolInvocations: names.map((name) => ({ name, status: "ok" as const })),
        evidence: names.map((name) => ({
          kind: "tool_outcome" as const,
          tool: name,
          status: "ok" as const,
        })),
        confidence: "high",
        disposition: "completed",
        reason: "tool_execution_succeeded",
      },
    } as ReplyPayload) as { elements: Array<{ text: string }> };
    expect(block.elements[0]?.text.length).toBeLessThanOrEqual(3000);
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
