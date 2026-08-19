// Prompt resolution tests cover skill prompt lookup and active skill selection.
import { describe, expect, it } from "vitest";
import { createCanonicalFixtureSkill } from "../test-support/test-helpers.js";
import type { SkillEntry } from "../types.js";
import { resolveSkillsPromptForRun } from "./workspace.js";

describe("resolveSkillsPromptForRun", () => {
  it("prefers snapshot prompt when available", () => {
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: { prompt: "SNAPSHOT", skills: [] },
      workspaceDir: "/tmp/openclaw",
    });
    expect(prompt).toBe("SNAPSHOT");
  });
  it("builds prompt from entries when snapshot is missing", () => {
    const entry: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "demo-skill",
        description: "Demo",
        filePath: "/app/skills/demo-skill/SKILL.md",
        baseDir: "/app/skills/demo-skill",
        source: "openclaw-bundled",
      }),
      frontmatter: {},
    };
    const prompt = resolveSkillsPromptForRun({
      entries: [entry],
      workspaceDir: "/tmp/openclaw",
    });
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("/app/skills/demo-skill/SKILL.md");
  });

  it("keeps legacy entries with disableModelInvocation hidden when exposure metadata is absent", () => {
    const hidden: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "hidden-skill",
        description: "Hidden",
        filePath: "/app/skills/hidden-skill/SKILL.md",
        baseDir: "/app/skills/hidden-skill",
        source: "openclaw-workspace",
        disableModelInvocation: true,
      }),
      frontmatter: {},
    };

    const prompt = resolveSkillsPromptForRun({
      entries: [hidden],
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).not.toContain("/app/skills/hidden-skill/SKILL.md");
  });

  it("includes only an explicitly selected hidden skill from entries", () => {
    const hidden: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "hidden-skill",
        description: "Hidden",
        filePath: "/app/skills/hidden-skill/SKILL.md",
        baseDir: "/app/skills/hidden-skill",
        source: "openclaw-workspace",
        disableModelInvocation: true,
      }),
      frontmatter: {},
    };
    const visible: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "visible-skill",
        description: "Visible",
        filePath: "/app/skills/visible-skill/SKILL.md",
        baseDir: "/app/skills/visible-skill",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
    };

    const prompt = resolveSkillsPromptForRun({
      entries: [visible, hidden],
      explicitSkillName: "hidden-skill",
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("/app/skills/hidden-skill/SKILL.md");
    expect(prompt).not.toContain("/app/skills/visible-skill/SKILL.md");
  });

  it("does not select a skill marked as non-user-invocable", () => {
    const hidden: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "internal-skill",
        description: "Internal",
        filePath: "/app/skills/internal-skill/SKILL.md",
        baseDir: "/app/skills/internal-skill",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
      exposure: {
        includeInRuntimeRegistry: true,
        includeInAvailableSkillsPrompt: true,
        userInvocable: false,
      },
    };

    const prompt = resolveSkillsPromptForRun({
      entries: [hidden],
      explicitSkillName: "internal-skill",
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toBe("");
  });

  it("selects an explicit skill from command snapshot skills", () => {
    const selected = createCanonicalFixtureSkill({
      name: "selected-skill",
      description: "Selected",
      filePath: "/app/skills/selected-skill/SKILL.md",
      baseDir: "/app/skills/selected-skill",
      source: "openclaw-workspace",
      disableModelInvocation: true,
    });
    const unrelated = createCanonicalFixtureSkill({
      name: "unrelated-skill",
      description: "Unrelated",
      filePath: "/app/skills/unrelated-skill/SKILL.md",
      baseDir: "/app/skills/unrelated-skill",
      source: "openclaw-workspace",
    });

    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: {
        prompt: "NORMAL SNAPSHOT",
        skills: [],
        resolvedSkills: [unrelated],
        commandSkills: [unrelated, selected],
      },
      explicitSkillName: "selected-skill",
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toContain("/app/skills/selected-skill/SKILL.md");
    expect(prompt).not.toContain("NORMAL SNAPSHOT");
    expect(prompt).not.toContain("/app/skills/unrelated-skill/SKILL.md");
  });

  it("returns an empty prompt when the explicit skill is unavailable", () => {
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: {
        prompt: "NORMAL SNAPSHOT",
        skills: [],
        resolvedSkills: [],
      },
      explicitSkillName: "missing-skill",
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toBe("");
  });

  it("does not authorize an explicit skill from prompt-visible snapshot skills", () => {
    const promptVisible = createCanonicalFixtureSkill({
      name: "internal-skill",
      description: "Internal",
      filePath: "/app/skills/internal-skill/SKILL.md",
      baseDir: "/app/skills/internal-skill",
      source: "openclaw-workspace",
    });
    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: {
        prompt: "NORMAL SNAPSHOT",
        skills: [{ name: "internal-skill" }],
        resolvedSkills: [promptVisible],
      },
      explicitSkillName: "internal-skill",
      workspaceDir: "/tmp/openclaw",
    });

    expect(prompt).toBe("");
  });

  it("inherits agents.defaults.skills when rebuilding prompt for an agent", () => {
    const visible: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "github",
        description: "GitHub",
        filePath: "/app/skills/github/SKILL.md",
        baseDir: "/app/skills/github",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
    };
    const hidden: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "hidden-skill",
        description: "Hidden",
        filePath: "/app/skills/hidden-skill/SKILL.md",
        baseDir: "/app/skills/hidden-skill",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
    };

    const prompt = resolveSkillsPromptForRun({
      entries: [visible, hidden],
      config: {
        agents: {
          defaults: {
            skills: ["github"],
          },
          list: [{ id: "writer" }],
        },
      },
      workspaceDir: "/tmp/openclaw",
      agentId: "writer",
    });

    expect(prompt).toContain("/app/skills/github/SKILL.md");
    expect(prompt).not.toContain("/app/skills/hidden-skill/SKILL.md");
  });

  it("uses agents.list[].skills as a full replacement for defaults", () => {
    const inheritedEntry: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "weather",
        description: "Weather",
        filePath: "/app/skills/weather/SKILL.md",
        baseDir: "/app/skills/weather",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
    };
    const explicitEntry: SkillEntry = {
      skill: createCanonicalFixtureSkill({
        name: "docs-search",
        description: "Docs",
        filePath: "/app/skills/docs-search/SKILL.md",
        baseDir: "/app/skills/docs-search",
        source: "openclaw-workspace",
      }),
      frontmatter: {},
    };

    const prompt = resolveSkillsPromptForRun({
      entries: [inheritedEntry, explicitEntry],
      config: {
        agents: {
          defaults: {
            skills: ["weather"],
          },
          list: [{ id: "writer", skills: ["docs-search"] }],
        },
      },
      workspaceDir: "/tmp/openclaw",
      agentId: "writer",
    });

    expect(prompt).not.toContain("/app/skills/weather/SKILL.md");
    expect(prompt).toContain("/app/skills/docs-search/SKILL.md");
  });
});
