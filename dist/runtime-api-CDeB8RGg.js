import "./media-runtime-y612m5EI.js";
import "./text-chunking-DOIivPnH.js";
import { t as createPluginRuntimeStore } from "./runtime-store-uAKGMqTs.js";
import "./channel-outbound-GLSbUyRv.js";
import "./outbound-media-BTVEJw20.js";
import "./ssrf-runtime-BEA0pv1w.js";
import "./dangerous-name-runtime-cJriWyuh.js";
import "./channel-status-BcQsPXKC.js";
import "./bundled-channel-config-schema-Dn5ChHHK.js";
import "./channel-config-primitives-CaKLc5F2.js";
import "./channel-actions-CrwyzGhL.js";
import "./channel-inbound-ARD1gWKi.js";
import "./channel-feedback-DaTYJzoW.js";
import "./channel-pairing-juou-zVi.js";
import "./webhook-request-guards-pZ4NdrFg.js";
import "./webhook-ingress-CMhdrMqa.js";
import "./webhook-targets-4YHKWY_d.js";
//#region extensions/googlechat/src/runtime.ts
const { setRuntime: setGoogleChatRuntime, getRuntime: getGoogleChatRuntime } = createPluginRuntimeStore({
	pluginId: "googlechat",
	errorMessage: "Google Chat runtime not initialized"
});
//#endregion
export { setGoogleChatRuntime as n, getGoogleChatRuntime as t };
