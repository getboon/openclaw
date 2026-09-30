import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { T as ChannelMeta, c as ChannelCapabilities, g as ChannelLogSink, r as ChannelAccountSnapshot, v as ChannelMessageActionAdapter, y as ChannelMessageActionContext } from "../../types.core-9OlsJj7i.js";
import { n as RuntimeEnv } from "../../runtime-Bxifh4bY.js";
import { i as WizardPrompter } from "../../prompts-DgKIGa-v.js";
import { L as ChannelResolveKind, R as ChannelResolveResult, U as ChannelStatusAdapter, k as ChannelGatewayContext } from "../../types.adapters-mGCVHD_U.js";
import { b as OutboundDeliveryResult, i as ChannelOutboundContext, n as ChannelOutboundAdapter } from "../../outbound.types-DboaPG_c.js";
import { t as ChannelPlugin } from "../../types.plugin-CpPPGIEZ.js";
import { $n as PluginRuntime } from "../../types-D56T6DDo.js";
import { t as twitchPlugin } from "../../plugin-Dp8oQFns.js";

//#region extensions/twitch/src/runtime.d.ts
declare const setTwitchRuntime: (next: PluginRuntime) => void, getTwitchRuntime: () => PluginRuntime;
//#endregion
export { type ChannelAccountSnapshot, type ChannelCapabilities, type ChannelGatewayContext, type ChannelLogSink, type ChannelMessageActionAdapter, type ChannelMessageActionContext, type ChannelMeta, type ChannelOutboundAdapter, type ChannelOutboundContext, type ChannelPlugin, type ChannelResolveKind, type ChannelResolveResult, type ChannelStatusAdapter, type OpenClawConfig, type OutboundDeliveryResult, type RuntimeEnv, type WizardPrompter, setTwitchRuntime, twitchPlugin };