import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { qa as HookContext } from "./types-EobE1w4i.js";
import { r as AnyAgentTool } from "./common-D8MzL0GX.js";
import { n as ToolSearchCatalogToolExecutor, t as ToolSearchCatalogRef } from "./tool-search-DeRtbXee.js";

//#region src/agents/harness/tool-surface-bridge.d.ts
type AgentHarnessToolSurfaceRuntime = {
  codeModeControlsEnabled: boolean;
  compactTools: (tools: AnyAgentTool[], options?: {
    hookContext?: HookContext;
  }) => {
    tools: AnyAgentTool[];
  };
  config: OpenClawConfig | undefined;
  includeToolSearchControls: boolean;
  runtimeToolAllowlist: string[] | undefined;
  toolSearchCatalogRef: ToolSearchCatalogRef | undefined;
  toolSearchControlsEnabled: boolean;
  cleanup: () => void;
  toolSearchCatalogExecutor: ToolSearchCatalogToolExecutor | undefined;
};
declare function createAgentHarnessToolSurfaceRuntime(params: {
  abortSignal?: AbortSignal;
  agentId?: string;
  config?: OpenClawConfig;
  disableTools?: boolean;
  executeTool: ToolSearchCatalogToolExecutor;
  forceMessageTool?: boolean;
  isRawModelRun?: boolean;
  modelToolsEnabled: boolean;
  prompt?: string;
  runId?: string;
  runtimeToolAllowlist?: readonly string[];
  sessionId?: string;
  sessionKey?: string;
  sourceReplyDeliveryMode?: string;
  toolsAllow?: readonly string[];
}): AgentHarnessToolSurfaceRuntime;
//#endregion
export { type AgentHarnessToolSurfaceRuntime, createAgentHarnessToolSurfaceRuntime };