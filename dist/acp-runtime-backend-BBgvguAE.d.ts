import { ct as PluginHookReplyDispatchResult, ot as PluginHookReplyDispatchContext, st as PluginHookReplyDispatchEvent } from "./hook-types--ykqULrc.js";
//#region src/plugin-sdk/acp-runtime-backend.d.ts
/**
 * Dispatch a plugin reply hook through ACP when the event targets an ACP-bound session.
 * Returns a handled result only when ACP consumes the reply; otherwise callers continue normal delivery.
 */
declare function tryDispatchAcpReplyHook(event: PluginHookReplyDispatchEvent, ctx: PluginHookReplyDispatchContext): Promise<PluginHookReplyDispatchResult | void>;
//#endregion
export { tryDispatchAcpReplyHook as t };