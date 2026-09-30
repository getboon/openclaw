import { t as isApprovalNotFoundError } from "./approval-errors-DHiqam1A.js";
import "./error-runtime-DvwXOTIL.js";
import { t as resolveApprovalOverGateway } from "./approval-gateway-resolver-P_aY3DO4.js";
import "./approval-gateway-runtime-DlyzDJqQ.js";
//#region extensions/imessage/src/approval-resolver.ts
async function resolveIMessageApproval(params) {
	await resolveApprovalOverGateway({
		cfg: params.cfg,
		approvalId: params.approvalId,
		decision: params.decision,
		senderId: params.senderId,
		gatewayUrl: params.gatewayUrl,
		clientDisplayName: `iMessage approval (${params.senderId?.trim() || "unknown"})`
	});
}
//#endregion
export { isApprovalNotFoundError, resolveIMessageApproval };
