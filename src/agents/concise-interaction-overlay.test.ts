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
  it("requires clarification before acting on materially ambiguous requests", () => {
    const contribution = resolveConciseInteractionContribution(true);
    const interactionStyle = contribution?.sectionOverrides?.interaction_style ?? "";
    const stablePrefix = contribution?.stablePrefix ?? "";

    expect(interactionStyle).toContain("two or more plausible interpretations");
    expect(interactionStyle).toContain("Before using tools or producing an artifact");
    expect(interactionStyle).toContain("numbered clarification");
    expect(interactionStyle).toContain("wait for the user's answer");
    expect(stablePrefix).toContain("<confirmation_before_action>");
    expect(stablePrefix).toContain("Do not call tools");
  });

  it("honors deterministic skill frontmatter and labels creative assumptions before acting", () => {
    const contribution = resolveConciseInteractionContribution(true);
    const interactionStyle = contribution?.sectionOverrides?.interaction_style ?? "";
    const stablePrefix = contribution?.stablePrefix ?? "";

    expect(interactionStyle).toContain("deterministic: true");
    expect(interactionStyle).toContain("deterministic: false");
    expect(interactionStyle).toContain(
      "Assumption: X — reply with a different value to change it.",
    );
    expect(interactionStyle).toContain("first user-visible line");
    expect(stablePrefix).toContain("missing required input");
    expect(stablePrefix).toContain("numbered `1.`, `2.`, `3.` lines");
  });

  it("keeps repeated clarification wording stable by copying source labels verbatim", () => {
    const contribution = resolveConciseInteractionContribution(true);
    const interactionStyle = contribution?.sectionOverrides?.interaction_style ?? "";
    const stablePrefix = contribution?.stablePrefix ?? "";

    expect(interactionStyle).toContain("copy each candidate's wording verbatim");
    expect(interactionStyle).toContain("copy required-input labels verbatim from SKILL.md");
    expect(stablePrefix).toContain("Do not paraphrase supplied choices or required-input labels");
  });

  it("keeps complete requests action-oriented without the old act-first assumption rule", () => {
    const contribution = resolveConciseInteractionContribution(true);
    const interactionStyle = contribution?.sectionOverrides?.interaction_style ?? "";

    expect(interactionStyle).toContain(
      "If the request is unambiguous and required inputs are present, act without asking.",
    );
    expect(interactionStyle).not.toContain(
      "Make reasonable assumptions to unblock progress; state them briefly after acting.",
    );
  });

  it("returns undefined when disabled", () => {
    expect(resolveConciseInteractionContribution(false)).toBeUndefined();
  });
});
