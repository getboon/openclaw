import { m as ModelProviderDeclarationConfig } from "./types.models-BR3lnAaF.js";
import { a as LiveModelCatalogFetchGuard } from "./provider-catalog-live-runtime-DPNyh-IX.js";

//#region extensions/xai/provider-catalog.d.ts
declare function buildXaiProvider(api?: ModelProviderDeclarationConfig["api"]): ModelProviderDeclarationConfig;
declare function buildLiveXaiProvider(params: {
  apiKey?: string;
  discoveryApiKey?: string;
  fetchGuard?: LiveModelCatalogFetchGuard;
  signal?: AbortSignal;
}): Promise<ModelProviderDeclarationConfig>;
declare function buildLiveXaiOAuthProvider(params: {
  discoveryApiKey: string;
  fetchGuard?: LiveModelCatalogFetchGuard;
  signal?: AbortSignal;
}): Promise<ModelProviderDeclarationConfig>;
//#endregion
export { buildLiveXaiProvider as n, buildXaiProvider as r, buildLiveXaiOAuthProvider as t };