import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalFixtureSkill } from "../../skills/test-support/test-helpers.js";
import type { SkillSnapshot } from "../../skills/types.js";
import { prepareClaudeCliSkillsPlugin, selectClaudePluginSkills } from "./claude-skills-plugin.js";

const cleanupDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(cleanupDirs, (dir) => fs.rm(dir, { recursive: true, force: true })));
  cleanupDirs.clear();
});

async function createSkill(root: string, name: string, disableModelInvocation = false) {
  const baseDir = path.join(root, name);
  const filePath = path.join(baseDir, "SKILL.md");
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(filePath, `# ${name}\n`, "utf-8");
  return createCanonicalFixtureSkill({
    name,
    description: `${name} description`,
    filePath,
    baseDir,
    source: "openclaw-workspace",
    disableModelInvocation,
  });
}

describe("prepareClaudeCliSkillsPlugin", () => {
  it("does not select an explicit skill from prompt-visible snapshot skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cli-skill-test-"));
    cleanupDirs.add(root);
    const visible = await createSkill(root, "internal");
    const snapshot = {
      prompt: "visible",
      skills: [{ name: visible.name }],
      resolvedSkills: [visible],
    } satisfies SkillSnapshot;

    expect(selectClaudePluginSkills(snapshot, "internal")).toEqual([]);
  });

  it("materializes only the explicitly selected command skill", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cli-skill-test-"));
    cleanupDirs.add(root);
    const visible = await createSkill(root, "visible");
    const selected = await createSkill(root, "steel-prices", true);
    const snapshot = {
      prompt: "visible",
      skills: [{ name: visible.name }, { name: selected.name }],
      resolvedSkills: [visible],
      commandSkills: [visible, selected],
    } satisfies SkillSnapshot;

    const plugin = await prepareClaudeCliSkillsPlugin({
      backendId: "claude-cli",
      skillsSnapshot: snapshot,
      explicitSkillName: "steel-prices",
    });
    if (plugin.pluginDir) {
      cleanupDirs.add(path.dirname(plugin.pluginDir));
    }

    expect(plugin.args).toHaveLength(2);
    const materialized = await fs.readdir(path.join(plugin.pluginDir!, "skills"));
    expect(materialized).toEqual(["steel-prices"]);
  });
});
