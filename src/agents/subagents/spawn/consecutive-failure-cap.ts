import type { SubagentRunRecord } from "../registry/subagent-registry.types";

/**
 * ENG-21265 — Component B (bounded retries). Pure decision helpers for the
 * session-scoped consecutive-failure cap.
 *
 * Scope is the parent `requesterSessionKey`, NOT a single turn: each autonomous
 * re-spawn happens in a separate completion-wake turn, so a per-turn counter would
 * reset on every wake and never fire (verified against the incident). The caller
 * passes the parent session's prior child runs (oldest→newest) and this counts the
 * trailing run of consecutive failures.
 *
 * Failure = an explicit terminal outcome of error/timeout/unknown (fail-cautious —
 * the cost of being wrong is one extra user check-in). A run with status `ok`, or
 * one with no terminal outcome yet (still in flight), breaks the streak — so an
 * in-flight sibling never counts toward the cap.
 */

const FAILURE_STATUSES = new Set(["error", "timeout", "unknown"]);

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
