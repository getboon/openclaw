import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { MessagePresentation } from "../../interactive/payload.js";
import type { AssistantMessage } from "../../llm/types.js";
export { extractLeadingHttpStatus, formatRawAssistantErrorForUi, isCloudflareOrHtmlErrorPage, isEdgeWafBlockPage, isGenericProviderInternalError, parseApiErrorInfo, } from "../../shared/assistant-error-format.js";
import type { FailoverReason } from "./types.js";
export { BILLING_ERROR_USER_MESSAGE, formatBillingErrorMessage, formatRateLimitOrOverloadedErrorCopy, getApiErrorPayloadFingerprint, isRawApiErrorPayload, sanitizeUserFacingText, } from "./sanitize-user-facing-text.js";
export { isAuthErrorMessage, isAuthPermanentErrorMessage, isBillingErrorMessage, isOverloadedErrorMessage, isRateLimitErrorMessage, isServerErrorMessage, isTimeoutErrorMessage, } from "./failover-matches.js";
export declare const GENERIC_ASSISTANT_ERROR_TEXT = "LLM request failed.";
export declare const AUTH_INVALID_TOKEN_USER_TEXT: string;
/** Detect the boon-llm-gateway PAID token-allocation-exhausted signal. */
export declare function isAllocationExhaustedErrorMessage(raw: string): boolean;
/** Detect the boon-llm-gateway TRIAL budget-exhausted signal. */
export declare function isTrialBudgetExhaustedErrorMessage(raw: string): boolean;
/**
 * Detect either exhaustion variant (paid allocation OR trial budget). Both are
 * "you're out of tokens" states the gateway returns as HTTP 402; callers use
 * this to surface the dedicated top-up/upgrade copy + card.
 */
export declare function isTokenExhaustedErrorMessage(raw: string): boolean;
/**
 * Build the portable exhaustion card — a single top-up/upgrade URL button
 * (pointing at the static Boon billing page) — that both the Slack and Teams
 * adapters render natively. Returns undefined when neither `raw` nor `errorBody`
 * is an exhaustion signal, so the caller falls through to a plain-text reply.
 *
 * Classifies against BOTH `raw` and `errorBody` (the gateway's code lives only in
 * the body for trials — see isTrialBudgetExhausted). Uses the static
 * BOON_BILLING_URL rather than the gateway's top_up_url so the button is always
 * present and robust.
 *
 * The card carries NO text block on purpose: the reply payload's `text` already
 * holds the exhaustion copy (with the billing link inlined), and both adapters
 * fold that `text` into the card body (Teams `buildMSTeamsPresentationCard`) /
 * message (Slack blocks + fallback text). Adding a text block here would double
 * the copy inside the Teams card. The button is a redundant-but-convenient
 * second affordance.
 */
export declare function buildTokenExhaustedPresentation(raw: string, errorBody: string | undefined): MessagePresentation | undefined;
/** Detect provider errors that require reasoning to stay enabled. */
export declare function isReasoningConstraintErrorMessage(raw: string): boolean;
/** Detect explicit context-window overflow without confusing TPM rate limits. */
export declare function isContextOverflowError(errorMessage?: string): boolean;
export declare function isLikelyContextOverflowError(errorMessage?: string): boolean;
export declare function isCompactionFailureError(errorMessage?: string): boolean;
export declare function extractObservedOverflowTokenCount(errorMessage?: string): number | undefined;
export type FailoverSignal = {
    status?: number;
    code?: string;
    errorType?: string;
    message?: string;
    provider?: string;
    details?: readonly string[];
};
export type FailoverClassification = {
    kind: "reason";
    reason: FailoverReason;
} | {
    kind: "context_overflow";
};
export declare function extractFailoverSignalDetails(...values: unknown[]): string[] | undefined;
export type ProviderRuntimeFailureKind = "auth_scope" | "auth_refresh" | "refresh_timeout" | "refresh_contention" | "callback_timeout" | "callback_validation" | "auth_html"
/** Plain provider HTTP 401 auth failure that should not leak raw text to chat users. */
 | "auth_invalid_token"
