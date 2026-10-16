import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";

/**
 * Backstop for repeated sub-agent failures within one requester session.
 * Block further spawns after consecutive terminal failures; successes and in-flight or
 * parallel (collector/swarm) runs do not count. The streak restarts once per new user turn.
 */

const FAILURE_STATUSES = new Set(["error", "timeout", "unknown"]);
const DEFAULT_MAX_LISTED_ATTEMPTS = 5;

function trailingFailureStreak(runs: readonly SubagentRunRecord[]): number {
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const status = runs[i]?.execution?.outcome?.status;
    if (status && FAILURE_STATUSES.has(status)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function formatRunEntries(runs: readonly SubagentRunRecord[], max: number): string {
  return runs
    .slice(-max)
    .map((r) => {
      const name = r.taskName?.trim() ? r.taskName : "(unlabeled)";
      const status = r.execution?.outcome?.status ?? "unknown";
      return `'${name}' (${status})`;
    })
    .join(", ");
}

/**
 * Admission decision for a sub-agent spawn. Returns a user-facing error message when the
 * parent session has hit the consecutive-failure cap (the caller refuses the spawn and the
 * agent surfaces the message), or `null` when the spawn may proceed (always, when `cap` is
 * unset or 0).
 *
 * `runs` is the parent session's child runs from `listSubagentRunsForRequester` (any order);
 * `sinceMs` is when the current user turn's streak started — earlier runs belong to a previous
 * request and are ignored.
 */
export function evaluateConsecutiveFailureCap(params: {
  runs: readonly SubagentRunRecord[];
  cap: number | undefined;
  sinceMs?: number;
  max?: number;
}): string | null {
  if (params.cap === undefined || params.cap <= 0) {
    return null;
  }
  const chain = params.runs
    .filter((run) => run.collect !== true && !run.swarmRunId)
    .filter((run) => params.sinceMs === undefined || run.createdAt >= params.sinceMs)
    .toSorted((a, b) => a.createdAt - b.createdAt);
  const streak = trailingFailureStreak(chain);
  if (streak < params.cap) {
    return null;
  }
  const attempts = formatRunEntries(chain, params.max ?? DEFAULT_MAX_LISTED_ATTEMPTS);
  return (
    `Sub-agent spawn blocked: ${streak} attempts in a row failed this session ` +
    `(${attempts}). Stop here — tell the user what was attempted and how each ended, then ` +
    `ask the user whether to keep trying or review it together. Do not spawn again automatically.`
  );
}

// Start of the current user turn's streak, per parent session. Recorded once per requester turn
// so several spawns inside one turn keep counting each other's failures. In-process only: after
// a gateway restart the next user turn re-establishes it. Entries older than a day are pruned.
const STREAK_RESET_TTL_MS = 24 * 60 * 60 * 1000;
const streakResetBySession = new Map<string, { atMs: number; turnId?: string }>();

export function markConsecutiveFailureStreakReset(
  requesterSessionKey: string,
  nowMs: number,
  requesterTurnId?: string,
) {
  const current = streakResetBySession.get(requesterSessionKey);
  if (current && requesterTurnId !== undefined && current.turnId === requesterTurnId) {
    return;
  }
  for (const [key, entry] of streakResetBySession) {
    if (nowMs - entry.atMs > STREAK_RESET_TTL_MS) {
      streakResetBySession.delete(key);
    }
  }
  streakResetBySession.set(requesterSessionKey, { atMs: nowMs, turnId: requesterTurnId });
}

export function getConsecutiveFailureStreakResetAt(requesterSessionKey: string) {
  return streakResetBySession.get(requesterSessionKey)?.atMs;
}
