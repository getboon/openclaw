import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { f as ModelProviderConfig } from "../../types.models-BR3lnAaF.js";
import { Cu as ProviderThinkingProfile } from "../../types-D56T6DDo.js";
import { t as applyAnthropicConfigDefaults } from "../../config-defaults-av6WYmk7.js";
//#region extensions/anthropic/provider-policy-api.d.ts
/** Normalize Anthropic provider config without importing runtime registration. */
declare function normalizeConfig(params: {
  provider: string;
  providerConfig: ModelProviderConfig;
}): ModelProviderConfig;
/** Apply Anthropic config defaults through the provider-policy seam. */
declare function applyConfigDefaults(params: Parameters<typeof applyAnthropicConfigDefaults>[0]): OpenClawConfig;
/** Resolve Claude thinking profile for Anthropic or Claude CLI providers. */
declare function resolveThinkingProfile(params: {
  provider: string;
  modelId: string;
  params?: Record<string, unknown>;
}): {
  readonly levels: readonly [{
    readonly id: "off";
  }];
  readonly defaultLevel: "off";
} | ProviderThinkingProfile | null;
//#endregion
export { applyConfigDefaults, normalizeConfig, resolveThinkingProfile };