import type { ChannelMessageActionName, ChannelThreadingToolContext } from "../../channels/plugins/types.public.js";
/**
 * Whether a resolved action target came from the agent's own args or was
 * injected from the live inbound tool context (the current conversation).
 * A tool-context target is core's own inference, not something the agent
 * typed — resolution failures for it must be softened differently than a
 * target the agent explicitly chose (see `resolveActionTarget`).
 */
export type MessageActionTargetSource = "agent" | "tool-context";
export type NormalizedMessageActionInput = {
    args: Record<string, unknown>;
    targetSource: MessageActionTargetSource;
};
/** Normalizes message-action args before target validation and dispatch. */
export declare function normalizeMessageActionInput(params: {
    action: ChannelMessageActionName;
    args: Record<string, unknown>;
    toolContext?: ChannelThreadingToolContext;
}): NormalizedMessageActionInput;
