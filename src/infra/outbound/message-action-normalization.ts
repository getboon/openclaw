// Message-action input normalization infers channel/target context and rewrites
// legacy target fields before dispatch validation.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type {
  ChannelMessageActionName,
  ChannelThreadingToolContext,
} from "../../channels/plugins/types.public.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { applyTargetToParams } from "./channel-target.js";
import {
  actionHasTarget,
  actionRequiresTarget,
  resolveActionDeliveryTargetAlias,
  type ActionDeliveryTargetAliasSpec,
} from "./message-action-spec.js";

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
export function normalizeMessageActionInput(params: {
  action: ChannelMessageActionName;
  args: Record<string, unknown>;
  toolContext?: ChannelThreadingToolContext;
  targetAliasSpec?: ActionDeliveryTargetAliasSpec;
}): NormalizedMessageActionInput {
  const normalizedArgs = { ...params.args };
  const { action, toolContext } = params;
  let targetSource: MessageActionTargetSource = "agent";
  const explicitChannel = normalizeOptionalString(normalizedArgs.channel) ?? "";
  const inferredChannel =
    explicitChannel || normalizeMessageChannel(toolContext?.currentChannelProvider) || "";

  const explicitTarget = normalizeOptionalString(normalizedArgs.target) ?? "";
  const hasLegacyTargetFields =
    typeof normalizedArgs.to === "string" || typeof normalizedArgs.channelId === "string";
  const hasLegacyTarget =
    (normalizeOptionalString(normalizedArgs.to) ?? "").length > 0 ||
    (normalizeOptionalString(normalizedArgs.channelId) ?? "").length > 0;
  const legacyTarget =
    normalizeOptionalString(normalizedArgs.to) ??
    normalizeOptionalString(normalizedArgs.channelId) ??
    "";
  const deliveryAliasTarget = resolveActionDeliveryTargetAlias(action, normalizedArgs, {
    channel: inferredChannel,
    aliasSpec: params.targetAliasSpec,
  });

  if (deliveryAliasTarget && explicitTarget && deliveryAliasTarget !== explicitTarget) {
    throw new Error(`Action ${action} received conflicting target and delivery alias values.`);
  }
  if (deliveryAliasTarget && legacyTarget && deliveryAliasTarget !== legacyTarget) {
    throw new Error(`Action ${action} received conflicting target and delivery alias values.`);
  }

  if (explicitTarget && hasLegacyTargetFields) {
    // Canonical `target` wins over old `to`/`channelId` aliases before validation.
    delete normalizedArgs.to;
    delete normalizedArgs.channelId;
  }

  if (!explicitTarget && !hasLegacyTarget && deliveryAliasTarget) {
    normalizedArgs.target = deliveryAliasTarget;
  }

  if (
    !explicitTarget &&
    !hasLegacyTarget &&
    !deliveryAliasTarget &&
    actionRequiresTarget(action) &&
    !actionHasTarget(action, normalizedArgs, { channel: inferredChannel })
  ) {
    const inferredTarget =
      normalizeOptionalString(toolContext?.currentChannelId) ??
      normalizeOptionalString(toolContext?.currentMessagingTarget);
    if (inferredTarget) {
      normalizedArgs.target = inferredTarget;
      targetSource = "tool-context";
    }
  }

  if (!explicitTarget && actionRequiresTarget(action) && hasLegacyTarget) {
    if (legacyTarget) {
      normalizedArgs.target = legacyTarget;
      delete normalizedArgs.to;
      delete normalizedArgs.channelId;
    }
  }

  if (!explicitChannel) {
    if (inferredChannel && isDeliverableMessageChannel(inferredChannel)) {
      normalizedArgs.channel = inferredChannel;
    }
  }

  applyTargetToParams({ action, args: normalizedArgs });
  if (
    actionRequiresTarget(action) &&
    !actionHasTarget(action, normalizedArgs, { channel: inferredChannel })
  ) {
    throw new Error(`Action ${action} requires a target.`);
  }

  return { args: normalizedArgs, targetSource };
}
