import { l as resolveClaudeModelIdentity } from "./src-DLURJ6q1.js";
import { f as normalizeConcisePromptOverlayMode, p as resolveConciseInteractionContribution } from "./provider-model-shared-CaavKJ7J.js";
//#region extensions/anthropic/prompt-overlay.ts
/** A model id is Claude-family when its canonical identity starts with `claude-`. */
function isClaudeModelId(modelId) {
	if (!modelId) return false;
	return resolveClaudeModelIdentity({ id: modelId }).startsWith("claude-");
}
/** Resolve the configured Claude overlay mode; defaults to `concise` when unset. */
function resolveClaudePromptOverlayMode(config) {
	return normalizeConcisePromptOverlayMode(config?.agents?.defaults?.promptOverlays?.claude?.personality) ?? "concise";
}
/** Build the concise contribution for Claude model ids, honoring the config toggle. */
function resolveAnthropicSystemPromptContribution(ctx) {
	return resolveConciseInteractionContribution(isClaudeModelId(ctx.modelId) && resolveClaudePromptOverlayMode(ctx.config) !== "off");
}
//#endregion
export { resolveAnthropicSystemPromptContribution as n, resolveClaudePromptOverlayMode as r, isClaudeModelId as t };
