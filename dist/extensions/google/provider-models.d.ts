import { wu as ProviderRuntimeModel } from "../../types-D56T6DDo.js";
import { Kt as ProviderResolveDynamicModelContext } from "../../plugin-entry-4jbCdZgF.js";

//#region extensions/google/provider-models.d.ts
declare function resolveGoogleGeminiForwardCompatModel(params: {
  providerId: string;
  templateProviderId?: string;
  ctx: ProviderResolveDynamicModelContext;
}): ProviderRuntimeModel | undefined;
declare function isModernGoogleModel(modelId: string): boolean;
//#endregion
export { isModernGoogleModel, resolveGoogleGeminiForwardCompatModel };