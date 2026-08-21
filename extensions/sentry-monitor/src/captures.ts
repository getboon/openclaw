// Pure, strictly-typed decision + payload-shaping for each lifecycle hook.
//
// Each builder takes a typed event plus the resolved host tag and returns a
// SentryCapture descriptor, or null when the event is not error-bearing and
// should be ignored. Keeping this logic free of the Sentry SDK makes every
// trigger boundary unit-testable without mocking the network client.

import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookCronChangedEvent,
  PluginHookMessageSentEvent,
  PluginHookModelCallEndedEvent,
  PluginHookSessionEndEvent,
  PluginHookSubagentEndedEvent,
} from "openclaw/plugin-sdk/types";
import {
  describeModelCallError,
  fingerprintOf,
  normalizeFingerprintText,
  pruneTags,
  runContext,
} from "./format.js";

export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

type CaptureFields = {
  tags: Record<string, string>;
  // Explicit grouping key. Required: every capture is thrown from the same
  // fixed call site per hook (dispatch.ts), so leaving this to Sentry's
  // default stack-based grouping merges unrelated failures into one issue.
  fingerprint: string[];
  contexts?: { run?: Record<string, string | undefined> };
  extra?: Record<string, unknown>;
};

/**
 * A backend-agnostic description of one Sentry capture. `exception` maps to
 * captureException(new Error(message)); `message` maps to captureMessage with
 * an explicit level. Discriminated on `kind` so the dispatcher has no branches
 * beyond the two SDK calls.
 */
export type SentryCapture =
  | ({ kind: "exception"; message: string } & CaptureFields)
  | ({ kind: "message"; message: string; level: SentryLevel } & CaptureFields);

export function buildModelCallEndedCapture(
  event: PluginHookModelCallEndedEvent,
  host: string,
): SentryCapture | null {
  if (event.outcome !== "error") {
    return null;
  }
  return {
    kind: "exception",
    message: describeModelCallError(event),
    tags: pruneTags({
      hook: "model_call_ended",
      host,
      provider: event.provider,
      model: event.model,
      api: event.api,
      transport: event.transport,
      failure_kind: event.failureKind,
      error_category: event.errorCategory,
      // ENG-16922: the discriminator the Rohan 5xx alert splits on —
      // upstream_provider_5xx (Bedrock/Anthropic relayed) vs gateway_origin_5xx.
      error_class: event.errorClass,
    }),
    fingerprint: fingerprintOf(
      "model_call_ended",
      event.provider,
      event.model,
      event.errorClass,
      // httpStatus alongside errorClass: same classification, different HTTP
      // cause (e.g. Bedrock 503 vs a gateway 502) must not share an issue.
      event.httpStatus,
      event.failureKind,
      event.errorCategory,
    ),
    contexts: { run: runContext(event.runId, event.sessionId, event.callId) },
    extra: {
      duration_ms: event.durationMs,
      ttfb_ms: event.timeToFirstByteMs,
      request_payload_bytes: event.requestPayloadBytes,
      response_stream_bytes: event.responseStreamBytes,
      http_status: event.httpStatus,
      upstream_request_id_hash: event.upstreamRequestIdHash,
    },
  };
}

export function buildAgentEndCapture(
  event: PluginHookAgentEndEvent,
  host: string,
): SentryCapture | null {
  if (event.success) {
    return null;
  }
  return {
    kind: "exception",
    message: event.error ?? "agent_end success=false",
    tags: pruneTags({ hook: "agent_end", host }),
    fingerprint: fingerprintOf(
      "agent_end",
      event.error ? normalizeFingerprintText(event.error) : "success=false",
    ),
    contexts: { run: runContext(event.runId) },
    extra: {
      duration_ms: event.durationMs,
      message_count: Array.isArray(event.messages) ? event.messages.length : undefined,
    },
  };
}

export function buildAfterToolCallCapture(
  event: PluginHookAfterToolCallEvent,
  host: string,
): SentryCapture | null {
  if (!event.error) {
    return null;
  }
  // A policy/permission/visibility denial is the system working as intended,
  // not a defect: reporting it as an exception buries real regressions
  // behind expected, unactionable noise.
  if (event.errorKind === "denied") {
    return null;
  }
  const tags = pruneTags({
    hook: "after_tool_call",
    host,
    tool: event.toolName,
    error_kind: event.errorKind,
    error_code: event.errorCode,
  });
  // tool + errorKind/errorCode (falling back to normalized message) so a
  // recurring failure with a different path/id/timestamp lands in one issue,
  // and different tools/causes never share a bucket (see file header).
  const fingerprint = fingerprintOf(
    "after_tool_call",
    event.toolName,
    event.errorKind,
    event.errorCode ?? normalizeFingerprintText(event.error),
  );
  const contexts = { run: runContext(event.runId) };
  const extra = { tool_call_id: event.toolCallId, duration_ms: event.durationMs };
  // A validation/argument-preparation rejection is a model-input problem, not
  // a host exception, but it can still signal a real schema mismatch — so
  // downgrade to a non-paging warning instead of dropping it outright.
  if (event.errorKind === "invalid-input") {
    return {
      kind: "message",
      level: "warning",
      message: event.error,
      tags,
      fingerprint,
      contexts,
      extra,
    };
  }
  return {
    kind: "exception",
    message: event.error,
    tags,
    fingerprint,
    contexts,
    extra,
  };
}

