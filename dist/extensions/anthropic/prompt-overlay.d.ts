import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { Eu as ProviderSystemPromptContribution } from "../../types-D56T6DDo.js";
import { j as ConcisePromptOverlayMode } from "../../provider-model-shared-DeKJq9uC.js";

//#region extensions/anthropic/prompt-overlay.d.ts
/** A model id is Claude-family when its canonical identity starts with `claude-`. */
declare function isClaudeModelId(modelId?: string): boolean;
/** Resolve the configured Claude overlay mode; defaults to `concise` when unset. */
declare function resolveClaudePromptOverlayMode(config?: OpenClawConfig): ConcisePromptOverlayMode;
/** Build the concise contribution for Claude model ids, honoring the config toggle. */
declare function resolveAnthropicSystemPromptContribution(ctx: {
  config?: OpenClawConfig;
  modelId?: string;
}): ProviderSystemPromptContribution | undefined;
//#endregion
export { isClaudeModelId, resolveAnthropicSystemPromptContribution, resolveClaudePromptOverlayMode };