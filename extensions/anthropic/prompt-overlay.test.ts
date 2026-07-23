import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it } from "vitest";
import { buildAnthropicProvider } from "./register.runtime.js";

const CLAUDE_MODEL = "anthropic/claude-opus-4-8";
const NON_CLAUDE_MODEL = "openai/gpt-5.5";

function contributionFor(modelId: string, config?: OpenClawConfig) {
  return buildAnthropicProvider().resolveSystemPromptContribution?.({
    provider: "anthropic",
    modelId,
    promptMode: "full",
    config,
  });
}

describe("anthropic resolveSystemPromptContribution", () => {
  it("supplies the concise, guided-choice overlay for Claude models", () => {
    const contribution = contributionFor(CLAUDE_MODEL);
    expect(contribution?.sectionOverrides?.interaction_style).toContain("A, B, or C");
    expect(contribution?.sectionOverrides?.interaction_style).toContain("shortest reply");
    expect(contribution?.stablePrefix).toContain("concise");
  });

  it("returns nothing for non-Claude models", () => {
    expect(contributionFor(NON_CLAUDE_MODEL)).toBeUndefined();
  });

  it("is disabled when personality is off", () => {
    const config = {
      agents: { defaults: { promptOverlays: { claude: { personality: "off" } } } },
    } as unknown as OpenClawConfig;
    expect(contributionFor(CLAUDE_MODEL, config)).toBeUndefined();
  });
});
