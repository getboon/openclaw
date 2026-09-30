import { S as findModelInCatalog } from "./model-selection-shared-C60V6sdg.js";
import { c as resolveDefaultModelForAgent } from "./model-selection-T0_OyR5c.js";
import { i as modelSupportsVision, n as loadModelCatalog } from "./model-catalog-DRusVNLz.js";
import "./agent-runtime-BOwt4Q-z.js";
//#region extensions/telegram/src/sticker-vision.runtime.ts
async function resolveStickerVisionSupportRuntime(params) {
	const catalog = await loadModelCatalog({ config: params.cfg });
	const defaultModel = resolveDefaultModelForAgent({
		cfg: params.cfg,
		agentId: params.agentId
	});
	const entry = findModelInCatalog(catalog, defaultModel.provider, defaultModel.model);
	if (!entry) return false;
	return modelSupportsVision(entry);
}
//#endregion
export { resolveStickerVisionSupportRuntime };
