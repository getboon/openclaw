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
