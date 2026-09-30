/** Canonicalizes cron session keys into agent-scoped session-store keys. */
import { canonicalizeMainSessionAlias } from "../../config/sessions/main-session.js";
import type { SessionScope } from "../../config/sessions/types.js";
import { toAgentStoreSessionKey } from "../../routing/session-key.js";

/** Resolves a cron session key into the canonical agent-scoped session-store key. */
export function resolveCronAgentSessionKey(params: {
  sessionKey: string;
  agentId: string;
  mainKey?: string | undefined;
  cfg?: { session?: { scope?: SessionScope; mainKey?: string } };
}): string {
  const trimmed = params.sessionKey.trim();
  // Global-scope agents route every peer/channel through the literal "global"
  // bucket (see deriveSessionKey/canonicalizeSessionKeyForAgent), bypassing
  // per-agent prefixing entirely. toAgentStoreSessionKey below doesn't know
  // about that literal-key bypass and would mangle "global" into a synthetic
  // "agent:<id>:global" key nothing ever writes to, orphaning a global-scope
  // cron job's own sessionKey from the real shared session file.
  if (params.cfg?.session?.scope === "global" && trimmed.toLowerCase() === "global") {
    return "global";
  }
  const raw = toAgentStoreSessionKey({
    agentId: params.agentId,
    requestKey: trimmed,
    mainKey: params.mainKey,
  });
  // Canonicalize so "agent:<id>:main" → "agent:<id>:<configuredMainKey>"
  // when cfg.session.mainKey differs from "main". Without this, cron sessions
  // are orphaned when read paths use the configured mainKey alias (#29683).
  return canonicalizeMainSessionAlias({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: raw,
  });
}
