/**
 * Anthropic concise chat overlay wiring.
 *
 * Claude models get no interaction-style guidance from core (the section is
 * empty by default) and the GPT-5 overlay is OpenAI-family only. This supplies
 * the shared concise, guided-choice overlay for Claude model ids, toggleable
 * via `agents.defaults.promptOverlays.claude.personality`.
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import {
  type ConcisePromptOverlayMode,
  normalizeConcisePromptOverlayMode,
  resolveClaudeModelIdentity,
  resolveConciseInteractionContribution,
} from "openclaw/plugin-sdk/provider-model-shared";

/** A model id is Claude-family when its canonical identity starts with `claude-`. */
export function isClaudeModelId(modelId?: string): boolean {
  if (!modelId) {
    return false;
  }
  return resolveClaudeModelIdentity({ id: modelId }).startsWith("claude-");
}

/** Resolve the configured Claude overlay mode; defaults to `concise` when unset. */
export function resolveClaudePromptOverlayMode(config?: OpenClawConfig): ConcisePromptOverlayMode {
  return (
    normalizeConcisePromptOverlayMode(
      config?.agents?.defaults?.promptOverlays?.claude?.personality,
    ) ?? "concise"
  );
}

/** Build the concise contribution for Claude model ids, honoring the config toggle. */
export function resolveAnthropicSystemPromptContribution(ctx: {
  config?: OpenClawConfig;
  modelId?: string;
}) {
  const enabled =
    isClaudeModelId(ctx.modelId) && resolveClaudePromptOverlayMode(ctx.config) !== "off";
  return resolveConciseInteractionContribution(enabled);
}
