// Deterministic mapping from a thrown agent-run failure to a GatewayFailureCode
// (ENG-15739). Each class must map to exactly one code so the same failure
// always yields the same customer-facing copy.
import { describe, expect, it } from "vitest";
import { FailoverError } from "../../agents/failover-error.js";
import { FallbackSummaryError } from "../../agents/model-fallback.js";
import type { FallbackAttempt } from "../../agents/model-fallback.types.js";
import {
  isBoonCoreUnreachableError,
  resolveDominantFailoverReason,
  resolveGatewayFailureCode,
} from "./gateway-failure-code.js";

function summary(attempts: Array<Partial<FallbackAttempt>>): FallbackSummaryError {
  const full: FallbackAttempt[] = attempts.map((a) => ({
    provider: a.provider ?? "prov",
    model: a.model ?? "model",
    error: a.error ?? "failed",
    ...(a.reason ? { reason: a.reason } : {}),
    ...(a.status ? { status: a.status } : {}),
  }));
  return new FallbackSummaryError("All candidates failed", full, null);
}

describe("resolveGatewayFailureCode", () => {
  it("maps allocation-exhausted to token_allocation_exhausted", () => {
    const err = new FailoverError("Token allocation exhausted for this org", {
      reason: "billing",
    });
    expect(resolveGatewayFailureCode(err)).toBe("token_allocation_exhausted");
  });

  it("maps a bare allocation_exhausted message to token_allocation_exhausted", () => {
    expect(resolveGatewayFailureCode(new Error("allocation_exhausted"))).toBe(
      "token_allocation_exhausted",
    );
  });

  it("maps context overflow to model_context_length_exceeded", () => {
    const err = new Error("prompt is too long: 250000 tokens > 200000 maximum");
    expect(resolveGatewayFailureCode(err)).toBe("model_context_length_exceeded");
  });

  it("maps rate_limit and overloaded to provider_rate_limit_shared", () => {
    expect(resolveGatewayFailureCode(new FailoverError("429", { reason: "rate_limit" }))).toBe(
      "provider_rate_limit_shared",
    );
    expect(resolveGatewayFailureCode(new FailoverError("529", { reason: "overloaded" }))).toBe(
      "provider_rate_limit_shared",
    );
  });

  it("maps server_error / timeout / transient 5xx status to provider_upstream_5xx", () => {
    expect(resolveGatewayFailureCode(new FailoverError("boom", { reason: "server_error" }))).toBe(
      "provider_upstream_5xx",
    );
    expect(resolveGatewayFailureCode(new FailoverError("slow", { reason: "timeout" }))).toBe(
      "provider_upstream_5xx",
    );
    expect(
      resolveGatewayFailureCode(
        new FailoverError("bad gateway", { reason: "unknown", status: 502 }),
      ),
    ).toBe("provider_upstream_5xx");
  });

  it("maps malformed-history classes to provider_malformed_history", () => {
    expect(resolveGatewayFailureCode(new FailoverError("bad shape", { reason: "format" }))).toBe(
      "provider_malformed_history",
    );
    expect(
      resolveGatewayFailureCode(new FailoverError("expired", { reason: "session_expired" })),
    ).toBe("provider_malformed_history");
    expect(
      resolveGatewayFailureCode(
        new Error("messages: roles must alternate between user and assistant"),
      ),
    ).toBe("provider_malformed_history");
  });

  it("maps auth-without-attribution to the transient class (no false operator-blame)", () => {
    expect(resolveGatewayFailureCode(new FailoverError("401", { reason: "auth" }))).toBe(
      "agent_failed_transient_after_retries",
    );
  });

  it("maps unclassified / empty / model_not_found to agent_failed_transient_after_retries", () => {
    expect(resolveGatewayFailureCode(new Error("something inexplicable"))).toBe(
      "agent_failed_transient_after_retries",
    );
    expect(
      resolveGatewayFailureCode(new FailoverError("empty", { reason: "empty_response" })),
    ).toBe("agent_failed_transient_after_retries");
  });

  it("maps boon-core connectivity failures to boon_core_unreachable", () => {
    const err = new Error("connect ECONNREFUSED app.getboon.ai/api/v1/agent/config");
    expect(resolveGatewayFailureCode(err)).toBe("boon_core_unreachable");
  });

  it("is deterministic — same class yields the same code across calls", () => {
    const mk = () => new FailoverError("429", { reason: "rate_limit" });
    expect(resolveGatewayFailureCode(mk())).toBe(resolveGatewayFailureCode(mk()));
  });
});

describe("resolveDominantFailoverReason", () => {
  it("returns the reason of a FailoverError directly", () => {
    expect(resolveDominantFailoverReason(new FailoverError("x", { reason: "timeout" }))).toBe(
      "timeout",
    );
  });

  it("prefers billing over transient reasons in a mixed FallbackSummaryError", () => {
    expect(
      resolveDominantFailoverReason(
        summary([{ reason: "rate_limit" }, { reason: "billing" }, { reason: "timeout" }]),
      ),
    ).toBe("billing");
  });

  it("prefers a hard reason (format) over a transient one (overloaded)", () => {
    expect(
      resolveDominantFailoverReason(summary([{ reason: "overloaded" }, { reason: "format" }])),
    ).toBe("format");
  });

  it("falls back to the last transient reason when no hard reason is present", () => {
    expect(
      resolveDominantFailoverReason(summary([{ reason: "rate_limit" }, { reason: "overloaded" }])),
    ).toBe("rate_limit");
  });
});

describe("isBoonCoreUnreachableError", () => {
  it("detects a boon-core host connection failure", () => {
    expect(
      isBoonCoreUnreachableError("fetch failed: ECONNREFUSED https://app.getboon.ai/api/v1/x"),
    ).toBe(true);
  });

  it("does not fire on a generic provider transport error", () => {
    expect(isBoonCoreUnreachableError("ETIMEDOUT api.anthropic.com")).toBe(false);
  });
});
