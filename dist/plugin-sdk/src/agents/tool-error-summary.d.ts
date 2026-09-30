import { type FileTarget } from "./tool-mutation.js";
export type ToolErrorSummary = {
    toolName: string;
    meta?: string;
    errorCode?: string;
    error?: string;
    timedOut?: boolean;
    middlewareError?: boolean;
    mutatingAction?: boolean;
    actionFingerprint?: string;
    fileTarget?: FileTarget;
    /**
     * For exec/bash errors: whether every stage of the failed command was benign
     * housekeeping (read-only inspection or scratch scaffolding). Lets the reply
     * builder drop a recovered-error note when the command that errored was, e.g.,
     * a `mkdir … && find /` chain that hit permission-denied noise rather than the
     * actual task failing (ENG-16318). Display heuristic, not a security signal.
     */
    benignHousekeepingError?: boolean;
};
/** Detects shell-execution tools that share retry and mutation semantics. */
export declare function isExecLikeToolName(toolName: string): boolean;
/**
 * Closed set of user-safe reasons a step can fail for. Deliberately small and
 * fixed copy — never the raw error string — so a step-failure note stays
 * informative without leaking shell output, stack traces, or provider error
 * text to end users.
 */
export type ToolFailureReasonCode = "timed_out" | "permission_denied" | "not_found" | "network" | "exit_error";
/**
 * Classifies a tool failure into a short, fixed, user-safe reason — never the
 * raw error text (which may contain shell output, file paths, or provider
 * error bodies). Returns `undefined` when nothing classifies; callers should
 * omit the reason clause rather than print an "unknown" placeholder.
 */
export declare function classifyToolFailureReason(summary: Pick<ToolErrorSummary, "error" | "errorCode" | "timedOut">): {
    code: ToolFailureReasonCode;
    text: string;
} | undefined;
/** Best-effort signal that a non-mutating tool error was a caller-input mistake
 *  the model can self-correct, not evidence of a broken step. */
export declare function isRecoverableToolError(error: string | undefined): boolean;
/** Turn-level facts a tool-failure visibility decision depends on, alongside the failure itself. */
export type ToolFailureSurfaceContext = {
    hasUserFacingReply: boolean;
    hasUserFacingErrorReply: boolean;
    hasUserFacingFailureAcknowledgement: boolean;
    /** Whether raw operator detail is included for this turn (verbose/cron/heartbeat gating). */
    includeDetails: boolean;
};
/**
 * Single source of truth for whether one tool failure should be user-visible
 * at all. Shared by `resolveToolErrorWarningPolicy` (the turn's single
 * representative failure) and the tool-failure digest (every OTHER
 * unrecovered failure that joins it in the step-failure note), so the two
 * can never disagree about which failures are shown (ENG-18812). Global
 * turn-wide overrides (`suppressToolErrorWarnings`, `config.suppressToolErrors`)
 * are NOT part of this predicate — callers apply those once, before touching
 * any per-failure decision.
 */
export declare function shouldSurfaceToolFailure(toolError: Pick<ToolErrorSummary, "toolName" | "middlewareError" | "mutatingAction" | "error">, ctx: ToolFailureSurfaceContext): boolean;
