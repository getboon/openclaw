/**
 * Detects abort-shaped errors from embedded-agent runner dependencies.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

/** Return true for AbortError objects or lower-level aborted messages. */
export function isRunnerAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") {
    return true;
  }
  const message =
    "message" in err && typeof err.message === "string"
      ? normalizeLowercaseStringOrEmpty(err.message)
      : "";
  return message.includes("aborted");
}

/**
 * True only for a rejection that is BOTH abort-shaped AND already attributed
 * to the caller's own external abortSignal firing as a timeout.
 * `isRunnerAbortError` alone is too broad — it also matches OpenClaw's own
 * internal watchdog timeouts (scheduleAbortTimer/idleTimeoutTrigger), which
 * never set `externalAbort` and must keep reporting as a real error. Gating
 * on all three (externalAbort + timedOut + abort-shaped) is what lets a
 * caller-driven timeout (e.g. a channel plugin's own wall-clock turn budget)
 * be classified as a clean interruption instead of a reported exception,
 * without hiding a genuine internal-timeout failure.
 */
export function isExternalTimeoutAbortRejection(params: {
  err: unknown;
  externalAbort: boolean;
  timedOut: boolean;
}): boolean {
  return params.externalAbort && params.timedOut && isRunnerAbortError(params.err);
}

export type AsyncTaskWaitTimeoutOutcome =
  | { kind: "none" }
  | { kind: "log"; message: string }
  | { kind: "error"; message: string };

/**
 * Decides what a still-pending async task at the completion-required wait's
 * deadline means. When the run was already classified as a clean external
 * abort, that wait's own deadline collapses to ~now, so a pending task there
 * is a consequence of the same caller-driven stop, not an independent
 * failure — log it instead of setting promptError and undoing the
 * classification.
 */
export function classifyAsyncTaskWaitTimeout(params: {
  timedOutRunIds: readonly string[];
  externalTimeoutAbortClassified: boolean;
}): AsyncTaskWaitTimeoutOutcome {
  if (params.timedOutRunIds.length === 0) {
    return { kind: "none" };
  }
  const runIds = params.timedOutRunIds.join(", ");
  if (params.externalTimeoutAbortClassified) {
    return {
      kind: "log",
      message: `async task(s) still pending at external-timeout abort: ${runIds}`,
    };
  }
  return { kind: "error", message: `Timed out waiting for async task completion: ${runIds}` };
}
