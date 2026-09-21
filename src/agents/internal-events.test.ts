import { describe, expect, it } from "vitest";
import {
  formatAgentInternalEventsForPlainPrompt,
  formatAgentInternalEventsForPrompt,
} from "./internal-events.js";

describe("formatAgentInternalEventsForPrompt", () => {
  it("never renders childToolEvidence into the prompt text", () => {
    const rendered = formatAgentInternalEventsForPrompt([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:subagent:abc",
        childSessionId: "sess-1",
        announceType: "subagent task",
        taskLabel: "run takeoff scopes",
        status: "ok",
        statusLabel: "completed; ready for parent review",
        result: "All 7 scopes completed.",
        replyInstruction: "Review/verify the result above...",
        childToolEvidence: [
          {
            childSessionKey: "agent:main:subagent:abc",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    expect(rendered).toContain("All 7 scopes completed.");
    expect(rendered).not.toContain("takeoff_dispatch");
    expect(rendered).not.toContain("childToolEvidence");
  });
});

describe("formatAgentInternalEventsForPlainPrompt", () => {
  it("never renders childToolEvidence into the prompt text", () => {
    const rendered = formatAgentInternalEventsForPlainPrompt([
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:subagent:abc",
        childSessionId: "sess-1",
        announceType: "subagent task",
        taskLabel: "run takeoff scopes",
        status: "ok",
        statusLabel: "completed; ready for parent review",
        result: "All 7 scopes completed.",
        replyInstruction: "Review/verify the result above...",
        childToolEvidence: [
          {
            childSessionKey: "agent:main:subagent:abc",
            toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
            visibleTools: ["takeoff_dispatch"],
          },
        ],
      },
    ]);
    expect(rendered).not.toContain("takeoff_dispatch");
  });
});
