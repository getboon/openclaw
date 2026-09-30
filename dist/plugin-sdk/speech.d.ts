import { l as normalizeOptionalString } from "./string-coerce-DJnd-JG-.js";
import { $c as SpeechProviderResolveTalkConfigContext, Bc as TTS_AUTO_MODES, Gc as SpeechModelOverridePolicy, Hc as SpeechDirectiveTokenParseContext, Kc as SpeechProviderConfig, Qc as SpeechProviderResolveConfigContext, Uc as SpeechDirectiveTokenParseResult, Vc as normalizeTtsAutoMode, Wc as SpeechListVoicesRequest, Xc as SpeechProviderPrepareSynthesisContext, Yc as SpeechProviderOverrides, Zc as SpeechProviderPreparedSynthesis, al as SpeechTelephonySynthesisRequest, cl as TtsDirectiveParseResult, el as SpeechProviderResolveTalkOverridesContext, il as SpeechSynthesisTarget, nl as SpeechSynthesisStreamRequest, ol as SpeechVoiceOption, qc as SpeechProviderConfiguredContext, qn as SpeechProviderPlugin, rl as SpeechSynthesisStreamResult, sl as TtsDirectiveOverrides, tl as SpeechSynthesisRequest } from "./types-EobE1w4i.js";
import { t as asBoolean } from "./boolean-CThIQsGO.js";
import { o as asFiniteNumber } from "./number-coercion-Ds_8dOjj.js";
import { a as createProviderHttpError, c as formatProviderErrorPayload, g as truncateErrorDetail, h as readResponseTextLimited, l as formatProviderHttpErrorMessage, o as extractProviderErrorDetail, r as assertOkOrThrowProviderError, s as extractProviderRequestId, t as asObject } from "./provider-http-errors-CYg0W8L9.js";
import { a as normalizeSpeechProviderId, c as normalizeLanguageCode, d as scheduleCleanup, i as listSpeechProviders, l as normalizeSeed, n as getSpeechProvider, o as parseTtsDirectives, s as normalizeApplyTextNormalization, t as canonicalizeSpeechProviderId, u as requireInRange } from "./provider-registry-DCRzGNl0.js";

//#region src/tts/openai-compatible-speech-provider.d.ts
type OpenAiCompatibleSpeechProviderBaseConfig = {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  voice: string;
  speed?: number;
  responseFormat?: string;
};
/** Normalized config shape for OpenAI-compatible speech HTTP providers. */
type OpenAiCompatibleSpeechProviderConfig<ExtraConfig extends Record<string, unknown> = Record<string, never>> = OpenAiCompatibleSpeechProviderBaseConfig & ExtraConfig;
/** Base URL normalization policy for providers that share OpenAI-style endpoints. */
type OpenAiCompatibleSpeechProviderBaseUrlPolicy = {
  kind: "trim-trailing-slash";
} | {
  kind: "canonical";
  aliases?: readonly string[];
  allowCustom?: boolean;
};
/** Extra config field to forward into the JSON body under an optional request key. */
type OpenAiCompatibleSpeechProviderExtraJsonBodyField<ExtraConfig extends Record<string, unknown>> = {
  configKey: Extract<keyof ExtraConfig, string>;
  requestKey?: string;
};
/** Factory options for a speech provider backed by /audio/speech-compatible HTTP APIs. */
type OpenAiCompatibleSpeechProviderOptions<ExtraConfig extends Record<string, unknown> = Record<string, never>> = {
  id: string;
  label: string;
  autoSelectOrder: number;
  models: readonly string[];
  voices: readonly string[];
  defaultModel: string;
  defaultVoice: string;
  defaultBaseUrl: string;
  envKey: string;
  responseFormats: readonly string[];
  defaultResponseFormat: string;
  voiceCompatibleResponseFormats: readonly string[];
  baseUrlPolicy?: OpenAiCompatibleSpeechProviderBaseUrlPolicy;
  normalizeModel?: (value: string | undefined, fallback: string) => string;
  configKey?: string;
  extraHeaders?: Record<string, string>;
  readExtraConfig?: (raw: Record<string, unknown> | undefined) => ExtraConfig;
  extraJsonBodyFields?: readonly OpenAiCompatibleSpeechProviderExtraJsonBodyField<ExtraConfig>[];
  apiErrorLabel?: string;
  missingApiKeyError?: string;
};
/** Build a complete SpeechProviderPlugin for OpenAI-compatible speech endpoints. */
declare function createOpenAiCompatibleSpeechProvider<ExtraConfig extends Record<string, unknown> = Record<string, never>>(options: OpenAiCompatibleSpeechProviderOptions<ExtraConfig>): SpeechProviderPlugin;
//#endregion
export { type OpenAiCompatibleSpeechProviderBaseUrlPolicy, type OpenAiCompatibleSpeechProviderConfig, type OpenAiCompatibleSpeechProviderExtraJsonBodyField, type OpenAiCompatibleSpeechProviderOptions, type SpeechDirectiveTokenParseContext, type SpeechDirectiveTokenParseResult, type SpeechListVoicesRequest, type SpeechModelOverridePolicy, type SpeechProviderConfig, type SpeechProviderConfiguredContext, type SpeechProviderOverrides, type SpeechProviderPlugin, type SpeechProviderPrepareSynthesisContext, type SpeechProviderPreparedSynthesis, type SpeechProviderResolveConfigContext, type SpeechProviderResolveTalkConfigContext, type SpeechProviderResolveTalkOverridesContext, type SpeechSynthesisRequest, type SpeechSynthesisStreamRequest, type SpeechSynthesisStreamResult, type SpeechSynthesisTarget, type SpeechTelephonySynthesisRequest, type SpeechVoiceOption, TTS_AUTO_MODES, type TtsDirectiveOverrides, type TtsDirectiveParseResult, asBoolean, asFiniteNumber, asObject, assertOkOrThrowProviderError, canonicalizeSpeechProviderId, createOpenAiCompatibleSpeechProvider, createProviderHttpError, extractProviderErrorDetail, extractProviderRequestId, formatProviderErrorPayload, formatProviderHttpErrorMessage, getSpeechProvider, listSpeechProviders, normalizeApplyTextNormalization, normalizeLanguageCode, normalizeSeed, normalizeSpeechProviderId, normalizeTtsAutoMode, parseTtsDirectives, readResponseTextLimited, requireInRange, scheduleCleanup, normalizeOptionalString as trimToUndefined, truncateErrorDetail };