/**
 * A CDN/WAF (Cloudflare, Render) edge block relayed by the gateway instead
 * of a real provider response — content-based, so it recurs on every model
 * in the fallback ladder. Not an auth problem: must not surface
 * "re-authenticate" copy or cool down the auth profile.
 */
 | "edge_blocked" | "upstream_html" | "proxy" | "rate_limit" | "dns" | "timeout" | "model_not_found" | "schema" | "sandbox_blocked" | "replay_invalid" | "empty_response" | "no_error_details" | "unclassified" | "unknown";
export declare function inferSignalStatus(signal: FailoverSignal): number | undefined;
export declare function isUnclassifiedNoBodyHttpSignal(signal: FailoverSignal): boolean;
/**
 * A gateway/edge WAF (Cloudflare, Render) block: an HTML error page relayed by
 * the gateway instead of a real provider JSON error. Matches a full HTML
 * document (`isHtmlErrorResponse`), a Cloudflare challenge/block page hint
 * (`isCloudflareOrHtmlErrorPage`), or a truncated block-page snippet
 * (`isEdgeWafBlockPage` — see its doc comment on why truncation matters).
 * Shared by the 429 classifier and the client-side ride-out retry predicate
 * so both key off the same edge signal.
 */
export declare function isEdgeBlockErrorBody(message: string | undefined, status?: number): boolean;
export declare function isTransientHttpError(raw: string): boolean;
export declare function classifyFailoverReasonFromHttpStatus(status: number | undefined, message?: string, opts?: {
    provider?: string;
}): FailoverReason | null;
export declare function isGenericUnknownStreamErrorMessage(raw: string): boolean;
export declare function classifyFailoverSignal(signal: FailoverSignal): FailoverClassification | null;
export declare function classifyProviderRuntimeFailureKind(signal: FailoverSignal | string): ProviderRuntimeFailureKind;
export declare function classifyAssistantFailoverReason(msg: AssistantMessage | undefined, opts?: {
    provider?: string;
}): FailoverReason | null;
export declare function formatAssistantErrorText(msg: AssistantMessage, opts?: {
    cfg?: OpenClawConfig;
    sessionKey?: string;
    provider?: string;
    model?: string;
    /** Credential auth mode (e.g. "oauth", "token", "api_key", "aws-sdk").
     * When "oauth" or "token", billing copy omits API-key language (#80877). */
    authMode?: string;
}): string | undefined;
export declare function isRawAssistantErrorPassthrough(params: {
    friendlyError?: string;
    rawError?: string;
}): boolean;
export declare function formatUserFacingAssistantErrorText(msg: AssistantMessage, opts?: {
    cfg?: OpenClawConfig;
    sessionKey?: string;
    provider?: string;
    model?: string;
    /** Credential auth mode for billing copy (#80877). */
    authMode?: string;
}): string;
export declare function isRateLimitAssistantError(msg: AssistantMessage | undefined): boolean;
export declare function isMissingToolCallInputError(raw: string): boolean;
export declare function isBillingAssistantError(msg: AssistantMessage | undefined): boolean;
export declare function parseImageDimensionError(raw: string): {
    maxDimensionPx?: number;
    messageIndex?: number;
    contentIndex?: number;
    raw: string;
} | null;
export declare function isImageDimensionErrorMessage(raw: string): boolean;
export declare function parseImageSizeError(raw: string): {
    maxMb?: number;
    raw: string;
} | null;
export declare function isImageSizeError(errorMessage?: string): boolean;
export declare function isCloudCodeAssistFormatError(raw: string): boolean;
export declare function isAuthAssistantError(msg: AssistantMessage | undefined): boolean;
export declare function classifyFailoverReason(raw: string, opts?: {
    provider?: string;
}): FailoverReason | null;
export declare function isFailoverErrorMessage(raw: string, opts?: {
    provider?: string;
}): boolean;
export declare function isFailoverAssistantError(msg: AssistantMessage | undefined): boolean;
