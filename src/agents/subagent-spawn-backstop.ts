import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { InputProvenance } from "../sessions/input-provenance.js";
import {
  evaluateConsecutiveFailureCap,
  getConsecutiveFailureStreakResetAt,
  markConsecutiveFailureStreakReset,
} from "./subagent-consecutive-failures.js";
import { listSubagentRunsForRequester } from "./subagent-registry.js";

/**
 * Consecutive-failure backstop for sessions_spawn. Returns the refusal message once the
 * requester session has hit `agents.defaults.subagents.maxConsecutiveFailures`, else null.
 *
 * `requesterSessionKey` must be the key child runs are registered under (the completion owner).
 * A new user turn restarts the streak once per requester turn: ordinary messages carry no
 * provenance marker, while completion wakes (`inter_session`) and internal handoffs
 * (`internal_system`) keep counting — so silent re-spawn loops stay bounded.
 */
export function resolveSpawnFailureBackstop(params: {
  cfg: OpenClawConfig;
  requesterSessionKey: string;
  provenanceKind?: InputProvenance["kind"];
  requesterTurnRunId?: string;
}): string | null {
  const { requesterSessionKey } = params;
  const cap = params.cfg.agents?.defaults?.subagents?.maxConsecutiveFailures;
  if (cap === undefined || cap <= 0) {
    return null;
  }
  if (params.provenanceKind === undefined || params.provenanceKind === "external_user") {
    markConsecutiveFailureStreakReset(requesterSessionKey, Date.now(), params.requesterTurnRunId);
  }
  return evaluateConsecutiveFailureCap({
    runs: listSubagentRunsForRequester(requesterSessionKey),
    cap,
    sinceMs: getConsecutiveFailureStreakResetAt(requesterSessionKey),
  });
}
