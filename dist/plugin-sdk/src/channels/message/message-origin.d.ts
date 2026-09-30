/**
 * MessageOrigin gateway-failure code schema.
 *
 * Origin describes who produced a message and how OpenClaw should treat echoes
 * of it (see docs/concepts/message-lifecycle-refactor.md — this is the shape the
 * lifecycle refactor adopts). OpenClaw-originated gateway-failure output must be
 * tagged so shared rooms with `allowBots` do not accept it as bot-authored
 * input, and so every channel renders the same classified copy instead of
 * channel-specific error prose.
 *
 * G5 extends the enum with the failure classes surfaced by the classifier (G1)
 * and adds, per code, a canonical user-facing sentence + a retry affordance.
 * The fail-closed resolver is the invariant that makes G2 mechanical: a failure
 * path with no code is dropped in non-direct chats and downgraded to a generic
 * transient code in DMs — a raw string can never leak as a coded emit.
 */
/**
 * Gateway-failure codes. The first three predate the later additions (specified in
 * message-lifecycle-refactor.md); the rest were added afterward.
 */
export declare const GATEWAY_FAILURE_CODES: readonly ["agent_failed_before_reply", "missing_api_key", "model_login_expired", "token_allocation_exhausted", "model_context_length_exceeded", "provider_rate_limit_shared", "provider_upstream_5xx", "provider_malformed_history", "agent_failed_transient_after_retries", "subagent_still_working", "boon_core_unreachable"];
export type GatewayFailureCode = (typeof GATEWAY_FAILURE_CODES)[number];
/**
 * How the user is expected to act on a failure:
 * - `user_can_retry` — resend when ready; nothing auto-retries.
 * - `will_auto_retry` — OpenClaw is retrying transparently; no user action.
 * - `requires_operator` — a fleet operator must fix config/credentials.
 * - `requires_billing_action` — an account/billing change is needed.
 */
export type RetryAffordance = "user_can_retry" | "will_auto_retry" | "requires_operator" | "requires_billing_action";
export type MessageOrigin = {
    source: "openclaw";
    schemaVersion: 1;
    kind: "gateway_failure";
    code: GatewayFailureCode;
    echoPolicy: "drop_bot_room_echo";
} | {
    source: "user" | "external_bot" | "platform" | "unknown";
};
/** The gateway-failure branch of MessageOrigin, narrowed for convenience. */
export type GatewayFailureOrigin = Extract<MessageOrigin, {
    kind: "gateway_failure";
}>;
/** Canonical user-facing sentence for a gateway-failure code. */
export declare function messageOriginCodeCopy(code: GatewayFailureCode): string;
/** How the user is expected to act on a gateway-failure code. */
export declare function messageOriginCodeRetryAffordance(code: GatewayFailureCode): RetryAffordance;
/** Build an OpenClaw-originated gateway_failure origin for a code. */
export declare function makeGatewayFailureOrigin(code: GatewayFailureCode): GatewayFailureOrigin;
/**
 * Fail-closed resolver for a gateway failure about to be emitted.
 *
 * - A classified `code` is emitted as-is in any chat kind.
 * - An uncoded failure is DROPPED in non-direct chats (per the existing
 *   silent-reply policy — groups/channels never see gateway boilerplate).
 * - An uncoded failure in a DM is downgraded to
 *   `agent_failed_transient_after_retries`, so the user gets a safe generic
 *   message and a raw string can never leak as a coded emit.
 */
export declare function resolveEmittableGatewayFailure(code: GatewayFailureCode | undefined, opts: {
    isDirect: boolean;
}): GatewayFailureOrigin | undefined;
