/** Resolves the configured audience for user-facing operational/error copy. */
import type { MessageAudience } from "./types.agent-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

/**
 * Resolve the configured message audience. Defaults to "operator" (raw
 * diagnostic copy) so existing/upstream deployments keep their current behavior
 * on upgrade; any unset or unexpected value collapses to "operator". Boon-style
 * end-user deployments opt in with `agents.defaults.messaging.audience:
 * "consumer"` to get plain-language fallback/error copy.
 */
export function resolveMessageAudience(cfg?: OpenClawConfig): MessageAudience {
  return cfg?.agents?.defaults?.messaging?.audience === "consumer" ? "consumer" : "operator";
}
