import { describe, expect, it } from "vitest";
import { buildCodexModelDefinition } from "./provider-catalog.js";

describe("buildCodexModelDefinition", () => {
  it("preserves an explicit empty supportedReasoningEfforts array instead of dropping it", () => {
    const definition = buildCodexModelDefinition({
      id: "gpt-5.4-instant",
      model: "gpt-5.4-instant",
      inputModalities: ["text"],
      supportedReasoningEfforts: [],
    });

    expect(definition.compat?.supportsReasoningEffort).toBe(false);
    expect(definition.compat?.supportedReasoningEfforts).toEqual([]);
  });

  it("omits supportedReasoningEfforts entirely when the source metadata is absent", () => {
    const definition = buildCodexModelDefinition({
      id: "gpt-5.4-instant",
      model: "gpt-5.4-instant",
      inputModalities: ["text"],
    });

    expect(definition.compat?.supportedReasoningEfforts).toBeUndefined();
  });

  it("preserves a non-empty supportedReasoningEfforts array", () => {
    const definition = buildCodexModelDefinition({
      id: "gpt-5.5",
      model: "gpt-5.5",
      inputModalities: ["text"],
      supportedReasoningEfforts: ["low", "medium"],
    });

    expect(definition.compat?.supportsReasoningEffort).toBe(true);
    expect(definition.compat?.supportedReasoningEfforts).toEqual(["low", "medium"]);
  });
});