export function buildMessageSentCapture(
  event: PluginHookMessageSentEvent,
  host: string,
): SentryCapture | null {
  if (event.success) {
    return null;
  }
  return {
    kind: "exception",
    message: event.error ?? "message_sent success=false",
    tags: pruneTags({ hook: "message_sent", host }),
    fingerprint: fingerprintOf(
      "message_sent",
      event.error ? normalizeFingerprintText(event.error) : "success=false",
    ),
    contexts: { run: runContext(event.runId, event.sessionKey) },
    extra: { message_id: event.messageId, trace_id: event.traceId, span_id: event.spanId },
  };
}

export function buildSubagentEndedCapture(
  event: PluginHookSubagentEndedEvent,
  host: string,
): SentryCapture | null {
  // ok is the only success outcome; an undefined outcome is treated as normal.
  if (event.outcome === "ok" || event.outcome === undefined) {
    return null;
  }
  return {
    kind: "exception",
    message: event.error ?? `subagent_ended outcome=${event.outcome}`,
    tags: pruneTags({
      hook: "subagent_ended",
      host,
      outcome: event.outcome,
      target_kind: event.targetKind,
    }),
    fingerprint: fingerprintOf(
      "subagent_ended",
      event.outcome,
      event.targetKind,
      event.error ? normalizeFingerprintText(event.error) : `outcome=${event.outcome}`,
    ),
    contexts: { run: runContext(event.runId) },
    extra: {
      target_session_key: event.targetSessionKey,
      reason: event.reason,
      ended_at: event.endedAt,
    },
  };
}

export function buildCronChangedCapture(
  event: PluginHookCronChangedEvent,
  host: string,
): SentryCapture | null {
  // A failed run is a failure whether or not an error string is attached; the
  // message fallback below covers the no-text case (no blank Error("")).
  const hasRunError = event.status === "error";
  // A run can also succeed yet have its output silently dropped; "not-delivered"
  // is a failure even when no deliveryError string is attached.
  const hasDeliveryFailure =
    event.deliveryStatus === "not-delivered" || Boolean(event.deliveryError);
  if (!hasRunError && !hasDeliveryFailure) {
    return null;
  }
  // `||` so an empty error string falls through to the delivery error / a
  // descriptive fallback rather than producing a blank Error("").
  const message =
    event.error ||
    event.deliveryError ||
    `cron_changed status=${event.status ?? "unknown"} delivery=${event.deliveryStatus ?? "unknown"}`;
  return {
    kind: "exception",
    message,
    tags: pruneTags({
      hook: "cron_changed",
      host,
      action: event.action,
      status: event.status,
      delivery_status: event.deliveryStatus,
    }),
    fingerprint: fingerprintOf(
      "cron_changed",
      event.action,
      event.status,
      event.deliveryStatus,
      normalizeFingerprintText(message),
    ),
    contexts: { run: runContext(event.runId, event.sessionId) },
    // `summary` is intentionally omitted: it is free-form cron run output
    // (content), and this plugin ships structured metadata only.
    extra: {
      job_id: event.jobId,
      agent_id: event.agentId,
      duration_ms: event.durationMs,
      delivery_error: event.deliveryError,
      model: event.model,
      provider: event.provider,
    },
  };
}

export function buildSessionEndCapture(
  event: PluginHookSessionEndEvent,
  host: string,
): SentryCapture | null {
  // Every reason except `unknown` (or a missing reason) is a normal lifecycle
  // transition (idle/new/daily/compaction/deleted/shutdown/restart/reset).
  const reason = event.reason ?? "unknown";
  if (reason !== "unknown") {
    return null;
  }
  return {
    kind: "message",
    message: "session_end reason=unknown",
    level: "warning",
    tags: pruneTags({ hook: "session_end", host, reason }),
    fingerprint: fingerprintOf("session_end", reason),
    extra: {
      session_id: event.sessionId,
      message_count: event.messageCount,
      duration_ms: event.durationMs,
      transcript_archived: event.transcriptArchived,
    },
  };
}
