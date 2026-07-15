/**
 * Maps a thrown agent-run failure to a deterministic gateway-failure code
 * (ENG-15739). This is consulted only on the previously-generic fall-through of
 * the run-failure dispatcher (after the richer bespoke branches decline), so it
 * replaces the single "message failed" string with a class-specific, customer-
 * safe line from the MessageOrigin taxonomy (message-origin.ts).
 *
 * It composes the EXISTING failover classifiers — no new provider-error
 * heuristics — so its verdict always agrees with the failover ladder. Same
 * failure class in → same code out (deterministic).
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import {
  isAllocationExhaustedErrorMessage,
  isLikelyContextOverflowError,
} from "../../agents/embedded-agent-helpers/errors.js";
import type { FailoverReason } from "../../agents/embedded-agent-helpers/types.js";
import { isFailoverError, resolveFailoverReasonFromError } from "../../agents/failover-error.js";
import { isFallbackSummaryError } from "../../agents/model-fallback.js";
import type { GatewayFailureCode } from "../../channels/message/message-origin.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { isProviderConversationStateErrorMessage } from "./provider-request-error-classifier.js";

/** Transient upstream HTTP statuses that mean "provider hiccup, auto-retried". */
const TRANSIENT_UPSTREAM_STATUS = new Set([408, 499, 500, 502, 503, 504, 521, 522, 523, 524, 529]);

/**
 * Precedence for reducing a FallbackSummaryError's per-attempt reasons to a
 * single dominant reason. Hard/actionable causes win over transient ones so
 * mixed-cause exhaustion maps to the most informative class (e.g. a billing hop
 * beats a rate-limit hop). Order = highest precedence first.
 */
const REASON_PRECEDENCE: FailoverReason[] = [
  "billing",
  "auth_permanent",
  "auth",
  "model_not_found",
  "format",
  "session_expired",
  "rate_limit",
  "overloaded",
  "server_error",
  "timeout",
];

/** Dominant FailoverReason across a FailoverError / FallbackSummaryError / raw error. */
export function resolveDominantFailoverReason(err: unknown): FailoverReason | undefined {
  if (isFailoverError(err)) {
    return err.reason;
  }
  if (isFallbackSummaryError(err)) {
    const reasons = new Set(
      err.attempts
        .map((attempt) => attempt.reason)
        .filter((reason): reason is FailoverReason => Boolean(reason)),
    );
    for (const candidate of REASON_PRECEDENCE) {
      if (reasons.has(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }
  return resolveFailoverReasonFromError(err) ?? undefined;
}

/**
 * True when the failure is a connectivity error reaching boon-core (the project
 * data / config API), as opposed to a model-provider transport error. Keyed on
 * the boon-core host plus a connection-class signal so it never fires on a
 * generic provider timeout.
 */
export function isBoonCoreUnreachableError(input: unknown): boolean {
  const message = typeof input === "string" ? input : formatErrorMessage(input);
  const lower = normalizeLowercaseStringOrEmpty(message);
  const mentionsBoonCore =
    lower.includes("getboon.ai") || lower.includes("app.getboon") || lower.includes("boon-core");
  if (!mentionsBoonCore) {
    return false;
  }
  return (
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("econnaborted") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("epipe") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("socket hang up") ||
    /\b(?:502|503|504)\b/u.test(lower)
  );
}

/** Read an HTTP-like status off a FailoverError (or nested error), if present. */
function resolveStatus(err: unknown): number | undefined {
  if (isFailoverError(err) && typeof err.status === "number") {
    return err.status;
  }
  return undefined;
}

/**
 * Resolve the deterministic gateway-failure code for a thrown run failure.
 * First match wins; the classification is total — any shape with no specific
 * signal falls through to `agent_failed_transient_after_retries`.
 */
export function resolveGatewayFailureCode(err: unknown): GatewayFailureCode {
  const message = formatErrorMessage(err);

  // Billing / org allocation — a billing state, not an outage.
  if (
    isAllocationExhaustedErrorMessage(message) ||
    resolveDominantFailoverReason(err) === "billing"
  ) {
    return "token_allocation_exhausted";
  }

  // Context window exceeded — user-actionable (shorten / /new).
  if (isLikelyContextOverflowError(message)) {
    return "model_context_length_exceeded";
  }

  // boon-core / project-data connectivity — scoped, distinct from provider 5xx.
  if (isBoonCoreUnreachableError(err)) {
    return "boon_core_unreachable";
  }

  const reason = resolveDominantFailoverReason(err);
  const status = resolveStatus(err);

  // Transient provider load — auto-retried / fell back.
  if (reason === "rate_limit" || reason === "overloaded") {
    return "provider_rate_limit_shared";
  }

  // Transient upstream 5xx / timeout — auto-retried.
  if (reason === "server_error" || reason === "timeout") {
    return "provider_upstream_5xx";
  }
  if (typeof status === "number" && TRANSIENT_UPSTREAM_STATUS.has(status)) {
    return "provider_upstream_5xx";
  }

  // Malformed session history / broken conversation state — start fresh.
  if (
    reason === "format" ||
    reason === "session_expired" ||
    isProviderConversationStateErrorMessage(message)
  ) {
    return "provider_malformed_history";
  }

  // Everything else (auth-without-attribution, unclassified, empty_response,
  // model_not_found, no_error_details, unknown) → safe transient copy. We do
  // NOT map bare auth to missing_api_key/model_login_expired: the bespoke
  // missing-key / oauth-refresh branches run first, so reaching here means we
  // lack provider attribution — claiming "operator must fix" would be a false
  // blame for a transient 401.
  return "agent_failed_transient_after_retries";
}
