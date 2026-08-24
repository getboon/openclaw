// Pure formatting/guard helpers for the Sentry monitor. Kept free of Sentry and
// host imports so they stay unit-testable in isolation.

import type { PluginHookModelCallEndedEvent } from "openclaw/plugin-sdk/types";

// safe wraps a synchronous handler body so a bug in our reporting code can't
// take down the host gateway. The whole point of this plugin is to surface
// errors, not introduce new ones.
export function safe(
  logger: { error: (m: string) => void },
  pluginId: string,
  hook: string,
  fn: () => void,
): void {
  try {
    fn();
  } catch (err) {
    logger.error(`${pluginId}: handler for ${hook} threw — ${stringifyErr(err)}`);
  }
}

export function describeModelCallError(event: PluginHookModelCallEndedEvent): string {
  const parts = [
    event.errorClass,
    event.httpStatus ? `http_status=${event.httpStatus}` : undefined,
    event.errorCategory,
    event.failureKind ? `failure_kind=${event.failureKind}` : undefined,
  ].filter(Boolean);
  return parts.length > 0
    ? `model_call_ended: ${parts.join(", ")}`
    : "model_call_ended outcome=error";
}

export function runContext(
  runId?: string,
  sessionId?: string,
  callId?: string,
): Record<string, string | undefined> | undefined {
  if (!runId && !sessionId && !callId) {
    return undefined;
  }
  return { run_id: runId, session_id: sessionId, call_id: callId };
}

// Sentry tag values must be string-coercible and non-empty; drop undefined,
// null, and empty keys so each capture reads cleanly.
export function pruneTags(tags: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (v !== undefined && v !== null && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

// Every capture is dispatched via `new Error(message)` at one fixed call site
// per hook (dispatch.ts), so the JS stack trace is identical across every
// distinct failure of that hook and Sentry's stack-based grouping merges them
// into a single noisy issue regardless of message content, confirmed live
// across production events spanning Python tracebacks, web-fetch failures,
// memory_search timeouts, and cron failures all merged into one bucket.
// Building an explicit fingerprint from the fields that actually distinguish
// one failure from another is the only way to get Sentry to split them.
export function fingerprintOf(...parts: Array<string | number | undefined>): string[] {
  return parts
    .filter((part): part is string | number => part !== undefined && part !== null && part !== "")
    .map(String);
}

// Volatile substrings (paths, UUIDs, timestamps, byte/pixel counts,
// dimensions) that would otherwise fingerprint an identical failure
// differently each time. Order matters: run before the bare-number pattern.
const FINGERPRINT_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FINGERPRINT_ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?\b/g;
const FINGERPRINT_SHORT_DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{1,2}:\d{2}\b/g;
const FINGERPRINT_DIMENSIONS_RE = /\b\d+\s*x\s*\d+\b/gi;
const FINGERPRINT_PATH_RE = /(?:[~.]{0,2}\/[\w.-]+){2,}/g;
const FINGERPRINT_FILENAME_RE = /\b[\w-]+\.[A-Za-z0-9]{1,6}\b/g;
const FINGERPRINT_NUMBER_RE = /\b\d[\d,]*\b/g;

/**
 * Scrubs volatile tokens from free-form error text before it enters a Sentry
 * fingerprint, so the *same kind* of failure recurring with a different path,
 * id, timestamp, or byte count still lands in one issue. The raw text is
 * untouched everywhere else (exception message, `extra`) — only the
 * fingerprint input is normalized, so issue titles stay readable.
 */
export function normalizeFingerprintText(text: string): string {
  return text
    .replaceAll(FINGERPRINT_UUID_RE, "<uuid>")
    .replaceAll(FINGERPRINT_ISO_TIMESTAMP_RE, "<ts>")
    .replaceAll(FINGERPRINT_SHORT_DATE_RE, "<ts>")
    .replaceAll(FINGERPRINT_DIMENSIONS_RE, "<dim>")
    .replaceAll(FINGERPRINT_PATH_RE, "<path>")
    .replaceAll(FINGERPRINT_FILENAME_RE, "<file>")
    .replaceAll(FINGERPRINT_NUMBER_RE, "<n>");
}

export function stringifyErr(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
