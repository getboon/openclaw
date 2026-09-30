import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { s as AuthProfileStore } from "./types-CeqjEVI1.js";
import { a as ImageGenerationProviderPlugin, ju as resolveApiKeyForProvider$1 } from "./types-EobE1w4i.js";
import { t as FallbackAttempt } from "./model-fallback.types-BQ6oK-f5.js";
import { n as createSubsystemLogger } from "./subsystem-Boo2DQIV.js";
import { n as getProviderEnvVars } from "./provider-env-vars-B1Q2qBRu.js";
import { _ as ImageGenerationSourceImage, d as ImageGenerationProviderConfiguredContext, f as ImageGenerationProviderOptions, g as ImageGenerationResult, h as ImageGenerationResolution, l as ImageGenerationProvider, m as ImageGenerationRequest, t as GeneratedImageAsset } from "./types-DnRz4lon.js";
import { n as isFailoverError, t as describeFailoverError } from "./failover-error-Cj4HK72q.js";
import { p as throwCapabilityGenerationFailure, r as buildNoCapabilityModelConfiguredMessage, s as resolveCapabilityModelCandidates } from "./runtime-shared-BK2h7132.js";
import { n as resolveAgentModelPrimaryValue, t as resolveAgentModelFallbackValues } from "./model-input-CkMbo366.js";
import { n as listImageGenerationProviders, t as getImageGenerationProvider } from "./provider-registry-BpyZDAXg.js";
import { l as normalizeGooglePreviewModelId } from "./provider-model-shared-BMJ8oDGb.js";

//#region src/plugin-sdk/image-generation-core.auth.runtime.d.ts
declare namespace image_generation_core_auth_runtime_d_exports {
  export { resolveApiKeyForProvider$1 as resolveApiKeyForProvider };
}
//#endregion
//#region src/image-generation/model-ref.d.ts
declare function parseImageGenerationModelRef(raw: string | undefined): {
  provider: string;
  model: string;
} | null;
//#endregion
//#region src/plugin-sdk/image-generation-core.d.ts
/** Default OpenAI image model used when image-generation provider config omits one. */
declare const OPENAI_DEFAULT_IMAGE_MODEL = "gpt-image-2";
type ImageGenerationCoreAuthRuntimeModule = typeof image_generation_core_auth_runtime_d_exports;
/** Resolve image-generation provider API keys through the lazy auth runtime helper. */
declare function resolveApiKeyForProvider(...args: Parameters<ImageGenerationCoreAuthRuntimeModule["resolveApiKeyForProvider"]>): Promise<Awaited<ReturnType<ImageGenerationCoreAuthRuntimeModule["resolveApiKeyForProvider"]>>>;
//#endregion
export { type AuthProfileStore, type FallbackAttempt, type GeneratedImageAsset, type ImageGenerationProvider, type ImageGenerationProviderConfiguredContext, type ImageGenerationProviderOptions, type ImageGenerationProviderPlugin, type ImageGenerationRequest, type ImageGenerationResolution, type ImageGenerationResult, type ImageGenerationSourceImage, OPENAI_DEFAULT_IMAGE_MODEL, type OpenClawConfig, buildNoCapabilityModelConfiguredMessage, createSubsystemLogger, describeFailoverError, getImageGenerationProvider, getProviderEnvVars, isFailoverError, listImageGenerationProviders, normalizeGooglePreviewModelId as normalizeGoogleModelId, parseImageGenerationModelRef, resolveAgentModelFallbackValues, resolveAgentModelPrimaryValue, resolveApiKeyForProvider, resolveCapabilityModelCandidates, throwCapabilityGenerationFailure };