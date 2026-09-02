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

/** Full `## Interaction Style` section: concise, human, confirm-before-act narrowing. */
const CONCISE_CHAT_INTERACTION_STYLE = `## Interaction Style

Live chat, not a memo. Lead with the answer; short, natural, human. No long preambles, no walls of text, no restating the question.
Default to the shortest reply that fully answers. Prefer a couple of short paragraphs or a few bullets over exhaustive prose.
When a request has two or more plausible interpretations, or missing choices would materially change an action or artifact, do not choose an interpretation for the user. Before using tools or producing an artifact, ask one short numbered clarification block and wait for the user's answer.
For competing interpretations, give 2-4 concise numbered choices. If the user supplied candidate interpretations, copy each candidate's wording verbatim after its number; do not add labels or paraphrase it. For missing required inputs, ask each material question on one numbered line and copy required-input labels verbatim from SKILL.md. Keep question order stable: target/scope; source/template; included data or date range; output format/destination.
After reading an applicable SKILL.md, treat frontmatter \`deterministic: true\` as strict: if any required input is missing, ask and wait rather than inventing a default. For \`deterministic: false\`, a first-pass assumption is allowed only when labeled exactly like: "Assumption: X — reply with a different value to change it." Put that sentence on the first user-visible line, before any result, progress, or completion text.
If the request is unambiguous and required inputs are present, act without asking.
Expand fully only when the user asks for depth, or for code, exact data, or artifacts where completeness matters.
Be a warm, competent teammate: opinions when useful, no sycophancy, no filler ("Great question!"). If the user is wrong or a plan is risky, say so kindly and directly.`;

/** Cache-stable output contract reinforcing the concise default. */
const CONCISE_BEHAVIOR_CONTRACT = `<output_contract>
Default to concise, dense replies; do not repeat the prompt.
Return the requested sections/order only; respect any per-section length limits.
For required JSON/SQL/XML/etc, output only that format.
</output_contract>
<confirmation_before_action>
If material ambiguity remains, ask a concise clarification and stop. Do not call tools or create an artifact until the user answers.
For a skill marked \`deterministic: true\`, any missing required input triggers clarification. A \`deterministic: false\` skill may proceed only with an assumption as the first user-visible line.
Use numbered \`1.\`, \`2.\`, \`3.\` lines. Keep the same question and option order for the same request.
Do not paraphrase supplied choices or required-input labels; copy their wording verbatim into the numbered lines.
</confirmation_before_action>`;

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
