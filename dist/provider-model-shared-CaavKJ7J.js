import { a as normalizeLowercaseStringOrEmpty, s as normalizeOptionalLowercaseString } from "./string-coerce-DW4mBlAt.js";
import { _ as uniqueStrings } from "./string-normalization-CRyoFBPt.js";
import { i as normalizeProviderId$1 } from "./provider-id-Dq06Bcx6.js";
import { n as normalizeGooglePreviewModelId$1, t as normalizeAntigravityPreviewModelId$1 } from "./provider-model-id-normalize-CkG5GiL_.js";
import "./src-DLURJ6q1.js";
import "./provider-claude-thinking-CrJ3dawf.js";
import "./gpt5-prompt-overlay-BdGuIGEH.js";
import "./provider-attribution-BbVL4O9a.js";
import { a as normalizeModelCompat } from "./provider-model-compat-DAxKSXFP.js";
import "./moonshot-thinking-CJBD7Bdh.js";
import { a as buildOpenAICompatibleReplayPolicy, c as resolveTaggedReasoningOutputMode, i as buildNativeAnthropicReplayPolicyForModel, l as sanitizeGoogleGeminiReplayHistory, n as buildGoogleGeminiReplayPolicy, o as buildPassthroughGeminiSanitizingReplayPolicy, r as buildHybridAnthropicOrOpenAIReplayPolicy, t as buildAnthropicReplayPolicyForModel } from "./provider-replay-helpers-DtVD32X4.js";
//#region src/agents/concise-interaction-overlay.ts
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
/** Shared, immutable contribution (built once; the text is static). */
const CONCISE_INTERACTION_CONTRIBUTION = {
	stablePrefix: `<output_contract>
Default to concise, dense replies; do not repeat the prompt.
Return the requested sections/order only; respect any per-section length limits.
For required JSON/SQL/XML/etc, output only that format.
</output_contract>
<confirmation_before_action>
If material ambiguity remains, ask a concise clarification and stop. Do not call tools or create an artifact until the user answers.
For a skill marked \`deterministic: true\`, any missing required input triggers clarification. A \`deterministic: false\` skill may proceed only with an assumption as the first user-visible line.
Use numbered \`1.\`, \`2.\`, \`3.\` lines. Keep the same question and option order for the same request.
Do not paraphrase supplied choices or required-input labels; copy their wording verbatim into the numbered lines.
</confirmation_before_action>`,
	sectionOverrides: { interaction_style: `## Interaction Style

Live chat, not a memo. Lead with the answer; short, natural, human. No long preambles, no walls of text, no restating the question.
Default to the shortest reply that fully answers. Prefer a couple of short paragraphs or a few bullets over exhaustive prose.
When a request has two or more plausible interpretations, or missing choices would materially change an action or artifact, do not choose an interpretation for the user. Before using tools or producing an artifact, ask one short numbered clarification block and wait for the user's answer.
For competing interpretations, give 2-4 concise numbered choices. If the user supplied candidate interpretations, copy each candidate's wording verbatim after its number; do not add labels or paraphrase it. For missing required inputs, ask each material question on one numbered line and copy required-input labels verbatim from SKILL.md. Keep question order stable: target/scope; source/template; included data or date range; output format/destination.
After reading an applicable SKILL.md, treat frontmatter \`deterministic: true\` as strict: if any required input is missing, ask and wait rather than inventing a default. For \`deterministic: false\`, a first-pass assumption is allowed only when labeled exactly like: "Assumption: X — reply with a different value to change it." Put that sentence on the first user-visible line, before any result, progress, or completion text.
If the request is unambiguous and required inputs are present, act without asking.
Expand fully only when the user asks for depth, or for code, exact data, or artifacts where completeness matters.
Be a warm, competent teammate: opinions when useful, no sycophancy, no filler ("Great question!"). If the user is wrong or a plan is risky, say so kindly and directly.` }
};
/**
* Normalize a configured overlay mode. `on`/`concise` enable the overlay;
* `off` disables it. Unknown values return undefined so callers can apply their
* own default.
*/
function normalizeConcisePromptOverlayMode(value) {
	const normalized = normalizeOptionalLowercaseString(value);
	if (normalized === "off") return "off";
	if (normalized === "on" || normalized === "concise") return "concise";
}
/**
* Return the concise interaction contribution when enabled, else undefined.
* The caller owns the enablement decision (model-family match + config toggle).
*/
function resolveConciseInteractionContribution(enabled) {
	return enabled ? CONCISE_INTERACTION_CONTRIBUTION : void 0;
}
//#endregion
//#region src/plugins/provider-model-helpers.ts
/** True when an id matches a normalized exact value or value prefix. */
function matchesExactOrPrefix(id, values) {
	const normalizedId = normalizeLowercaseStringOrEmpty(id);
	return values.some((value) => {
		const normalizedValue = normalizeLowercaseStringOrEmpty(value);
		return normalizedId === normalizedValue || normalizedId.startsWith(normalizedValue);
	});
}
/** Clones the first available template model and patches it for a dynamic model id. */
function cloneFirstTemplateModel(params) {
	const trimmedModelId = params.modelId.trim();
	for (const templateId of uniqueStrings(params.templateIds).filter(Boolean)) {
		const template = params.ctx.modelRegistry.find(params.providerId, templateId);
		if (!template) continue;
		return normalizeModelCompat({
			...template,
			id: trimmedModelId,
			name: trimmedModelId,
			...params.patch
		});
	}
}
//#endregion
//#region src/plugin-sdk/provider-model-shared.ts
/**
* Normalizes provider ids for config, catalog, and plugin-registry matching.
*/
function normalizeProviderId(provider) {
	return normalizeProviderId$1(provider);
}
function getModelProviderHint(modelId) {
	const trimmed = normalizeOptionalLowercaseString(modelId);
	if (!trimmed) return null;
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0) return null;
	return trimmed.slice(0, slashIndex) || null;
}
/** @deprecated Proxy provider-owned model helper; do not use from third-party plugins. */
function isProxyReasoningUnsupportedModelHint(modelId) {
	return getModelProviderHint(modelId) === "x-ai";
}
/**
* Normalizes Antigravity preview model ids to the canonical provider catalog form.
*/
function normalizeAntigravityPreviewModelId(id) {
	return normalizeAntigravityPreviewModelId$1(id);
}
/**
* Normalizes Google preview model ids to the canonical provider catalog form.
*/
function normalizeGooglePreviewModelId(id) {
	return normalizeGooglePreviewModelId$1(id);
}
/**
* Builds provider replay hooks for a known transcript/reasoning compatibility family.
*/
function buildProviderReplayFamilyHooks(options) {
	switch (options.family) {
		case "openai-compatible": {
			const policyOptions = {
				sanitizeToolCallIds: options.sanitizeToolCallIds,
				duplicateToolCallIdStyle: options.duplicateToolCallIdStyle,
				dropReasoningFromHistory: options.dropReasoningFromHistory
			};
			return { buildReplayPolicy: (ctx) => buildOpenAICompatibleReplayPolicy(ctx.modelApi, {
				...policyOptions,
				modelId: ctx.modelId
			}) };
		}
		case "anthropic-by-model": return { buildReplayPolicy: ({ modelId }) => buildAnthropicReplayPolicyForModel(modelId) };
		case "native-anthropic-by-model": return { buildReplayPolicy: ({ modelId }) => buildNativeAnthropicReplayPolicyForModel(modelId) };
		case "google-gemini": return {
			buildReplayPolicy: () => buildGoogleGeminiReplayPolicy(),
			sanitizeReplayHistory: (ctx) => sanitizeGoogleGeminiReplayHistory(ctx),
			resolveReasoningOutputMode: (_ctx) => resolveTaggedReasoningOutputMode()
		};
		case "passthrough-gemini": return { buildReplayPolicy: ({ modelId }) => buildPassthroughGeminiSanitizingReplayPolicy(modelId) };
		case "hybrid-anthropic-openai": return { buildReplayPolicy: (ctx) => buildHybridAnthropicOrOpenAIReplayPolicy(ctx, { anthropicModelDropThinkingBlocks: options.anthropicModelDropThinkingBlocks }) };
	}
	throw new Error("Unsupported provider replay family");
}
/** @deprecated Provider-owned replay hook shortcut; use local provider hooks instead. */
const OPENAI_COMPATIBLE_REPLAY_HOOKS = buildProviderReplayFamilyHooks({ family: "openai-compatible" });
/** @deprecated Anthropic provider-owned replay hook shortcut; use local provider hooks instead. */
const ANTHROPIC_BY_MODEL_REPLAY_HOOKS = buildProviderReplayFamilyHooks({ family: "anthropic-by-model" });
/** @deprecated Anthropic provider-owned replay hook shortcut; use local provider hooks instead. */
const NATIVE_ANTHROPIC_REPLAY_HOOKS = buildProviderReplayFamilyHooks({ family: "native-anthropic-by-model" });
/** @deprecated Google provider-owned replay hook shortcut; use local provider hooks instead. */
const PASSTHROUGH_GEMINI_REPLAY_HOOKS = buildProviderReplayFamilyHooks({ family: "passthrough-gemini" });
//#endregion
export { buildProviderReplayFamilyHooks as a, normalizeGooglePreviewModelId as c, matchesExactOrPrefix as d, normalizeConcisePromptOverlayMode as f, PASSTHROUGH_GEMINI_REPLAY_HOOKS as i, normalizeProviderId as l, NATIVE_ANTHROPIC_REPLAY_HOOKS as n, isProxyReasoningUnsupportedModelHint as o, resolveConciseInteractionContribution as p, OPENAI_COMPATIBLE_REPLAY_HOOKS as r, normalizeAntigravityPreviewModelId as s, ANTHROPIC_BY_MODEL_REPLAY_HOOKS as t, cloneFirstTemplateModel as u };
