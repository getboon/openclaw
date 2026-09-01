import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderSkillWorkshop,
  type SkillWorkshopProps,
  type SkillWorkshopProposal,
} from "./skill-workshop.ts";

const TLDR_BODY = `# Inbox Cleaner

## TLDR

This skill turns an unread inbox into a prioritized action list.

When you run this, the agent will:

- Review unread messages.
- Group messages by urgency.
- Identify the next action for each important thread.

**Output:** A prioritized inbox action list.

## Instructions

Review every unread thread before proposing actions.
`;

function proposal(): SkillWorkshopProposal {
  return {
    key: "proposal-1",
    slug: "inbox-cleaner",
    name: "Inbox Cleaner",
    oneLine: "Clean inbox triage",
    body: TLDR_BODY,
    status: "pending",
    version: 1,
    createdAt: Date.now(),
    recencyGroup: "today",
    ageLabel: "now",
    supportFiles: [],
    isNew: false,
  };
}

function props(): SkillWorkshopProps {
  const noop = vi.fn<() => void>();
  return {
    loading: false,
    error: null,
    inspectingKey: null,
    proposals: [proposal()],
    selectedKey: "proposal-1",
    statusFilter: "all",
    query: "",
    filePreviewKey: null,
    filePreviewQuery: "",
    queueWidth: 360,
    mode: "board",
    actionBusy: null,
    actionNotice: null,
    revisionKey: null,
    revisionDraft: "",
    assistantName: "Boon",
    counts: {
      all: 1,
      pending: 1,
      applied: 0,
      rejected: 0,
      quarantined: 0,
      stale: 0,
    },
    onStatusFilterChange: noop,
    onQueryChange: noop,
    onFilePreviewQueryChange: noop,
    onQueueWidthChange: noop,
    onModeChange: noop,
    onSelect: noop,
    onPrev: noop,
    onNext: noop,
    onApply: noop,
    onRevise: noop,
    onReject: noop,
    onRevisionDraftChange: noop,
    onRevisionCancel: noop,
    onRevisionSubmit: noop,
    onPreviewFile: noop,
    onClosePreview: noop,
  };
}

describe("renderSkillWorkshop", () => {
  it("renders the TLDR journey as an unordered list before detailed instructions", () => {
    const container = document.createElement("div");

    render(renderSkillWorkshop(props()), container);

    expect(
      Array.from(container.querySelectorAll(".sw-body-card h3")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toStrictEqual(["Inbox Cleaner", "TLDR", "Instructions"]);
    expect(
      Array.from(container.querySelectorAll(".sw-body-card ul li")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toStrictEqual([
      "Review unread messages.",
      "Group messages by urgency.",
      "Identify the next action for each important thread.",
    ]);
    expect(container.querySelector(".sw-body-card strong")?.textContent).toBe("Output:");

    const bodyText = container.querySelector(".sw-body-card")?.textContent ?? "";
    expect(bodyText.indexOf("TLDR")).toBeLessThan(bodyText.indexOf("Output:"));
    expect(bodyText.indexOf("Output:")).toBeLessThan(bodyText.indexOf("Instructions"));
  });

  it("uses the TLDR journey for the default Today preview", () => {
    const container = document.createElement("div");

    render(renderSkillWorkshop({ ...props(), mode: "today" }), container);

    expect(container.querySelector(".sw-today__does-h")?.textContent?.trim()).toBe(
      "What the agent will do",
    );
    expect(
      Array.from(container.querySelectorAll(".sw-today__does li")).map((node) =>
        node.textContent?.trim(),
      ),
    ).toStrictEqual([
      "Review unread messages.",
      "Group messages by urgency.",
      "Identify the next action for each important thread.",
    ]);
  });
});
