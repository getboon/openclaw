import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { cn as ProviderPlugin } from "../../types-D56T6DDo.js";
import { m as matchesExactOrPrefix, p as cloneFirstTemplateModel } from "../../provider-model-shared-DeKJq9uC.js";
import { u as findCatalogTemplate } from "../../provider-catalog-shared-HpaPaN3Q.js";

//#region extensions/openai/shared.d.ts
type SyntheticOpenAIModelCatalogCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
type SyntheticOpenAIModelCatalogEntry = {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  contextTokens?: number;
  cost?: SyntheticOpenAIModelCatalogCost;
};
declare const OPENAI_DEFAULT_RUNTIME_CONTEXT_TOKENS = 272000;
declare function toOpenAIDataUrl(buffer: Buffer, mimeType: string): string;
declare function resolveConfiguredOpenAIBaseUrl(cfg: OpenClawConfig | undefined): string;
type OpenAIResponsesProviderHooks = Pick<ProviderPlugin, "buildReplayPolicy" | "prepareExtraParams" | "wrapStreamFn" | "resolveTransportTurnState" | "resolveWebSocketSessionPolicy">;
declare function buildOpenAIResponsesProviderHooks(options?: {
  transport?: "auto" | "sse" | "websocket";
}): OpenAIResponsesProviderHooks;
declare function buildOpenAISyntheticCatalogEntry(template: ReturnType<typeof findCatalogTemplate>, entry: {
  id: string;
  reasoning: boolean;
  input: readonly ("text" | "image")[];
  contextWindow: number;
  contextTokens?: number;
  cost?: SyntheticOpenAIModelCatalogCost;
}): SyntheticOpenAIModelCatalogEntry | undefined;
//#endregion
export { OPENAI_DEFAULT_RUNTIME_CONTEXT_TOKENS, buildOpenAIResponsesProviderHooks, buildOpenAISyntheticCatalogEntry, cloneFirstTemplateModel, findCatalogTemplate, matchesExactOrPrefix, resolveConfiguredOpenAIBaseUrl, toOpenAIDataUrl };