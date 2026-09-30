import { f as AgentToolResult, p as AgentToolUpdateCallback } from "./types-B0a9yDjE.js";
import { r as AnyAgentTool } from "./common-D8MzL0GX.js";
import { Dr as ToolDefinition } from "./index-fY6rcxyE.js";
import { t as PluginToolMcpMeta } from "./tools-PZtZsoWU.js";

//#region src/agents/tool-search.d.ts
type CatalogSource = "openclaw" | "mcp" | "client";
type CatalogTool = AnyAgentTool | ToolDefinition;
type ToolSearchCatalogToolExecutor = (params: {
  tool: CatalogTool;
  toolName: string;
  source: CatalogSource;
  sourceName?: string;
  toolCallId: string;
  parentToolCallId?: string;
  input: unknown;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
}) => Promise<AgentToolResult<unknown>>;
/** Catalog entry retained behind compacted Tool Search control tools. */
type ToolSearchCatalogEntry = {
  id: string;
  source: CatalogSource;
  sourceName?: string;
  mcp?: PluginToolMcpMeta;
  name: string;
  label?: string;
  description: string;
  parameters?: unknown;
  tool: CatalogTool;
};
type ToolSearchCatalogSession = {
  entries: ToolSearchCatalogEntry[];
  searchCount: number;
  describeCount: number;
  callCount: number;
};
type ToolSearchCatalogRef = {
  current?: ToolSearchCatalogSession;
};
//#endregion
export { ToolSearchCatalogToolExecutor as n, ToolSearchCatalogRef as t };