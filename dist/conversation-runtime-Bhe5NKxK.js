import "./session-binding-service-5GUH85NA.js";
import "./conversation-binding-OvjVm0dW.js";
import "./thread-bindings-policy-BuAqqIlL.js";
import "./channel-access-compat-BiOOwD8S.js";
import "./binding-registry-CpJgDdCN.js";
import "./session-DEiuF15N.js";
import "./pairing-store-B7JEYNb1.js";
import "./binding-targets-hylm8i8X.js";
import "./binding-routing-Bkmi70iN.js";
import "./pairing-labels-CrMaAnZ8.js";
//#region src/channels/session-meta.ts
let inboundSessionRuntimePromise = null;
function loadInboundSessionRuntime() {
	inboundSessionRuntimePromise ??= import("./inbound.runtime.js");
	return inboundSessionRuntimePromise;
}
/**
* Best-effort inbound session metadata recorder for channel plugin command handlers.
*/
async function recordInboundSessionMetaSafe(params) {
	const runtime = await loadInboundSessionRuntime();
	const storePath = runtime.resolveStorePath(params.cfg.session?.store, { agentId: params.agentId });
	try {
		await runtime.recordSessionMetaFromInbound({
			storePath,
			sessionKey: params.sessionKey,
			ctx: params.ctx
		});
	} catch (err) {
		params.onError?.(err);
	}
}
//#endregion
export { recordInboundSessionMetaSafe as t };
