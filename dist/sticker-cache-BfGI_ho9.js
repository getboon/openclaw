import { a as normalizeLowercaseStringOrEmpty } from "./string-coerce-DW4mBlAt.js";
import { r as logVerbose } from "./globals-C-cvQH14.js";
import { S as findModelInCatalog } from "./model-selection-shared-C60V6sdg.js";
import { c as resolveDefaultModelForAgent } from "./model-selection-T0_OyR5c.js";
import { i as modelSupportsVision, n as loadModelCatalog } from "./model-catalog-DRusVNLz.js";
import { d as resolveApiKeyForProvider } from "./model-auth-C_vXHDLC.js";
import { n as resolveAutoMediaKeyProviders, r as resolveDefaultMediaModel } from "./defaults-BGcdne45.js";
import "./media-runtime-y612m5EI.js";
import { r as resolveAutoImageModel } from "./runner-l3zmVb7d.js";
import "./runtime-env-WTHb2hRn.js";
import "./string-coerce-runtime-BiGbTN2j.js";
import "./agent-runtime-BOwt4Q-z.js";
import { n as getTelegramRuntime } from "./runtime-B_f_VNpK.js";
import "./sticker-cache-store-4mFi0t6r.js";
//#region extensions/telegram/src/sticker-cache.ts
const STICKER_DESCRIPTION_PROMPT = "Describe this sticker image in 1-2 sentences. Focus on what the sticker depicts (character, object, action, emotion). Be concise and objective.";
function isMinimaxVlmProvider(provider) {
	const normalized = normalizeLowercaseStringOrEmpty(provider);
	return normalized === "minimax" || normalized === "minimax-cn" || normalized === "minimax-portal" || normalized === "minimax-portal-cn";
}
/**
* Describe a sticker image using vision API.
* Auto-detects an available vision provider based on configured API keys.
* Returns null if no vision provider is available.
*/
async function describeStickerImage(params) {
	const { imagePath, cfg, agentDir, agentId } = params;
	const defaultModel = resolveDefaultModelForAgent({
		cfg,
		agentId
	});
	let activeModel = void 0;
	let catalog = [];
	try {
		catalog = await loadModelCatalog({ config: cfg });
		if (modelSupportsVision(findModelInCatalog(catalog, defaultModel.provider, defaultModel.model))) {
			const model = isMinimaxVlmProvider(defaultModel.provider) ? resolveDefaultMediaModel({
				cfg,
				providerId: defaultModel.provider,
				capability: "image",
				includeConfiguredImageModels: false
			}) : defaultModel.model;
			if (model) activeModel = {
				provider: defaultModel.provider,
				model
			};
		}
	} catch {}
	const hasProviderKey = async (provider) => {
		try {
			await resolveApiKeyForProvider({
				provider,
				cfg,
				agentDir
			});
			return true;
		} catch {
			return false;
		}
	};
	const autoProviders = resolveAutoMediaKeyProviders({
		cfg,
		capability: "image"
	});
	const selectCatalogModel = (provider) => {
		const entries = catalog.filter((entry) => normalizeLowercaseStringOrEmpty(entry.provider) === normalizeLowercaseStringOrEmpty(provider) && modelSupportsVision(entry));
		if (entries.length === 0) return;
		const defaultId = resolveDefaultMediaModel({
			cfg,
			providerId: provider,
			capability: "image",
			includeConfiguredImageModels: !isMinimaxVlmProvider(provider)
		});
		const preferred = entries.find((entry) => entry.id === defaultId);
		if (isMinimaxVlmProvider(provider)) return preferred;
		return preferred ?? entries[0];
	};
	let resolved = null;
	if (activeModel && autoProviders.includes(activeModel.provider) && await hasProviderKey(activeModel.provider)) resolved = activeModel;
	if (!resolved) for (const provider of autoProviders) {
		if (!await hasProviderKey(provider)) continue;
		const entry = selectCatalogModel(provider);
		if (entry) {
			resolved = {
				provider,
				model: entry.id
			};
			break;
		}
	}
	if (!resolved) resolved = await resolveAutoImageModel({
		cfg,
		agentDir,
		activeModel
	});
	if (!resolved?.model) {
		logVerbose("telegram: no vision provider available for sticker description");
		return null;
	}
	const { provider, model } = resolved;
	logVerbose(`telegram: describing sticker with ${provider}/${model}`);
	try {
		return (await getTelegramRuntime().mediaUnderstanding.describeImageFileWithModel({
			filePath: imagePath,
			mime: "image/webp",
			cfg,
			agentDir,
			provider,
			model,
			prompt: STICKER_DESCRIPTION_PROMPT,
			maxTokens: 150,
			timeoutMs: 3e4
		})).text ?? null;
	} catch (err) {
		logVerbose(`telegram: failed to describe sticker: ${String(err)}`);
		return null;
	}
}
//#endregion
export { describeStickerImage as t };
