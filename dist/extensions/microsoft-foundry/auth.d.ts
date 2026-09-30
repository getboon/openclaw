import { mt as ProviderAuthMethod } from "../../plugin-entry-4jbCdZgF.js";
//#region extensions/microsoft-foundry/auth.d.ts
declare function shouldTestFoundryTextConnection(params: {
  modelId: string;
  modelNameHint?: string | null;
}): boolean;
declare const entraIdAuthMethod: ProviderAuthMethod;
declare const apiKeyAuthMethod: ProviderAuthMethod;
//#endregion
export { apiKeyAuthMethod, entraIdAuthMethod, shouldTestFoundryTextConnection };