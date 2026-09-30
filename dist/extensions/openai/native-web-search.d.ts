import { i as OpenClawConfig } from "../../types.openclaw-C5-5RYY-.js";
import { T as StreamFn } from "../../types-B0a9yDjE.js";
//#region extensions/openai/native-web-search.d.ts
type OpenAINativeWebSearchPatchResult = "payload_not_object" | "native_tool_already_present" | "injected";
declare function patchOpenAINativeWebSearchPayload(payload: unknown): OpenAINativeWebSearchPatchResult;
declare function createOpenAINativeWebSearchWrapper(baseStreamFn: StreamFn | undefined, params: {
  config?: OpenClawConfig;
  agentId?: string;
  nativeWebSearchAllowedByToolPolicy?: boolean;
}): StreamFn;
//#endregion
export { createOpenAINativeWebSearchWrapper, patchOpenAINativeWebSearchPayload };