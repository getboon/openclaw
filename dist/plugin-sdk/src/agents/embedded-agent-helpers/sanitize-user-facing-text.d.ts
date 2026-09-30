export declare const BOON_BILLING_URL = "https://app.getboon.ai/billing?open=agent";
/** Format the billing failure copy.
 *
 * Boon-fork copy: a Boon user always runs against their org's Boon token
 * allocation through the boon-llm-gateway — there is no provider API key to
 * "switch" and no provider billing dashboard they can reach. So EVERY billing
 * failure gets plain, non-technical wording pointing at the Boon billing page,
 * never the upstream "check your provider's billing dashboard / switch to a
 * different API key" text.
 *
 * This is the safety net: it fires for any billing-classified failure whose
 * specific gateway exhaustion code (allocation_exhausted / trial_budget_exhausted)
 * did NOT survive into the message/body the classifier sees (e.g. the Anthropic
 * transport surfaces a bare "HTTP 402" with no code). The dedicated
 * trial-vs-paid exhaustion copy in errors.ts is still preferred when the code IS
 * recognized. The provider/model/authMode params are retained for call-site
 * compatibility but no longer change the user-facing wording.
 */
export declare function formatBillingErrorMessage(_provider?: string, _model?: string, _authMode?: string): string;
export declare const BILLING_ERROR_USER_MESSAGE: string;
export declare function formatRateLimitOrOverloadedErrorCopy(raw: string): string | undefined;
export declare function formatTransportErrorCopy(raw: string): string | undefined;
export declare function formatDiskSpaceErrorCopy(raw: string): string | undefined;
export declare function isInvalidStreamingEventOrderError(raw: string): boolean;
export declare function isStreamingJsonParseError(raw: string): boolean;
export declare function getApiErrorPayloadFingerprint(raw?: string): string | null;
export declare function isRawApiErrorPayload(raw?: string): boolean;
export declare function isLikelyHttpErrorText(raw: string): boolean;
export declare function sanitizeUserFacingText(text: unknown, opts?: {
    errorContext?: boolean;
}): string;
