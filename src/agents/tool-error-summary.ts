/**
 * Compact tool error summary types.
 *
 * Stores failure metadata used by transcripts, retry behavior, and mutation recovery logic.
 */
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import { isLikelyMutatingToolName, type FileTarget } from "./tool-mutation.js";

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

const EXEC_LIKE_TOOL_NAMES = new Set(["exec", "bash"]);

/** Detects shell-execution tools that share retry and mutation semantics. */
export function isExecLikeToolName(toolName: string): boolean {
  return EXEC_LIKE_TOOL_NAMES.has(normalizeOptionalLowercaseString(toolName) ?? "");
}

/**
 * Closed set of user-safe reasons a step can fail for. Deliberately small and
 * fixed copy — never the raw error string — so a step-failure note stays
 * informative without leaking shell output, stack traces, or provider error
 * text to end users.
 */
export type ToolFailureReasonCode =
  | "timed_out"
  | "permission_denied"
  | "not_found"
  | "network"
  | "exit_error";

const TIMED_OUT_ERROR_CODES = new Set(["ETIMEDOUT"]);
const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const NOT_FOUND_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);
// ENOTFOUND is a DNS lookup failure (getaddrinfo), not a missing resource —
// it belongs with the network codes, not the not-found codes.
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
]);

const PERMISSION_DENIED_PATTERN = /permission denied|not permitted|access denied/iu;
const NOT_FOUND_PATTERN = /not found|no such file|could not find/iu;
const TIMED_OUT_PATTERN = /timed out|timeout/iu;
const NETWORK_PATTERN = /network|connection|unreachable|dns/iu;
const EXIT_ERROR_PATTERN = /exit(?:ed)?\s+(?:with\s+)?(?:code|status)\s*\d+|non-zero exit/iu;

const REASON_TEXT: Record<ToolFailureReasonCode, string> = {
  timed_out: "timed out",
  permission_denied: "permission denied",
  not_found: "not found",
  network: "couldn't reach the network",
  exit_error: "exited with an error",
};

/**
 * Classifies a tool failure into a short, fixed, user-safe reason — never the
 * raw error text (which may contain shell output, file paths, or provider
 * error bodies). Returns `undefined` when nothing classifies; callers should
 * omit the reason clause rather than print an "unknown" placeholder.
 */
export function classifyToolFailureReason(
  summary: Pick<ToolErrorSummary, "error" | "errorCode" | "timedOut">,
): { code: ToolFailureReasonCode; text: string } | undefined {
  const code = resolveToolFailureReasonCode(summary);
  return code ? { code, text: REASON_TEXT[code] } : undefined;
}

function resolveToolFailureReasonCode(
  summary: Pick<ToolErrorSummary, "error" | "errorCode" | "timedOut">,
): ToolFailureReasonCode | undefined {
  // The explicit timedOut flag is set from structured tool-result status, so
  // it outranks pattern matching on free-form error text.
  if (summary.timedOut === true) {
    return "timed_out";
  }
  const errorCode = summary.errorCode?.toUpperCase();
  if (errorCode) {
    if (TIMED_OUT_ERROR_CODES.has(errorCode)) {
      return "timed_out";
    }
    if (PERMISSION_ERROR_CODES.has(errorCode)) {
      return "permission_denied";
    }
    if (NOT_FOUND_ERROR_CODES.has(errorCode)) {
      return "not_found";
    }
    if (NETWORK_ERROR_CODES.has(errorCode)) {
      return "network";
    }
  }
  const error = summary.error;
  if (!error) {
    return undefined;
  }
  if (TIMED_OUT_PATTERN.test(error)) {
    return "timed_out";
  }
  if (PERMISSION_DENIED_PATTERN.test(error)) {
    return "permission_denied";
  }
  if (NOT_FOUND_PATTERN.test(error)) {
    return "not_found";
  }
  if (NETWORK_PATTERN.test(error)) {
    return "network";
  }
  if (EXIT_ERROR_PATTERN.test(error)) {
    return "exit_error";
  }
  return undefined;
}

const RECOVERABLE_TOOL_ERROR_KEYWORDS = [
  "required",
  "missing",
  "invalid",
  "must be",
  "must have",
  "needs",
  "requires",
] as const;

/** Best-effort signal that a non-mutating tool error was a caller-input mistake
 *  the model can self-correct, not evidence of a broken step. */
export function isRecoverableToolError(error: string | undefined): boolean {
  const errorLower = normalizeOptionalLowercaseString(error) ?? "";
  return RECOVERABLE_TOOL_ERROR_KEYWORDS.some((keyword) => errorLower.includes(keyword));
}

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
export function shouldSurfaceToolFailure(
  toolError: Pick<ToolErrorSummary, "toolName" | "middlewareError" | "mutatingAction" | "error">,
  ctx: ToolFailureSurfaceContext,
): boolean {
  const normalizedToolName = normalizeOptionalLowercaseString(toolError.toolName) ?? "";
  // sessions_send timeouts/errors are transient inter-session communication
  // issues — the message may still have been delivered (#23989).
  if (normalizedToolName === "sessions_send") {
    return false;
  }
  // ENG-16868: a sessions_spawn that errored-then-recovered still delivers a
  // complete answer; the transient retry is backstage plumbing. Suppress once
  // a real reply (or an existing user-facing error reply) already landed.
  if (normalizedToolName === "sessions_spawn") {
    return !ctx.hasUserFacingReply && !ctx.hasUserFacingErrorReply;
  }
  // A middleware (post-processing) failure means the tool's result couldn't
  // be sanitized, not that the tool itself failed — the underlying outcome is
  // genuinely unknown, so "a step didn't complete" overclaims once a reply
  // was delivered.
  if (toolError.middlewareError === true) {
    return !ctx.hasUserFacingReply;
  }
  const isMutatingToolError =
    toolError.mutatingAction ?? isLikelyMutatingToolName(toolError.toolName);
  if (isMutatingToolError) {
    return !ctx.hasUserFacingErrorReply && !ctx.hasUserFacingFailureAcknowledgement;
  }
  // ENG-16330: a recovered exec/process/tmux failure is non-terminal status, not
  // an error — the model saw the exit code and still produced the answer, so with
  // no details to show a warning badge only alarms the customer. The suppression
  // REQUIRES a delivered reply: a read-only exec failure (mutatingAction false)
  // with no reply must still surface, or the failure vanishes silently and the
  // user sees nothing (see payloads.errors.test.ts's read-only/no-reply case).
  if (isExecLikeToolName(toolError.toolName) && ctx.hasUserFacingReply && !ctx.includeDetails) {
    return false;
  }
  return !ctx.hasUserFacingReply && !isRecoverableToolError(toolError.error);
}
