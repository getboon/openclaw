import { An as AcpRuntimeTurnAttachment, Cn as AcpRuntimeEnsureInput, Mn as AcpRuntimeTurnResult, Nn as AcpRuntimeTurnResultError, On as AcpRuntimeStatus, Pn as AcpSessionUpdateTag, Sn as AcpRuntimeDoctorReport, Tn as AcpRuntimeHandle, bn as AcpRuntime, jn as AcpRuntimeTurnInput, kn as AcpRuntimeTurn, wn as AcpRuntimeEvent, xn as AcpRuntimeCapabilities } from "./types.openclaw-B8P7XeUR.js";
import { ct as PluginHookReplyDispatchResult, ot as PluginHookReplyDispatchContext, st as PluginHookReplyDispatchEvent } from "./hook-types-DJzI2ddc.js";
import { a as unregisterAcpRuntimeBackend, c as isAcpRuntimeError, i as requireAcpRuntimeBackend, n as getAcpRuntimeBackend, o as AcpRuntimeError, r as registerAcpRuntimeBackend, s as AcpRuntimeErrorCode } from "./registry-DycdDmHe.js";

//#region src/plugin-sdk/acp-runtime-backend.d.ts
/**
 * Dispatch a plugin reply hook through ACP when the event targets an ACP-bound session.
 * Returns a handled result only when ACP consumes the reply; otherwise callers continue normal delivery.
 */
declare function tryDispatchAcpReplyHook(event: PluginHookReplyDispatchEvent, ctx: PluginHookReplyDispatchContext): Promise<PluginHookReplyDispatchResult | void>;
//#endregion
export { type AcpRuntime, type AcpRuntimeCapabilities, type AcpRuntimeDoctorReport, type AcpRuntimeEnsureInput, AcpRuntimeError, type AcpRuntimeErrorCode, type AcpRuntimeEvent, type AcpRuntimeHandle, type AcpRuntimeStatus, type AcpRuntimeTurn, type AcpRuntimeTurnAttachment, type AcpRuntimeTurnInput, type AcpRuntimeTurnResult, type AcpRuntimeTurnResultError, type AcpSessionUpdateTag, getAcpRuntimeBackend, isAcpRuntimeError, registerAcpRuntimeBackend, requireAcpRuntimeBackend, tryDispatchAcpReplyHook, unregisterAcpRuntimeBackend };