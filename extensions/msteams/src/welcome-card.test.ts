// Msteams tests cover welcome card plugin behavior.
import { describe, expect, it } from "vitest";
import { buildMSTeamsPresentationCard } from "./presentation.js";
import { buildGroupWelcomeText, buildWelcomeCard } from "./welcome-card.js";

describe("buildMSTeamsPresentationCard", () => {
  it("preserves message text when rendering presentation controls", () => {
    expect(
      buildMSTeamsPresentationCard({
        text: "Deploy finished",
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [{ label: "Open", value: "open" }],
            },
          ],
        },
      }),
    ).toEqual({
      type: "AdaptiveCard",
      version: "1.4",
      body: [{ type: "TextBlock", text: "Deploy finished", wrap: true }],
      actions: [{ type: "Action.Submit", title: "Open", data: { value: "open", label: "Open" } }],
    });
  });

  it("wraps command actions as imBack so Teams redelivers them as a typed message", () => {
    // Teams only turns an Action.Submit press into a message activity the
    // handler reads (activity.text) when data carries the imBack shape;
    // a bare command string arrives as an invoke the handler never inspects.
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                {
                  label: "Plugins",
                  action: { type: "command", command: "/codex plugins menu" },
                },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [
        {
          type: "Action.Submit",
          title: "Plugins",
          data: { msteams: { type: "imBack", value: "/codex plugins menu" } },
        },
      ],
    });
  });

  it("wraps the Retry command button as imBack", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [{ label: "Retry", action: { type: "command", command: "/retry" } }],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [
        {
          type: "Action.Submit",
          title: "Retry",
          data: { msteams: { type: "imBack", value: "/retry" } },
        },
      ],
    });
  });

  it("leaves non-command (callback) button data shape unchanged", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [{ label: "Open", action: { type: "callback", value: "open" } }],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [{ type: "Action.Submit", title: "Open", data: { value: "open", label: "Open" } }],
    });
  });

  it("renders web app button links as open-url actions", () => {
    expect(
      buildMSTeamsPresentationCard({
        presentation: {
          blocks: [
            {
              type: "buttons",
              buttons: [
                { label: "Open app", webApp: { url: "https://example.com/app" } },
                { label: "Legacy app", web_app: { url: "https://example.com/legacy" } },
              ],
            },
          ],
        },
      }),
    ).toMatchObject({
      actions: [
        { type: "Action.OpenUrl", title: "Open app", url: "https://example.com/app" },
        { type: "Action.OpenUrl", title: "Legacy app", url: "https://example.com/legacy" },
      ],
    });
  });
});

describe("buildWelcomeCard", () => {
  it("builds card with default prompt starters", () => {
    const card = buildWelcomeCard();
    expect(card.type).toBe("AdaptiveCard");
    expect(card.version).toBe("1.5");

    const body = card.body as Array<{ text: string }>;
    expect(body[0]?.text).toContain("OpenClaw");

    const actions = card.actions as Array<{ title: string; data: unknown }>;
    expect(actions.length).toBe(3);
    expect(actions[0]?.title).toBe("What can you do?");
  });

  it("uses custom bot name", () => {
    const card = buildWelcomeCard({ botName: "TestBot" });
    const body = card.body as Array<{ text: string }>;
    expect(body[0]?.text).toContain("TestBot");
  });

  it("uses custom prompt starters", () => {
    const card = buildWelcomeCard({
      promptStarters: ["Do X", "Do Y"],
    });
    const actions = card.actions as Array<{ title: string; data: unknown }>;
    expect(actions.length).toBe(2);
    expect(actions[0]?.title).toBe("Do X");
    expect(actions[1]?.title).toBe("Do Y");

    // Verify imBack data
    const data = actions[0]?.data as { msteams: { type: string; value: string } };
    expect(data.msteams.type).toBe("imBack");
    expect(data.msteams.value).toBe("Do X");
  });

  it("falls back to defaults when promptStarters is empty", () => {
    const card = buildWelcomeCard({ promptStarters: [] });
    const actions = card.actions as Array<{ title: string }>;
    expect(actions.length).toBe(3);
  });
});

describe("buildGroupWelcomeText", () => {
  it("includes bot name", () => {
    const text = buildGroupWelcomeText("MyBot");
    expect(text).toContain("MyBot");
    expect(text).toContain("@MyBot");
  });

  it("defaults to OpenClaw", () => {
    const text = buildGroupWelcomeText();
    expect(text).toContain("OpenClaw");
  });
});
