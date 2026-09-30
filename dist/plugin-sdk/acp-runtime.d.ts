import { An as AcpRuntimeTurnAttachment, Cn as AcpRuntimeEnsureInput, Mn as AcpRuntimeTurnResult, Nn as AcpRuntimeTurnResultError, On as AcpRuntimeStatus, Pn as AcpSessionUpdateTag, Sn as AcpRuntimeDoctorReport, Tn as AcpRuntimeHandle, bn as AcpRuntime, jn as AcpRuntimeTurnInput, kn as AcpRuntimeTurn, wn as AcpRuntimeEvent, xn as AcpRuntimeCapabilities } from "./types.openclaw-B8P7XeUR.js";
import { a as unregisterAcpRuntimeBackend, c as isAcpRuntimeError, i as requireAcpRuntimeBackend, n as getAcpRuntimeBackend, o as AcpRuntimeError, r as registerAcpRuntimeBackend, s as AcpRuntimeErrorCode, t as AcpRuntimeBackend } from "./registry-DycdDmHe.js";
import { tryDispatchAcpReplyHook } from "./acp-runtime-backend.js";
import { i as readAcpSessionEntry, r as AcpSessionStoreEntry } from "./manager.core-BTJvn0-A.js";
import { t as getAcpSessionManager } from "./manager-RWEOeIYZ.js";

//#region src/plugin-sdk/acp-runtime.d.ts
/** Lazy ACP test helper facade combining control-plane and runtime registry helpers. */
declare const testing: {
  resetAcpSessionManagerForTests(): void;
  setAcpSessionManagerForTests(manager: unknown): void;
} & {
  resetAcpRuntimeBackendsForTests(): void;
  getAcpRuntimeRegistryGlobalStateForTests(): {
    backendsById: Map<string, AcpRuntimeBackend>;
  };
};
//#endregion
export { type AcpRuntime, type AcpRuntimeCapabilities, type AcpRuntimeDoctorReport, type AcpRuntimeEnsureInput, AcpRuntimeError, type AcpRuntimeErrorCode, type AcpRuntimeEvent, type AcpRuntimeHandle, type AcpRuntimeStatus, type AcpRuntimeTurn, type AcpRuntimeTurnAttachment, type AcpRuntimeTurnInput, type AcpRuntimeTurnResult, type AcpRuntimeTurnResultError, type AcpSessionStoreEntry, type AcpSessionUpdateTag, testing as __testing, testing, getAcpRuntimeBackend, getAcpSessionManager, isAcpRuntimeError, readAcpSessionEntry, registerAcpRuntimeBackend, requireAcpRuntimeBackend, tryDispatchAcpReplyHook, unregisterAcpRuntimeBackend };