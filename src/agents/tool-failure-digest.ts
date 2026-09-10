/**
 * Builds a leak-safe, deduped summary of EVERY unrecovered tool failure in a
 * turn, for the step-failure note (ENG-18812). `lastToolError` is a
 * single-slot "most recent failure" record - a turn with two distinct
 * failures, or one whose last call happened to succeed, could previously
 * describe only one failure or none at all. This module turns the full
 * `toolFailures` list collected during the turn into the smallest safe shape
 * a reply builder needs: which tools failed, why (a closed, user-safe reason
 * code, never raw error text), and how many steps completed either way.
 */
import {
  classifyToolFailureReason,
  shouldSurfaceToolFailure,
  type ToolErrorSummary,
  type ToolFailureReasonCode,
  type ToolFailureSurfaceContext,
} from "./tool-error-summary.js";

export type ToolFailureDigestEntry = {
  toolName: string;
  reasonCode?: ToolFailureReasonCode;
  reasonText?: string;
  /** Number of distinct failed calls this entry collapses (same tool + reason). */
  count: number;
};

export type ToolFailureDigest = {
  totalToolCount: number;
  completedToolCount: number;
  /** Deduped, ordered, capped at MAX_DIGEST_ENTRIES. */
  failures: ToolFailureDigestEntry[];
  /** Distinct (tool, reason) groups beyond the cap, collapsed to a count. */
  omittedCount: number;
};

/** Caps the note's failure list so a pathological turn can't produce a wall of text. */
const MAX_DIGEST_ENTRIES = 8;

/** Derives an honest total/completed pair from explicit outcomes when present,
 * or from the surfaced failure records when a legacy producer omits outcomes. */
function resolveToolCounts(
  toolMetas: readonly { errored?: boolean; status?: "blocked" | "partial" }[],
  surfacedFailureCount: number,
): Pick<ToolFailureDigest, "totalToolCount" | "completedToolCount"> {
  const hasErroredFlags = toolMetas.some((meta) => meta.errored !== undefined);
  if (hasErroredFlags) {
    return {
      totalToolCount: toolMetas.length,
      completedToolCount: toolMetas.filter(
        (meta) => !meta.errored && meta.status !== "blocked" && meta.status !== "partial",
      ).length,
    };
  }
  // Current embedded and Codex collectors set per-call outcomes. This branch
  // remains for direct payload-builder compatibility callers that provide only
  // a last failure, and normalized attempt records whose source omitted outcomes.
  const totalToolCount = Math.max(toolMetas.length, surfacedFailureCount);
  return {
    totalToolCount,
    completedToolCount: totalToolCount - surfacedFailureCount,
  };
}

/**
 * Builds the digest, or `undefined` when nothing survives (every failure was
 * retried, or turn-wide suppression already applies - callers pass
 * `surfaceContext` reflecting that). Per-entry visibility reuses
 * `shouldSurfaceToolFailure`, the same predicate `resolveToolErrorWarningPolicy`
 * uses for the turn's single representative failure, so the digest and the
 * show/suppress decision can never disagree about which failures are visible.
 */
export function buildToolFailureDigest(params: {
  toolFailures: readonly (ToolErrorSummary & { retried?: boolean })[];
  toolMetas: readonly { errored?: boolean; status?: "blocked" | "partial" }[];
  surfaceContext: ToolFailureSurfaceContext;
}): ToolFailureDigest | undefined {
  const surfaced = params.toolFailures.filter(
    (failure) => !failure.retried && shouldSurfaceToolFailure(failure, params.surfaceContext),
  );
  if (surfaced.length === 0) {
    return undefined;
  }

  const grouped = new Map<string, ToolFailureDigestEntry>();
  const order: string[] = [];
  for (const failure of surfaced) {
    // Classified reason only, never `meta`/`error`, which can embed a raw
    // shell command or file path (ENG-16429 leak this digest must not reopen).
    const reason = classifyToolFailureReason(failure);
    const key = `${failure.toolName}:${reason?.code ?? "unclassified"}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      toolName: failure.toolName,
      reasonCode: reason?.code,
      reasonText: reason?.text,
      count: 1,
    });
    order.push(key);
  }

  const allEntries = order.map((key) => grouped.get(key)!);
  const failures = allEntries.slice(0, MAX_DIGEST_ENTRIES);
  const omittedCount = allEntries.length - failures.length;
  const toolCounts = resolveToolCounts(params.toolMetas, surfaced.length);

  return {
    ...toolCounts,
    failures,
    omittedCount,
  };
}
