import { i as buildModelAliasIndex } from "./model-selection-shared-C60V6sdg.js";
import { c as resolveDefaultModelForAgent } from "./model-selection-T0_OyR5c.js";
//#region src/auto-reply/reply/directive-handling.defaults.ts
/** Resolve default provider/model plus alias index for directive parsing. */
function resolveDefaultModel(params) {
	const mainModel = resolveDefaultModelForAgent({
		cfg: params.cfg,
		agentId: params.agentId,
		allowPluginNormalization: false
	});
	const defaultProvider = mainModel.provider;
	return {
		defaultProvider,
		defaultModel: mainModel.model,
		aliasIndex: buildModelAliasIndex({
			cfg: params.cfg,
			defaultProvider,
			allowPluginNormalization: false
		})
	};
}
//#endregion
export { resolveDefaultModel as t };
