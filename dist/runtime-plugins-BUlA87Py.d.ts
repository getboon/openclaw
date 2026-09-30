import { i as OpenClawConfig } from "./types.openclaw-C5-5RYY-.js";

//#region src/agents/runtime-plugins.d.ts
/** Ensure standalone runtime plugins are loaded for the current agent context. */
declare function ensureRuntimePluginsLoaded(params: {
  config?: OpenClawConfig;
  workspaceDir?: string | null;
  allowGatewaySubagentBinding?: boolean;
}): void;
//#endregion
export { ensureRuntimePluginsLoaded as t };