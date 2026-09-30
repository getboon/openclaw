import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { r as ChannelConfigUiHint } from "./types.config-D1pSqbn8.js";
import { t as ChannelPlugin } from "./types.plugin-BzE3KHt2.js";
import { $n as PluginRuntime } from "./types-EobE1w4i.js";
import { r as buildChannelConfigSchema } from "./config-schema-Du8VXSmf.js";
import { r as parseOptionalDelimitedEntries } from "./helpers-DUC63aP9.js";
import { L as PluginCommandContext, g as OpenClawPluginApi } from "./plugin-entry-CPdKirQs.js";
import { t as clearAccountEntryFields } from "./config-helpers-BRUcPiDv.js";
import { c as tryReadSecretFileSync } from "./secret-file-CjbjgOXf.js";
import { a as buildThreadAwareOutboundSessionRoute, c as defineChannelPluginEntry, f as recoverCurrentThreadSessionId, i as buildChannelOutboundSessionRoute, l as defineSetupPluginEntry, m as stripTargetKindPrefix, o as createChannelPluginBase$1, p as stripChannelTargetPrefix, s as createChatChannelPlugin, t as ChannelOutboundSessionRouteParams } from "./core-D_zcPs50.js";

//#region src/plugin-sdk/channel-core.d.ts
/** Creates a channel plugin base while keeping the public import on this SDK subpath. */
declare const createChannelPluginBase: typeof createChannelPluginBase$1;
//#endregion
export { type ChannelConfigUiHint, type ChannelOutboundSessionRouteParams, type ChannelPlugin, type OpenClawConfig, type OpenClawPluginApi, type PluginCommandContext, type PluginRuntime, buildChannelConfigSchema, buildChannelOutboundSessionRoute, buildThreadAwareOutboundSessionRoute, clearAccountEntryFields, createChannelPluginBase, createChatChannelPlugin, defineChannelPluginEntry, defineSetupPluginEntry, parseOptionalDelimitedEntries, recoverCurrentThreadSessionId, stripChannelTargetPrefix, stripTargetKindPrefix, tryReadSecretFileSync };