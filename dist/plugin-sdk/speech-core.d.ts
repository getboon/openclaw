import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { l as normalizeOptionalString } from "./string-coerce-DJnd-JG-.js";
import { $c as SpeechProviderResolveTalkConfigContext, Bc as TTS_AUTO_MODES, Gc as SpeechModelOverridePolicy, Hc as SpeechDirectiveTokenParseContext, Ic as ResolvedTtsConfig, Kc as SpeechProviderConfig, Lc as ResolvedTtsModelOverrides, Qc as SpeechProviderResolveConfigContext, Rc as TtsConfigResolutionContext, Uc as SpeechDirectiveTokenParseResult, Uu as requireApiKey, Vc as normalizeTtsAutoMode, Wc as SpeechListVoicesRequest, Xc as SpeechProviderPrepareSynthesisContext, Yc as SpeechProviderOverrides, Zc as SpeechProviderPreparedSynthesis, al as SpeechTelephonySynthesisRequest, cl as TtsDirectiveParseResult, el as SpeechProviderResolveTalkOverridesContext, il as SpeechSynthesisTarget, mu as prepareSimpleCompletionModel, nl as SpeechSynthesisStreamRequest, ol as SpeechVoiceOption, qc as SpeechProviderConfiguredContext, qn as SpeechProviderPlugin, rl as SpeechSynthesisStreamResult, sl as TtsDirectiveOverrides, tl as SpeechSynthesisRequest, zc as resolveEffectiveTtsConfig } from "./types-EobE1w4i.js";
import { t as asBoolean } from "./boolean-CThIQsGO.js";
import { r as completeSimple } from "./stream-Dxz9ZAff.js";
import { o as asFiniteNumber } from "./number-coercion-Ds_8dOjj.js";
import { a as createProviderHttpError, c as formatProviderErrorPayload, g as truncateErrorDetail, h as readResponseTextLimited, l as formatProviderHttpErrorMessage, o as extractProviderErrorDetail, r as assertOkOrThrowProviderError, s as extractProviderRequestId, t as asObject } from "./provider-http-errors-CYg0W8L9.js";
import { a as normalizeSpeechProviderId, c as normalizeLanguageCode, d as scheduleCleanup, i as listSpeechProviders, l as normalizeSeed, n as getSpeechProvider, o as parseTtsDirectives, r as listLoadedSpeechProviders, s as normalizeApplyTextNormalization, t as canonicalizeSpeechProviderId, u as requireInRange } from "./provider-registry-DCRzGNl0.js";

//#region src/tts/tts-core.d.ts
type SummarizeTextDeps = {
  completeSimple: typeof completeSimple;
  prepareSimpleCompletionModel: typeof prepareSimpleCompletionModel;
  requireApiKey: typeof requireApiKey;
};
type SummarizeResult = {
  summary: string;
  latencyMs: number;
  inputLength: number;
  outputLength: number;
};
/** Summarize long text before synthesis using the configured summary model. */
declare function summarizeText(params: {
  text: string;
  targetLength: number;
  cfg: OpenClawConfig;
  config: ResolvedTtsConfig;
  timeoutMs: number;
}, deps?: SummarizeTextDeps): Promise<SummarizeResult>;
//#endregion
//#region src/tts/directive-number.d.ts
/** Numeric directive parsing shared by speech providers with bounded knobs. */
type DirectiveNumberRange = {
  min?: number;
  max?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
};
/** Parse a numeric speech directive token and return provider overrides when policy allows it. */
declare function parseSpeechDirectiveNumberOverride(params: {
  ctx: SpeechDirectiveTokenParseContext;
  overrideKey: string;
  range: DirectiveNumberRange;
  warning: (value: string) => string;
  mergeCurrentOverrides?: boolean;
}): SpeechDirectiveTokenParseResult;
//#endregion
export { type ResolvedTtsConfig, type ResolvedTtsModelOverrides, type SpeechDirectiveTokenParseContext, type SpeechDirectiveTokenParseResult, type SpeechListVoicesRequest, type SpeechModelOverridePolicy, type SpeechProviderConfig, type SpeechProviderConfiguredContext, type SpeechProviderOverrides, type SpeechProviderPlugin, type SpeechProviderPrepareSynthesisContext, type SpeechProviderPreparedSynthesis, type SpeechProviderResolveConfigContext, type SpeechProviderResolveTalkConfigContext, type SpeechProviderResolveTalkOverridesContext, type SpeechSynthesisRequest, type SpeechSynthesisStreamRequest, type SpeechSynthesisStreamResult, type SpeechSynthesisTarget, type SpeechTelephonySynthesisRequest, type SpeechVoiceOption, TTS_AUTO_MODES, type TtsConfigResolutionContext, type TtsDirectiveOverrides, type TtsDirectiveParseResult, asBoolean, asFiniteNumber, asObject, assertOkOrThrowProviderError, canonicalizeSpeechProviderId, createProviderHttpError, extractProviderErrorDetail, extractProviderRequestId, formatProviderErrorPayload, formatProviderHttpErrorMessage, getSpeechProvider, listLoadedSpeechProviders, listSpeechProviders, normalizeApplyTextNormalization, normalizeLanguageCode, normalizeSeed, normalizeSpeechProviderId, normalizeTtsAutoMode, parseSpeechDirectiveNumberOverride, parseTtsDirectives, readResponseTextLimited, requireInRange, resolveEffectiveTtsConfig, scheduleCleanup, summarizeText, normalizeOptionalString as trimToUndefined, truncateErrorDetail };