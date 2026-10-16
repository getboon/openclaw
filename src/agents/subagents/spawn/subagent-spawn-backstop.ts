import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { listSubagentRunsForRequester } from "../registry/subagent-registry-read.js";
import {
  evaluateConsecutiveFailureCap,
  getConsecutiveFailureStreakResetAt,
  markConsecutiveFailureStreakReset,
} from "./consecutive-failure-cap.js";
import type { SpawnSubagentContext } from "./subagent-spawn-contract.js";

/**
 * Consecutive-failure backstop for sessions_spawn. Returns the refusal message once the
 * requester session has hit `agents.defaults.subagents.maxConsecutiveFailures`, else null.
 *
 * A new user turn restarts the streak once per requester turn: ordinary messages carry no
 * provenance marker, while completion wakes (`inter_session`) and internal handoffs
 * (`internal_system`) keep counting — so silent re-spawn loops stay bounded.
 */
export function resolveSpawnFailureBackstop(params: {
  cfg: OpenClawConfig;
  ctx: SpawnSubagentContext;
  requesterAgentId: string;
}): string | null {
  const { cfg, ctx } = params;
  const requesterSessionKey = ctx.agentSessionKey;
  if (!requesterSessionKey) {
    return null;
  }
  const kind = ctx.requesterInputProvenanceKind;
  if (kind === undefined || kind === "external_user") {
    markConsecutiveFailureStreakReset(requesterSessionKey, Date.now(), ctx.requesterTurnRunId);
  }
  return evaluateConsecutiveFailureCap({
    runs: listSubagentRunsForRequester(requesterSessionKey, {
      requesterAgentId: params.requesterAgentId,
    }),
    cap: cfg.agents?.defaults?.subagents?.maxConsecutiveFailures,
    sinceMs: getConsecutiveFailureStreakResetAt(requesterSessionKey),
  });
}
