import "./agent-scope-XIomFVd1.js";
import { a as resolveAgentDir, o as resolveAgentWorkspaceDir } from "./agent-scope-config-DrIvffiJ.js";
import { n as DEFAULT_MODEL, r as DEFAULT_PROVIDER } from "./defaults-CdX9UGcX.js";
import { S as loadSessionStore, g as saveSessionStore, v as updateSessionStore, y as updateSessionStoreEntry } from "./store-Duo8PvDp.js";
import { a as resolveSessionFilePath, d as resolveStorePath } from "./paths-DfUJ_nbS.js";
import { t as resolveThinkingDefault } from "./model-thinking-default-B6xLYcgM.js";
import "./model-selection-T0_OyR5c.js";
import { d as ensureAgentWorkspace } from "./workspace-yCxMVt4A.js";
import { t as resolveAgentTimeoutMs } from "./timeout-Dkg1h8AH.js";
import "./sessions-CVRGkIiy.js";
import { n as resolveAgentIdentity } from "./identity-CF_ut3YD.js";
import { t as runEmbeddedAgent } from "./embedded-agent-j_F-jh2D.js";
//#region src/extensionAPI.ts
if (process.env.VITEST !== "true" && process.env.OPENCLAW_SUPPRESS_EXTENSION_API_WARNING !== "1") process.emitWarning("openclaw/extension-api is deprecated. Migrate to api.runtime.agent.* or focused openclaw/plugin-sdk/<subpath> imports. See https://docs.openclaw.ai/plugins/sdk-migration", {
	code: "OPENCLAW_EXTENSION_API_DEPRECATED",
	detail: "This compatibility bridge is temporary. Bundled plugins should use the injected plugin runtime instead of importing host-side agent helpers directly. Migration guide: https://docs.openclaw.ai/plugins/sdk-migration"
});
//#endregion
export { DEFAULT_MODEL, DEFAULT_PROVIDER, ensureAgentWorkspace, loadSessionStore, resolveAgentDir, resolveAgentIdentity, resolveAgentTimeoutMs, resolveAgentWorkspaceDir, resolveSessionFilePath, resolveStorePath, resolveThinkingDefault, runEmbeddedAgent, runEmbeddedAgent as runEmbeddedPiAgent, saveSessionStore, updateSessionStore, updateSessionStoreEntry };
