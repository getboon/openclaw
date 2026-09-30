import { t as definePluginEntry } from "../../plugin-entry-BZpzqykQ.js";
import { r as resolvePluginConfigObject } from "../../plugin-config-runtime-Dq_6_b5X.js";
import { n as buildProviderToolCompatFamilyHooks } from "../../provider-tools-VmwDm8UA.js";
import { t as buildOpenAIImageGenerationProvider } from "../../image-generation-provider-u0gy66Ed.js";
import { t as openaiMediaUnderstandingProvider } from "../../media-understanding-provider-D4F1PEOx.js";
import { t as openAiMemoryEmbeddingProviderAdapter } from "../../memory-embedding-adapter-CZgxEtXw.js";
import { i as buildOpenAIProvider } from "../../openai-provider-Ddg6oIHG.js";
import { a as resolveOpenAISystemPromptContribution, i as resolveOpenAIPromptOverlayMode } from "../../prompt-overlay-Dbk2deTr.js";
import { t as buildOpenAIRealtimeTranscriptionProvider } from "../../realtime-transcription-provider-BMxmQrxI.js";
import { t as buildOpenAIRealtimeVoiceProvider } from "../../realtime-voice-provider-COolTCBs.js";
import { t as buildOpenAISpeechProvider } from "../../speech-provider-BjYgCi7Z.js";
import { t as buildOpenAIVideoGenerationProvider } from "../../video-generation-provider-LCmWuIWN.js";
//#region extensions/openai/index.ts
var openai_default = definePluginEntry({
	id: "openai",
	name: "OpenAI Provider",
	description: "Bundled OpenAI provider plugins",
	register(api) {
		const openAIToolCompatHooks = buildProviderToolCompatFamilyHooks("openai");
		const buildProviderWithPromptContribution = (provider) => ({
			...provider,
			...openAIToolCompatHooks,
			resolveSystemPromptContribution: (ctx) => {
				const pluginConfig = resolvePluginConfigObject(ctx.config, "openai") ?? (ctx.config ? void 0 : api.pluginConfig);
				return resolveOpenAISystemPromptContribution({
					config: ctx.config,
					legacyPluginConfig: pluginConfig,
					mode: resolveOpenAIPromptOverlayMode(pluginConfig),
					modelProviderId: provider.id,
					modelId: ctx.modelId,
					trigger: ctx.trigger
				});
			}
		});
		api.registerProvider(buildProviderWithPromptContribution(buildOpenAIProvider()));
		api.registerMemoryEmbeddingProvider(openAiMemoryEmbeddingProviderAdapter);
		api.registerImageGenerationProvider(buildOpenAIImageGenerationProvider());
		api.registerRealtimeTranscriptionProvider(buildOpenAIRealtimeTranscriptionProvider());
		api.registerRealtimeVoiceProvider(buildOpenAIRealtimeVoiceProvider());
		api.registerSpeechProvider(buildOpenAISpeechProvider());
		api.registerMediaUnderstandingProvider(openaiMediaUnderstandingProvider);
		api.registerVideoGenerationProvider(buildOpenAIVideoGenerationProvider());
	}
});
//#endregion
export { openai_default as default };
