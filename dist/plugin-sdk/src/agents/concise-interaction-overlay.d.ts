import type { ProviderSystemPromptContribution } from "./system-prompt-contribution.js";
export type ConcisePromptOverlayMode = "concise" | "off";
/**
 * Normalize a configured overlay mode. `on`/`concise` enable the overlay;
 * `off` disables it. Unknown values return undefined so callers can apply their
 * own default.
 */
export declare function normalizeConcisePromptOverlayMode(value: unknown): ConcisePromptOverlayMode | undefined;
/**
 * Return the concise interaction contribution when enabled, else undefined.
 * The caller owns the enablement decision (model-family match + config toggle).
 */
export declare function resolveConciseInteractionContribution(enabled: boolean): ProviderSystemPromptContribution | undefined;
