// Snapshot hydration tests cover restoring runtime skill state from saved snapshots.
import { describe, expect, it } from "vitest";
import type { SessionSkillSnapshot } from "../../config/sessions/types.js";
import { createCanonicalFixtureSkill } from "../test-support/test-helpers.js";
import { hydrateRuntimeSkills } from "./snapshot-hydration.js";

function makeFixtureSkill(name: string, bodySize = 3000) {
  const source = `# ${name}\n\n${"x".repeat(bodySize)}`;
  return createCanonicalFixtureSkill({
    name,
    description: `${name} skill description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    source,
  });
}

describe("hydrateRuntimeSkills", () => {
  it("returns the same snapshot when both runtime skill lists are already populated", () => {
    const snapshot: SessionSkillSnapshot = {
      prompt: "p",
      skills: [{ name: "x" }],
      resolvedSkills: [makeFixtureSkill("x", 100)],
      commandSkills: [makeFixtureSkill("x", 100)],
      version: 1,
    };
    let buildCalls = 0;
    const result = hydrateRuntimeSkills(snapshot, () => {
      buildCalls += 1;
      return { resolvedSkills: [], commandSkills: [] };
    });
    expect(result).toBe(snapshot);
    expect(buildCalls).toBe(0);
  });

  it("rebuilds runtime skill lists when missing and preserves persisted fields", () => {
    const stripped: SessionSkillSnapshot = {
      prompt: "original-prompt",
      skills: [{ name: "x" }],
      skillFilter: ["x"],
      version: 7,
    };
    const rebuiltSkills = [makeFixtureSkill("x", 200)];
    const rebuiltCommands = [makeFixtureSkill("command", 200)];
    let buildCalls = 0;
    const result = hydrateRuntimeSkills(stripped, () => {
      buildCalls += 1;
      return {
        resolvedSkills: rebuiltSkills,
        commandSkills: rebuiltCommands,
      };
    });
    expect(buildCalls).toBe(1);
    expect(result.prompt).toBe("original-prompt");
    expect(result.skills).toEqual([{ name: "x" }]);
    expect(result.skillFilter).toEqual(["x"]);
    expect(result.version).toBe(7);
    expect(result.resolvedSkills).toBe(rebuiltSkills);
    expect(result.commandSkills).toBe(rebuiltCommands);
  });

  it("treats empty runtime skill arrays as populated", () => {
    const snapshot: SessionSkillSnapshot = {
      prompt: "",
      skills: [],
      resolvedSkills: [],
      commandSkills: [],
      version: 1,
    };
    let buildCalls = 0;
    const result = hydrateRuntimeSkills(snapshot, () => {
      buildCalls += 1;
      return {
        resolvedSkills: [makeFixtureSkill("x")],
        commandSkills: [makeFixtureSkill("x")],
      };
    });
    expect(result).toBe(snapshot);
    expect(buildCalls).toBe(0);
  });
});
