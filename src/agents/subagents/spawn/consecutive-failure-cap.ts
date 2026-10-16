import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";

/**
 * ENG-21265 — backstop: stop silent sub-agent re-spawn loops.
 *
 * Scope is the parent `requesterSessionKey`, NOT a single turn: each autonomous re-spawn
 * happens in a separate completion-wake turn, so a per-turn counter would never fire. The
 * streak resets when the user sends a new message (see the reset marker below), so old
 * failures from an earlier request never block unrelated new work.
 *
 * Failure = an explicit terminal outcome of error/timeout/unknown (fail-cautious — the cost
 * of being wrong is one extra user check-in). A run with status `ok`, or one with no terminal
 * outcome yet (still in flight), breaks the streak. Collector / swarm children are
 * independent parallel work, not a retry chain, and are never counted.
 */

const FAILURE_STATUSES = new Set(["error", "timeout", "unknown"]);
const DEFAULT_MAX_LISTED_ATTEMPTS = 5;

export function trailingFailureStreak(runs: readonly SubagentRunRecord[]): number {
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

export function shouldBlockSpawn(streak: number, cap: number | undefined): boolean {
  if (cap === undefined || cap <= 0) {
    return false;
  }
  return streak >= cap;
}

/** Formats the most-recent runs as `'name' (status), ...` for the block message. */
export function formatRunEntries(
  runs: readonly SubagentRunRecord[],
  max: number = DEFAULT_MAX_LISTED_ATTEMPTS,
): string {
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
 * agent surfaces the message), or `null` when the spawn may proceed.
 *
 * `runs` is the parent session's child runs from `listSubagentRunsForRequester` (any order);
 * `sinceMs` is the latest user-originated spawn for that session — earlier runs belong to a
 * previous request and are ignored.
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
  if (!shouldBlockSpawn(streak, params.cap)) {
    return null;
  }
  const attempts = formatRunEntries(chain, params.max ?? DEFAULT_MAX_LISTED_ATTEMPTS);
  return (
    `Sub-agent spawn blocked: ${streak} attempts in a row failed this session ` +
    `(${attempts}). Stop here — tell the user what was attempted and how each ended, then ` +
    `ask the user whether to keep trying or review it together. Do not spawn again automatically.`
  );
}

// Latest user-originated spawn per parent session. In-process only: after a gateway restart
// the first user message re-establishes it. Entries older than a day are pruned on write.
const STREAK_RESET_TTL_MS = 24 * 60 * 60 * 1000;
const streakResetAtBySession = new Map<string, number>();

export function markConsecutiveFailureStreakReset(requesterSessionKey: string, nowMs: number) {
  for (const [key, at] of streakResetAtBySession) {
    if (nowMs - at > STREAK_RESET_TTL_MS) {
      streakResetAtBySession.delete(key);
    }
  }
  streakResetAtBySession.set(requesterSessionKey, nowMs);
}

export function getConsecutiveFailureStreakResetAt(requesterSessionKey: string) {
  return streakResetAtBySession.get(requesterSessionKey);
}
