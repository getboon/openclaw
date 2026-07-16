// Covers the MessageOrigin gateway-failure code schema (ENG-15627 G5):
// canonical user copy, retry affordance mapping, and the fail-closed
// emit resolver.
import { describe, expect, it } from "vitest";
import {
  GATEWAY_FAILURE_CODES,
  makeGatewayFailureOrigin,
  messageOriginCodeCopy,
  messageOriginCodeRetryAffordance,
  resolveEmittableGatewayFailure,
} from "./message-origin.js";

describe("gateway-failure code registry", () => {
  it("includes the pre-existing design-doc codes plus the ENG-15627 additions", () => {
    // The three codes already specified in message-lifecycle-refactor.md must
    // survive, and the seven ENG-15627 codes must be added.
    expect(GATEWAY_FAILURE_CODES).toEqual(
      expect.arrayContaining([
        "agent_failed_before_reply",
        "missing_api_key",
        "model_login_expired",
        "token_allocation_exhausted",
        "model_context_length_exceeded",
        "provider_rate_limit_shared",
        "provider_upstream_5xx",
        "provider_malformed_history",
        "agent_failed_transient_after_retries",
        "subagent_still_working",
        "boon_core_unreachable",
      ]),
    );
  });

  it("gives every code a non-empty, non-raw canonical sentence", () => {
    for (const code of GATEWAY_FAILURE_CODES) {
      const copy = messageOriginCodeCopy(code);
      expect(copy.length).toBeGreaterThan(0);
      // Copy must be human-facing prose, never the machine code itself.
      expect(copy).not.toContain(code);
    }
  });

  it("maps every code to a retry affordance", () => {
    for (const code of GATEWAY_FAILURE_CODES) {
      expect([
        "user_can_retry",
        "will_auto_retry",
        "requires_operator",
        "requires_billing_action",
      ]).toContain(messageOriginCodeRetryAffordance(code));
    }
  });

  it("routes billing/allocation to a billing action and transient classes to auto-retry", () => {
    expect(messageOriginCodeRetryAffordance("token_allocation_exhausted")).toBe(
      "requires_billing_action",
    );
    expect(messageOriginCodeRetryAffordance("provider_upstream_5xx")).toBe("will_auto_retry");
    expect(messageOriginCodeRetryAffordance("provider_rate_limit_shared")).toBe("will_auto_retry");
    expect(messageOriginCodeRetryAffordance("agent_failed_transient_after_retries")).toBe(
      "user_can_retry",
    );
    expect(messageOriginCodeRetryAffordance("missing_api_key")).toBe("requires_operator");
  });
});

describe("makeGatewayFailureOrigin", () => {
  it("builds a schema-versioned openclaw gateway_failure origin", () => {
    const origin = makeGatewayFailureOrigin("token_allocation_exhausted");
    expect(origin).toEqual({
      source: "openclaw",
      schemaVersion: 1,
      kind: "gateway_failure",
      code: "token_allocation_exhausted",
      echoPolicy: "drop_bot_room_echo",
    });
  });
});

describe("resolveEmittableGatewayFailure (fail-closed)", () => {
  it("passes a classified code through in any chat kind", () => {
    const direct = resolveEmittableGatewayFailure("provider_upstream_5xx", { isDirect: true });
    expect(direct?.code).toBe("provider_upstream_5xx");
    const group = resolveEmittableGatewayFailure("provider_upstream_5xx", { isDirect: false });
    expect(group?.code).toBe("provider_upstream_5xx");
  });

  it("drops an uncoded failure in non-direct chats (silent-reply policy)", () => {
    expect(resolveEmittableGatewayFailure(undefined, { isDirect: false })).toBeUndefined();
  });

  it("downgrades an uncoded failure to agent_failed_transient_after_retries in DMs", () => {
    const origin = resolveEmittableGatewayFailure(undefined, { isDirect: true });
    expect(origin?.code).toBe("agent_failed_transient_after_retries");
  });
});

describe("boon_core_unreachable copy", () => {
  it("is a scoped, customer-safe sentence that reassures general chat still works", () => {
    const copy = messageOriginCodeCopy("boon_core_unreachable");
    expect(copy.toLowerCase()).toContain("project data");
    expect(copy).not.toContain("boon_core_unreachable");
  });

  it("is user_can_retry — its copy tells the user to retry, not that it auto-retries", () => {
    expect(messageOriginCodeRetryAffordance("boon_core_unreachable")).toBe("user_can_retry");
  });
});
