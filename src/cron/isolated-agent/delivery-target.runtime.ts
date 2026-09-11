/** Runtime-loaded channel target helpers used by cron delivery resolution. */
import type { ChannelId } from "../../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveOutboundChannelPlugin } from "../../infra/outbound/channel-resolution.js";
import {
  resolveOutboundSessionRoute,
  type OutboundSessionRoute,
} from "../../infra/outbound/outbound-session.js";
import { unknownTargetError } from "../../infra/outbound/target-errors.js";
import {
  resolveChannelTarget,
  type ResolvedMessagingTarget,
} from "../../infra/outbound/target-resolver.js";
export { getLoadedChannelPluginForRead } from "../../channels/plugins/registry-loaded-read.js";
export { mapAllowFromEntries } from "../../plugin-sdk/channel-config-helpers.js";
export { resolveFirstBoundAccountId } from "../../routing/bound-account-read.js";

/** Resolves a cron delivery target through channel plugins with bootstrap allowed. */
export async function resolveChannelTargetForDelivery(params: {
  cfg: OpenClawConfig;
  channel: ChannelId;
  input: string;
  accountId?: string | null;
}): Promise<{ ok: true; target: ResolvedMessagingTarget } | { ok: false; error: Error }> {
  // Delivery may be the first channel touch after startup; allow bootstrap so
  // plugin config and account metadata are available before target resolution.
  const plugin = resolveOutboundChannelPlugin({
    channel: params.channel,
    cfg: params.cfg,
    allowBootstrap: true,
  });
  try {
    const resolved = await resolveChannelTarget({
      cfg: params.cfg,
      channel: params.channel,
      input: params.input,
      accountId: params.accountId,
      unknownTargetMode: "normalized",
    });
    // A delivery target is operator-typed config, so an unresolved passthrough
    // the channel's own grammar disowns is a misconfiguration: surface it here
    // instead of deferring to a downstream contract check on another subsystem.
    const looksLikeId = plugin?.messaging?.targetResolver?.looksLikeId;
    if (
      resolved.ok &&
      resolved.target.resolutionSource === "normalized" &&
      looksLikeId &&
      !looksLikeId(params.input, resolved.target.to)
    ) {
      return {
        ok: false,
        error: unknownTargetError(
          plugin?.meta?.label ?? params.channel,
          params.input,
          plugin?.messaging?.targetResolver?.hint,
        ),
      };
    }
    return resolved;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/** Resolves the outbound session route used for cron delivery threading and mirrors. */
export async function resolveOutboundSessionRouteForDelivery(params: {
  cfg: OpenClawConfig;
  channel: ChannelId;
  agentId: string;
  accountId?: string | null;
  target: string;
  resolvedTarget?: ResolvedMessagingTarget;
  threadId?: string | number | null;
  currentSessionKey?: string;
}): Promise<OutboundSessionRoute | null> {
  // Route lookup also bootstraps the plugin so canonical thread/session mapping
  // matches the send-time channel runtime.
  resolveOutboundChannelPlugin({
    channel: params.channel,
    cfg: params.cfg,
    allowBootstrap: true,
  });
  return await resolveOutboundSessionRoute(params);
}

/** Returns whether a channel can canonicalize outbound cron delivery sessions. */
export function channelCanResolveOutboundSessionRoute(params: {
  cfg: OpenClawConfig;
  channel: ChannelId;
}): boolean {
  return Boolean(
    resolveOutboundChannelPlugin({
      channel: params.channel,
      cfg: params.cfg,
      allowBootstrap: true,
    })?.messaging?.resolveOutboundSessionRoute,
  );
}
