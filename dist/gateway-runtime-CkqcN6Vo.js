import "./net-DQvRbvSK.js";
import "./auth-Bxb2pq6O.js";
import "./client-Q56zSyDo.js";
import "./src-DRcmTQP7.js";
import "./operator-approvals-client-CvVty7Kt.js";
import "./gateway-rpc-CHsH0SYe.js";
import "./hosted-plugin-surface-url-Due-0lsI.js";
import "./plugin-node-capability-CKzWXnDM.js";
import "./node-command-policy-CwGRaGjV.js";
import "./nodes.helpers-Ce3vE7TE.js";
import "./startup-auth-DWuzOV0n.js";
//#region src/gateway/channel-status-patches.ts
/** Creates a connected-channel status patch with matching connection/event timestamps. */
function createConnectedChannelStatusPatch(at = Date.now()) {
	return {
		connected: true,
		lastConnectedAt: at,
		lastEventAt: at
	};
}
/** Creates a transport-activity patch for health/activity monitors. */
function createTransportActivityStatusPatch(at = Date.now()) {
	return { lastTransportActivityAt: at };
}
//#endregion
export { createTransportActivityStatusPatch as n, createConnectedChannelStatusPatch as t };
