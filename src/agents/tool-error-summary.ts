/**
 * Compact tool error summary types.
 *
 * Stores failure metadata used by transcripts, retry behavior, and mutation recovery logic.
 */
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { FileTarget } from "./tool-mutation.js";

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
