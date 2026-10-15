import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";
import { formatRunEntries } from "./prior-attempts-note.js";

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

/**
 * Admission decision for a sub-agent spawn. Returns a user-facing error message when the
 * parent session has hit the consecutive-failure cap (so the caller refuses the spawn and
 * the agent surfaces the message to the user), or `null` when the spawn may proceed.
 *
 * `runs` is the parent session's prior child runs (oldest→newest), as returned by
 * `listSubagentRunsForRequester(requesterSessionKey)`.
 */
export function evaluateConsecutiveFailureCap(params: {
  runs: readonly SubagentRunRecord[];
  cap: number | undefined;
  max?: number;
}): string | null {
  const streak = trailingFailureStreak(params.runs);
  if (!shouldBlockSpawn(streak, params.cap)) {
    return null;
  }
  const attempts = formatRunEntries(params.runs, params.max ?? 5);
  return (
    `Sub-agent spawn blocked: ${streak} attempts in a row failed this session ` +
    `(${attempts}). Stop here — tell the user what was attempted and how each ended, then ` +
    `ask the user whether to keep trying or review it together. Do not spawn again automatically.`
  );
}
