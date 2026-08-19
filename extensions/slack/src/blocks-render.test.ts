// Tests that resolveSlackControlValue passes through allowlisted command
// buttons (/approve, /retry) and drops everything else.
import { describe, expect, it } from "vitest";
import { buildSlackPresentationBlocks } from "./blocks-render.js";

function buildRetryPresentation() {
  return {
    blocks: [
      {
        type: "buttons" as const,
        buttons: [{ label: "Retry", action: { type: "command" as const, command: "/retry" } }],
      },
    ],
  };
}

describe("buildSlackPresentationBlocks / /retry allowlist", () => {
  it("passes through a /retry command button", () => {
    const blocks = buildSlackPresentationBlocks(buildRetryPresentation());
    const actionsBlock = blocks.find((block) => block.type === "actions") as {
      elements: Array<{ value?: string }>;
    };

    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements[0]?.value).toBe("/retry");
  });

  it("drops an arbitrary unrecognized command button", () => {
    const blocks = buildSlackPresentationBlocks({
      blocks: [
        {
          type: "buttons" as const,
          buttons: [
            {
              label: "Do something",
              action: { type: "command" as const, command: "/dosomething" },
            },
          ],
        },
      ],
    });

    const actionsBlock = blocks.find((block) => block.type === "actions");
    expect(actionsBlock).toBeUndefined();
  });
});
