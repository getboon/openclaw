import { mn as errorShape, pn as ErrorCodes } from "./schema-DpZf2_En.js";
import { ct as validateModelsListParams, t as formatValidationErrors } from "./src-DRcmTQP7.js";
import { t as buildModelsListResult } from "./models-list-result-Cvk_4JC0.js";
//#region src/gateway/server-methods/models.ts
const modelsHandlers = { "models.list": async ({ params, respond, context }) => {
	if (!validateModelsListParams(params)) {
		respond(false, void 0, errorShape(ErrorCodes.INVALID_REQUEST, `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`));
		return;
	}
	try {
		respond(true, await buildModelsListResult({
			context,
			params
		}), void 0);
	} catch (err) {
		respond(false, void 0, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
	}
} };
//#endregion
export { buildModelsListResult, modelsHandlers };
