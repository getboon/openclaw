/**
 * Provider-agnostic concise interaction-style overlay.
 *
 * The core system prompt ships an empty `interaction_style` section: tone and
 * verbosity guidance only reaches the model through a provider system-prompt
 * contribution. Non-GPT-5 families (notably Claude) therefore get NO
 * conciseness guidance unless their provider plugin supplies one. This overlay
 * is that guidance — a short, guided-choice chat style a provider plugin opts
 * into for its model family.
 */
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { ProviderSystemPromptContribution } from "./system-prompt-contribution.js";

/** Full `## Interaction Style` section: concise, human, guided-choice narrowing. */
const CONCISE_CHAT_INTERACTION_STYLE = `## Interaction Style

Live chat, not a memo. Lead with the answer; short, natural, human. No long preambles, no walls of text, no restating the question.
Default to the shortest reply that fully answers. Prefer a couple of short paragraphs or a few bullets over exhaustive prose.
When a request could branch several ways, or a complete answer would be long: give the direct answer to the most likely intent, then offer a short guided choice ("Want me to go deeper on A, B, or C?") instead of elaborating every branch up front. Keep it to ~2-4 clearly labeled options.
Expand fully only when the user asks for depth, or for code, exact data, or artifacts where completeness matters.
Be a warm, competent teammate: opinions when useful, no sycophancy, no filler ("Great question!"). If the user is wrong or a plan is risky, say so kindly and directly.
Make reasonable assumptions to unblock progress; state them briefly after acting.`;

/** Cache-stable output contract reinforcing the concise default. */
const CONCISE_BEHAVIOR_CONTRACT = `<output_contract>
Default to concise, dense replies; do not repeat the prompt.
Return the requested sections/order only; respect any per-section length limits.
For required JSON/SQL/XML/etc, output only that format.
</output_contract>`;

/** Shared, immutable contribution (built once; the text is static). */
const CONCISE_INTERACTION_CONTRIBUTION: ProviderSystemPromptContribution = {
  stablePrefix: CONCISE_BEHAVIOR_CONTRACT,
  sectionOverrides: { interaction_style: CONCISE_CHAT_INTERACTION_STYLE },
};

export type ConcisePromptOverlayMode = "concise" | "off";

/**
 * Normalize a configured overlay mode. `on`/`concise` enable the overlay;
 * `off` disables it. Unknown values return undefined so callers can apply their
 * own default.
 */
export function normalizeConcisePromptOverlayMode(
  value: unknown,
): ConcisePromptOverlayMode | undefined {
  const normalized = normalizeOptionalLowercaseString(value);
  if (normalized === "off") {
    return "off";
  }
  if (normalized === "on" || normalized === "concise") {
    return "concise";
  }
  return undefined;
}

/**
 * Return the concise interaction contribution when enabled, else undefined.
 * The caller owns the enablement decision (model-family match + config toggle).
 */
export function resolveConciseInteractionContribution(
  enabled: boolean,
): ProviderSystemPromptContribution | undefined {
  return enabled ? CONCISE_INTERACTION_CONTRIBUTION : undefined;
}
