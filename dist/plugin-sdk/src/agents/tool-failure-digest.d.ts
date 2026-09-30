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
import { type ToolErrorSummary, type ToolFailureReasonCode, type ToolFailureSurfaceContext } from "./tool-error-summary.js";
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
/**
 * Builds the digest, or `undefined` when nothing survives (every failure was
 * retried, or turn-wide suppression already applies - callers pass
 * `surfaceContext` reflecting that). Per-entry visibility reuses
 * `shouldSurfaceToolFailure`, the same predicate `resolveToolErrorWarningPolicy`
 * uses for the turn's single representative failure, so the digest and the
 * show/suppress decision can never disagree about which failures are visible.
 */
export declare function buildToolFailureDigest(params: {
    toolFailures: readonly (ToolErrorSummary & {
        retried?: boolean;
    })[];
    toolMetas: readonly {
        errored?: boolean;
        status?: "blocked" | "partial";
    }[];
    surfaceContext: ToolFailureSurfaceContext;
}): ToolFailureDigest | undefined;
