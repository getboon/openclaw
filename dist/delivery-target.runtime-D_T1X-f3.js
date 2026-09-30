import { t as getLoadedChannelPluginForRead } from "./registry-loaded-read-kWBL-Dpo.js";
import { r as resolveOutboundChannelPlugin } from "./channel-resolution-l3MY-I-Q.js";
import { m as mapAllowFromEntries } from "./channel-config-helpers-CMg35hQR.js";
import { n as resolveOutboundSessionRoute } from "./outbound-session-Tsf5GxfO.js";
import { i as resolveChannelTarget } from "./target-resolver-DdhAc-cJ.js";
import { i as unknownTargetError } from "./target-errors-U6xazVDr.js";
import { t as resolveFirstBoundAccountId } from "./bound-account-read-CHa5YRYG.js";
//#region src/cron/isolated-agent/delivery-target.runtime.ts
/** Resolves a cron delivery target through channel plugins with bootstrap allowed. */
async function resolveChannelTargetForDelivery(params) {
	const plugin = resolveOutboundChannelPlugin({
		channel: params.channel,
		cfg: params.cfg,
		allowBootstrap: true
	});
	try {
		const resolved = await resolveChannelTarget({
			cfg: params.cfg,
			channel: params.channel,
			input: params.input,
			accountId: params.accountId,
			unknownTargetMode: "normalized"
		});
		const looksLikeId = plugin?.messaging?.targetResolver?.looksLikeId;
		if (resolved.ok && resolved.target.resolutionSource === "normalized" && looksLikeId && !looksLikeId(params.input, resolved.target.to)) return {
			ok: false,
			error: unknownTargetError(plugin?.meta?.label ?? params.channel, params.input, plugin?.messaging?.targetResolver?.hint)
		};
		return resolved;
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err))
		};
	}
}
/** Resolves the outbound session route used for cron delivery threading and mirrors. */
async function resolveOutboundSessionRouteForDelivery(params) {
	resolveOutboundChannelPlugin({
		channel: params.channel,
		cfg: params.cfg,
		allowBootstrap: true
	});
	return await resolveOutboundSessionRoute(params);
}
/** Returns whether a channel can canonicalize outbound cron delivery sessions. */
function channelCanResolveOutboundSessionRoute(params) {
	return Boolean(resolveOutboundChannelPlugin({
		channel: params.channel,
		cfg: params.cfg,
		allowBootstrap: true
	})?.messaging?.resolveOutboundSessionRoute);
}
//#endregion
export { channelCanResolveOutboundSessionRoute, getLoadedChannelPluginForRead, mapAllowFromEntries, resolveChannelTargetForDelivery, resolveFirstBoundAccountId, resolveOutboundSessionRouteForDelivery };
