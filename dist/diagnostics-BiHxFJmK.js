import { n as getDiagnosticStabilitySnapshot, r as normalizeDiagnosticStabilityQuery } from "./diagnostic-stability-CMMTTYlc.js";
import { mn as errorShape, pn as ErrorCodes } from "./schema-DpZf2_En.js";
import "./src-DRcmTQP7.js";
//#region src/gateway/server-methods/diagnostics.ts
/** Gateway handler for payload-free stability diagnostics. */
const diagnosticsHandlers = { "diagnostics.stability": async ({ params, respond }) => {
	try {
		respond(true, getDiagnosticStabilitySnapshot(normalizeDiagnosticStabilityQuery(params)), void 0);
	} catch (err) {
		respond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : "invalid diagnostics.stability params"));
	}
} };
//#endregion
export { diagnosticsHandlers };
