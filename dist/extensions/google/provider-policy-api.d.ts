import { f as ModelProviderConfig } from "../../types.models-BR3lnAaF.js";
import { Cu as ProviderThinkingProfile } from "../../types-D56T6DDo.js";
import { wt as ProviderDefaultThinkingPolicyContext } from "../../plugin-entry-4jbCdZgF.js";
//#region extensions/google/provider-policy-api.d.ts
declare function normalizeConfig(params: {
  provider: string;
  providerConfig: ModelProviderConfig;
}): ModelProviderConfig;
declare function resolveThinkingProfile(context: ProviderDefaultThinkingPolicyContext): ProviderThinkingProfile | undefined;
//#endregion
export { normalizeConfig, resolveThinkingProfile };