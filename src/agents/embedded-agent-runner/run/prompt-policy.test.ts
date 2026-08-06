import { describe, expect, it } from "vitest";
import { resolveRunPromptPolicy } from "./prompt-policy.js";

describe("resolveRunPromptPolicy", () => {
  it("strips the general skills prompt for restricted-tool runs", () => {
    expect(
      resolveRunPromptPolicy({
        promptMode: "full",
        skillsPrompt: "ALL SKILLS",
        toolsAllow: ["read"],
      }),
    ).toEqual({
      promptMode: "minimal",
      skillsPrompt: undefined,
    });
  });

  it("keeps the selected skill prompt for restricted-tool runs", () => {
    expect(
      resolveRunPromptPolicy({
        promptMode: "full",
        skillsPrompt: "SELECTED SKILL",
        toolsAllow: ["read"],
        explicitSkillName: "selected-skill",
      }),
    ).toEqual({
      promptMode: "minimal",
      skillsPrompt: "SELECTED SKILL",
    });
  });

  it("keeps the normal prompt policy for unrestricted runs", () => {
    expect(
      resolveRunPromptPolicy({
        promptMode: "full",
        skillsPrompt: "ALL SKILLS",
      }),
    ).toEqual({
      promptMode: "full",
      skillsPrompt: "ALL SKILLS",
    });
  });

  it("keeps the normal prompt policy for wildcard tool access", () => {
    expect(
      resolveRunPromptPolicy({
        promptMode: "full",
        skillsPrompt: "ALL SKILLS",
        toolsAllow: [" * "],
      }),
    ).toEqual({
      promptMode: "full",
      skillsPrompt: "ALL SKILLS",
    });
  });

  it("uses restricted prompt policy for an explicit empty tool allowlist", () => {
    expect(
      resolveRunPromptPolicy({
        promptMode: "full",
        skillsPrompt: "ALL SKILLS",
        toolsAllow: [],
      }),
    ).toEqual({
      promptMode: "minimal",
      skillsPrompt: undefined,
    });
  });
});
