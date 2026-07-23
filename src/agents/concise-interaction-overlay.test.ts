import { describe, expect, it } from "vitest";
import {
  normalizeConcisePromptOverlayMode,
  resolveConciseInteractionContribution,
} from "./concise-interaction-overlay.js";

describe("normalizeConcisePromptOverlayMode", () => {
  it("maps on/concise to concise and off to off", () => {
    expect(normalizeConcisePromptOverlayMode("on")).toBe("concise");
    expect(normalizeConcisePromptOverlayMode("concise")).toBe("concise");
    expect(normalizeConcisePromptOverlayMode("OFF")).toBe("off");
  });

  it("returns undefined for unknown values", () => {
    expect(normalizeConcisePromptOverlayMode("friendly")).toBeUndefined();
    expect(normalizeConcisePromptOverlayMode(undefined)).toBeUndefined();
  });
});

describe("resolveConciseInteractionContribution", () => {
  it("supplies the concise interaction style and behavior contract when enabled", () => {
    const contribution = resolveConciseInteractionContribution(true);
    expect(contribution?.sectionOverrides?.interaction_style).toContain("shortest reply");
    expect(contribution?.sectionOverrides?.interaction_style).toContain("A, B, or C");
    expect(contribution?.stablePrefix).toContain("concise");
  });

  it("returns undefined when disabled", () => {
    expect(resolveConciseInteractionContribution(false)).toBeUndefined();
  });
});
