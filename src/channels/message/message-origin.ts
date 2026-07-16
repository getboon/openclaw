/**
 * MessageOrigin gateway-failure code schema (ENG-15627 G5).
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
 * Gateway-failure codes. The first three predate ENG-15627 (specified in
 * message-lifecycle-refactor.md); the rest are the ENG-15627 additions.
 */
export const GATEWAY_FAILURE_CODES = [
  // Pre-existing (message-lifecycle-refactor.md).
  "agent_failed_before_reply",
  "missing_api_key",
  "model_login_expired",
  // ENG-15627 additions — classifier-backed failure classes.
  "token_allocation_exhausted",
  "model_context_length_exceeded",
  "provider_rate_limit_shared",
  "provider_upstream_5xx",
  "provider_malformed_history",
  "agent_failed_transient_after_retries",
  "subagent_still_working",
  // ENG-15739 addition — contextual class surfaced by the run-failure path.
  "boon_core_unreachable",
] as const;

export type GatewayFailureCode = (typeof GATEWAY_FAILURE_CODES)[number];

/**
 * How the user is expected to act on a failure:
 * - `user_can_retry` — resend when ready; nothing auto-retries.
 * - `will_auto_retry` — OpenClaw is retrying transparently; no user action.
 * - `requires_operator` — a fleet operator must fix config/credentials.
 * - `requires_billing_action` — an account/billing change is needed.
 */
export type RetryAffordance =
  | "user_can_retry"
  | "will_auto_retry"
  | "requires_operator"
  | "requires_billing_action";

export type MessageOrigin =
  | {
      source: "openclaw";
      schemaVersion: 1;
      kind: "gateway_failure";
      code: GatewayFailureCode;
      echoPolicy: "drop_bot_room_echo";
    }
  | {
      source: "user" | "external_bot" | "platform" | "unknown";
    };

/** The gateway-failure branch of MessageOrigin, narrowed for convenience. */
export type GatewayFailureOrigin = Extract<MessageOrigin, { kind: "gateway_failure" }>;

const CODE_COPY: Record<GatewayFailureCode, string> = {
  agent_failed_before_reply:
    "Something went wrong before I could reply. Please try again in a moment.",
  missing_api_key:
    "This agent isn't configured with a working API credential yet. An operator needs to set it up.",
  model_login_expired:
    "The model login for this agent has expired. An operator needs to re-authenticate it.",
  token_allocation_exhausted:
    "This account has reached its usage allocation. Top up or contact your account team, then try again.",
  model_context_length_exceeded:
    "That request is too large for the model's context window. Start a fresh session or shorten the input.",
  provider_rate_limit_shared:
    "The AI service is rate limited right now — I'm retrying automatically. This may take a moment.",
  provider_upstream_5xx:
    "The AI service returned a temporary error — I'm retrying automatically. This may take a moment.",
  provider_malformed_history:
    "The session history got into a bad state. Start a fresh session and try again.",
  agent_failed_transient_after_retries:
    "Something went wrong and automatic retries didn't recover. Please try again in a moment.",
  subagent_still_working:
    "Still working on this in the background — I'll follow up when it's done.",
  boon_core_unreachable:
    "I couldn't reach your project data just now. General chat still works — please try that request again in a moment.",
};

const CODE_RETRY_AFFORDANCE: Record<GatewayFailureCode, RetryAffordance> = {
  agent_failed_before_reply: "user_can_retry",
  missing_api_key: "requires_operator",
  model_login_expired: "requires_operator",
  token_allocation_exhausted: "requires_billing_action",
  model_context_length_exceeded: "user_can_retry",
  provider_rate_limit_shared: "will_auto_retry",
  provider_upstream_5xx: "will_auto_retry",
  provider_malformed_history: "user_can_retry",
  agent_failed_transient_after_retries: "user_can_retry",
  subagent_still_working: "will_auto_retry",
  // The copy tells the user to retry (no automatic retry is promised), so the
  // affordance is user_can_retry — and this keeps its scoped copy from being
  // downgraded as a stale "retrying automatically" claim at a terminal failure.
  boon_core_unreachable: "user_can_retry",
};

/** Canonical user-facing sentence for a gateway-failure code. */
export function messageOriginCodeCopy(code: GatewayFailureCode): string {
  return CODE_COPY[code];
}

/** How the user is expected to act on a gateway-failure code. */
export function messageOriginCodeRetryAffordance(code: GatewayFailureCode): RetryAffordance {
  return CODE_RETRY_AFFORDANCE[code];
}

/** Build an OpenClaw-originated gateway_failure origin for a code. */
export function makeGatewayFailureOrigin(code: GatewayFailureCode): GatewayFailureOrigin {
  return {
    source: "openclaw",
    schemaVersion: 1,
    kind: "gateway_failure",
    code,
    echoPolicy: "drop_bot_room_echo",
  };
}

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
export function resolveEmittableGatewayFailure(
  code: GatewayFailureCode | undefined,
  opts: { isDirect: boolean },
): GatewayFailureOrigin | undefined {
  if (code) {
    return makeGatewayFailureOrigin(code);
  }
  if (!opts.isDirect) {
    return undefined;
  }
  return makeGatewayFailureOrigin("agent_failed_transient_after_retries");
}
