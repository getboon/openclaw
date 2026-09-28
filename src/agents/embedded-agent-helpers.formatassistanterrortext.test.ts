// Covers user-facing formatting and sanitization of assistant/provider errors.
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE } from "../shared/assistant-error-format.js";
import {
  BILLING_ERROR_USER_MESSAGE,
  buildTokenExhaustedPresentation,
  classifyAssistantFailoverReason,
  formatBillingErrorMessage,
  formatAssistantErrorText,
  formatUserFacingAssistantErrorText,
  getApiErrorPayloadFingerprint,
  formatRawAssistantErrorForUi,
  isRawApiErrorPayload,
  isTrialBudgetExhaustedErrorMessage,
  sanitizeUserFacingText,
} from "./embedded-agent-helpers.js";
import { makeAssistantMessageFixture } from "./test-helpers/assistant-message-fixtures.js";

describe("formatAssistantErrorText", () => {
  const makeAssistantError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });
  const authInvalidTokenCopy =
    "Authentication failed (provider returned HTTP 401). " +
    "Your provider token may have expired — try the request again in a moment. " +
    "If the failure persists, re-authenticate this provider.";

  it("returns a friendly message for context overflow", () => {
    const msg = makeAssistantError("request_too_large");
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns context overflow for Anthropic 'Request size exceeds model context window'", () => {
    // This Anthropic shape must map to context overflow so auto-compaction can
    // trigger instead of treating it as a generic schema rejection.
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error","message":"Request size exceeds model context window"}}',
    );
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns context overflow for Kimi 'model token limit' errors", () => {
    const msg = makeAssistantError(
      "error, status code: 400, message: Invalid request: Your request exceeded model token limit: 262144 (requested: 291351)",
    );
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns context overflow for Ollama 'prompt too long' errors (#34005)", () => {
    const msg = makeAssistantError(
      'Ollama API error 400: {"StatusCode":400,"Status":"400 Bad Request","error":"prompt too long; exceeded max context length by 4 tokens"}',
    );
    expect(formatAssistantErrorText(msg)).toContain("Context overflow");
  });
  it("returns a reasoning-required message for mandatory reasoning endpoint errors", () => {
    const msg = makeAssistantError(
      "400 Reasoning is mandatory for this endpoint and cannot be disabled.",
    );
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Reasoning is required");
    expect(result).toContain("/think minimal");
    expect(result).not.toContain("Context overflow");
  });
  it("returns a friendly message for Anthropic role ordering", () => {
    const msg = makeAssistantError('messages: roles must alternate between "user" and "assistant"');
    expect(formatAssistantErrorText(msg)).toContain("Message ordering conflict");
  });
  it("returns a friendly message for Anthropic overload errors", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service is temporarily overloaded. Please try again in a moment.",
    );
  });
  it("rewrites generic provider internal errors without support request ids", () => {
    const msg = makeAssistantError(
      "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID synthetic-provider-request-001 in your message.",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service returned an internal error. Please try again in a moment.",
    );
  });
  it("rewrites request-id-only generic provider internal errors without exposing the id", () => {
    const msg = makeAssistantError(
      "An error occurred while processing your request. Please include request ID req_synthetic_provider_request_001 in your message.",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The AI service returned an internal error. Please try again in a moment.",
    );
  });
  it("returns a model-switch hint for OpenAI model capacity errors", () => {
    const msg = makeAssistantError("Selected model is at capacity. Please try a different model.");
    expect(formatAssistantErrorText(msg)).toBe(
      "⚠️ Selected model is at capacity. Try a different model, or wait and retry.",
    );
  });
  it("returns a recovery hint when tool call input is missing", () => {
    const msg = makeAssistantError("tool_use.input: Field required");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Session history looks corrupted");
    expect(result).toContain("/new");
  });
  it("returns a recovery hint for replay-invalid connection mismatch errors", () => {
    const msg = makeAssistantError("401 input item ID does not belong to this connection");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Session history or replay state is invalid");
    expect(result).toContain("/new");
  });
  it("handles JSON-wrapped role errors", () => {
    const msg = makeAssistantError('{"error":{"message":"400 Incorrect role information"}}');
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("Message ordering conflict");
    expect(result).not.toContain("400");
  });
  it("suppresses raw error JSON payloads that are not otherwise classified", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"message":"Something exploded","type":"server_error"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe("LLM error server_error: Something exploded");
  });
  it("classifies provider upstream_error payloads as server errors for fallback", () => {
    const msg = makeAssistantMessageFixture({
      errorMessage: "Upstream request failed",
      errorType: "upstream_error",
    });

    expect(classifyAssistantFailoverReason(msg, { provider: "openai" })).toBe("server_error");
    expect(
      classifyAssistantFailoverReason(
        makeAssistantError(
          '{"error":{"message":"Upstream request failed","type":"upstream_error","param":"","code":null}}',
        ),
      ),
    ).toBe("server_error");
  });
  it("uses generic user-facing copy for escaped structured provider messages", () => {
    // The internal formatter keeps detail for logs, while user-facing text must
    // not expose arbitrary provider-controlled structured payload content.
    const msg = makeAssistantError(
      '{"type":"error","error":{"message":"SECRET\\nCANARY","type":"invalid_request_error"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe("LLM error invalid_request_error: SECRET\nCANARY");
    expect(formatUserFacingAssistantErrorText(msg)).toBe(
      "LLM request failed: provider rejected the request schema or tool payload.",
    );
  });
  it("sanitizes Codex error-prefixed JSON payloads", () => {
    const msg = makeAssistantError(
      'Codex error: {"type":"error","error":{"message":"Something exploded","type":"server_error"},"sequence_number":2}',
    );
    expect(formatAssistantErrorText(msg)).toBe("LLM error server_error: Something exploded");
  });
  it("returns a friendly billing message for credit balance errors", () => {
    const msg = makeAssistantError("Your credit balance is too low to access the Anthropic API.");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("returns a friendly billing message for HTTP 402 errors", () => {
    const msg = makeAssistantError("HTTP 402 Payment Required");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("returns a friendly billing message for insufficient credits", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
  });
  it("uses Boon billing copy regardless of provider (no provider internals leaked)", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg, { provider: "Anthropic" });
    // Boon fork: provider name no longer changes the wording — a Boon user has no
    // provider account. Always the Boon top-up copy.
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
    expect(result).toContain("out of Boon Agent tokens");
    expect(result).not.toContain("Anthropic");
    expect(result).not.toContain("API provider");
  });
  it("ignores the active assistant model for billing copy", () => {
    const msg = makeAssistantError("insufficient credits");
    msg.model = "claude-3-5-sonnet";
    const result = formatAssistantErrorText(msg, { provider: "Anthropic" });
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
    expect(result).not.toContain("claude-3-5-sonnet");
  });
  it("returns Boon billing copy when provider is not given", () => {
    const msg = makeAssistantError("insufficient credits");
    const result = formatAssistantErrorText(msg);
    expect(result).toBe(BILLING_ERROR_USER_MESSAGE);
    expect(result).toContain("out of Boon Agent tokens");
  });
  it("returns a friendly billing message for flat JSON insufficient_balance payloads (#74079)", () => {
    const msg = makeAssistantError(
      '{"error":"insufficient_balance","message":"Insufficient MBT balance. Top up or upgrade your subscription to continue.","upgradeUrl":"/settings/billing"}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "google",
      model: "gemini-3.1-pro-preview",
    });
    expect(result).toBe(formatBillingErrorMessage("google", "gemini-3.1-pro-preview"));
  });
  it("returns a billing message for xAI 429 credit exhaustion before rate-limit copy", () => {
    // Some providers report billing exhaustion as 429; billing copy should win
    // when the payload carries high-confidence credit language.
    const msg = makeAssistantError(
      '429 {"code":"Some resource has been exhausted","error":"Your team team-redacted has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "xai",
      model: "grok-4.3",
    });
    expect(result).toBe(formatBillingErrorMessage("xai", "grok-4.3"));
  });
  it("keeps known Moonshot 429 balance failures on billing copy", () => {
    const msg = makeAssistantError(
      '429 {"error":{"message":"Your account has insufficient balance. Please recharge to continue.","type":"rate_limit_reached"}}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "moonshot",
      model: "kimi-k2",
    });
    expect(result).toBe(formatBillingErrorMessage("moonshot", "kimi-k2"));
  });
  it("keeps high-confidence 429 insufficient quota failures on billing copy", () => {
    const msg = makeAssistantError(
      '429 {"type":"error","error":{"type":"insufficient_quota","message":"Your account has insufficient quota balance to run this request."}}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "openai",
      model: "gpt-5.5",
    });
    expect(result).toBe(formatBillingErrorMessage("openai", "gpt-5.5"));
  });
  it("keeps high-confidence 429 insufficient balance failures on billing copy", () => {
    const msg = makeAssistantError(
      '429 {"error":"insufficient_balance","message":"Your credit balance is too low."}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "openai-compatible",
      model: "custom-model",
    });
    expect(result).toBe(formatBillingErrorMessage("openai-compatible", "custom-model"));
  });
  it("keeps structured 429 insufficient balance codes on billing copy", () => {
    const msg = makeAssistantError(
      'HTTP 429: {"error":"insufficient_balance","message":"Insufficient account balance"}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "openai-compatible",
      model: "custom-model",
    });
    expect(result).toBe(formatBillingErrorMessage("openai-compatible", "custom-model"));
  });
  it("keeps 429 more-credits failures on billing copy", () => {
    const msg = makeAssistantError("429 This model requires more credits to use");
    const result = formatAssistantErrorText(msg, {
      provider: "openai-compatible",
      model: "custom-model",
    });
    expect(result).toBe(formatBillingErrorMessage("openai-compatible", "custom-model"));
  });
  it("keeps OpenRouter 429 key budget failures on billing copy", () => {
    const msg = makeAssistantError("429 API key budget limit exceeded");
    const result = formatAssistantErrorText(msg, {
      provider: "openrouter",
      model: "openai/gpt-5.5",
    });
    expect(result).toBe(formatBillingErrorMessage("openrouter", "openai/gpt-5.5"));
  });
  it("returns billing guidance for Volcengine Coding Plan subscription failures", () => {
    const msg = makeAssistantError(
      'HTTP 400 Bad Request: {"error":{"code":"InvalidSubscription","message":"Your account does not have a valid CodingPlan subscription, or your subscription has expired."}}',
    );
    const result = formatAssistantErrorText(msg, {
      provider: "volcengine-plan",
      model: "ark-code-latest",
    });
    expect(result).toBe(formatBillingErrorMessage("volcengine-plan", "ark-code-latest"));
  });
  it("returns a friendly message for rate limit errors", () => {
    const msg = makeAssistantError("429 rate limit reached");
    expect(formatAssistantErrorText(msg)).toContain("rate limit reached");
  });
  it("keeps plain HTTP rate-limit guidance user-facing", () => {
    const msg = makeAssistantError("429 Your quota has been exhausted, try again in 24 hours");
    expect(formatAssistantErrorText(msg)).toContain("24 hours");
    expect(formatUserFacingAssistantErrorText(msg)).toContain("24 hours");
  });

  it("surfaces provider-specific rate limit message with reset time (#54433)", () => {
    const msg = makeAssistantError(
      "You have hit your ChatGPT usage limit (go plan). Try again in ~4381 min.",
    );
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("4381 min");
    expect(result).toContain("go plan");
    expect(result).not.toBe("⚠️ API rate limit reached. Please try again later.");
  });

  it("surfaces provider-specific rate limit message from JSON payload (#54433)", () => {
    const msg = makeAssistantError(
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached. Try again in 30 seconds."}}',
    );
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("30 seconds");
    expect(result).not.toBe("⚠️ API rate limit reached. Please try again later.");
    expect(formatUserFacingAssistantErrorText(msg)).toContain("30 seconds");
  });

  it("returns generic rate limit message when no specific details are present", () => {
    const msg = makeAssistantError("429 Too Many Requests");
    expect(formatAssistantErrorText(msg)).toBe(
      "⚠️ API rate limit reached. Please try again later.",
    );
  });

  it("strips leading HTTP status code prefix from non-JSON rate limit messages", () => {
    const msg = makeAssistantError("429 Your quota has been exhausted, try again in 24 hours");
    const result = formatAssistantErrorText(msg);
    expect(result).toContain("try again in 24 hours");
    expect(result).not.toMatch(/^⚠️ 429\b/);
    expect(result).toBe("⚠️ Your quota has been exhausted, try again in 24 hours");
  });

  it("returns upstream HTML copy for HTML quota pages", () => {
    const msg = makeAssistantError(
      "429 <!DOCTYPE html><html><body>Your quota is exhausted</body></html>",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The provider returned an HTML error page instead of an API response. This usually means a CDN or gateway (e.g. Cloudflare) blocked the request. Retry in a moment or check provider status.",
    );
  });

  it("returns upstream HTML copy for prefixed 521 HTML rate-limit pages", () => {
    const msg = makeAssistantError(
      "Error: 521 <!DOCTYPE html><html><body>rate limit</body></html>",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "The provider returned an HTML error page instead of an API response. This usually means a CDN or gateway (e.g. Cloudflare) blocked the request. Retry in a moment or check provider status.",
    );
  });

  it("does not misdiagnose standalone Cloudflare challenge HTML as DNS", () => {
    const msg = makeAssistantError(`<!DOCTYPE html>
<html>
  <head>
    <title>Just a moment...</title>
    <link rel="dns-prefetch" href="//chatgpt.com">
  </head>
  <body>
    <span id="challenge-error-text">Enable JavaScript and cookies to continue</span>
    <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
  </body>
</html>`);
    expect(formatAssistantErrorText(msg)).toBe(
      "The provider returned an HTML error page instead of an API response. This usually means a CDN or gateway (e.g. Cloudflare) blocked the request. Retry in a moment or check provider status.",
    );
  });

  it("returns a friendly message for empty stream chunk errors", () => {
    const msg = makeAssistantError("request ended without sending any chunks");
    expect(formatAssistantErrorText(msg)).toBe("LLM request timed out.");
  });

  it("returns a connection-refused message for ECONNREFUSED failures", () => {
    const msg = makeAssistantError("connect ECONNREFUSED 127.0.0.1:443 during upstream call");
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request failed: connection refused by the provider endpoint.",
    );
  });

  it.each(["disk full", "ENOSPC: no space left on device, write"])(
    "returns a friendly disk-space message for %s",
    (errorMessage) => {
      const msg = makeAssistantError(errorMessage);
      expect(formatAssistantErrorText(msg)).toBe(
        "OpenClaw could not write local session data because the disk is full. Free some disk space and try again.",
      );
    },
  );

  it("returns a DNS-specific message for provider lookup failures", () => {
    const msg = makeAssistantError("dial tcp: lookup api.example.com: no such host (ENOTFOUND)");
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request failed: DNS lookup for the provider endpoint failed.",
    );
  });

  it("returns an interrupted-connection message for socket hang ups", () => {
    const msg = makeAssistantError("socket hang up");
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request failed: network connection was interrupted.",
    );
  });

  it("returns an explicit re-authentication message for OAuth refresh failures", () => {
    const msg = makeAssistantError(
      "OAuth token refresh failed for openai: invalid_grant. Please try again or re-authenticate.",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication refresh failed. Re-authenticate this provider and try again.",
    );
  });

  it("returns an explicit re-authentication message for Codex app-server refresh failures", () => {
    const msg = makeAssistantError(
      "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication refresh failed. Re-authenticate this provider and try again.",
    );
  });

  it("returns a contention-specific message for OAuth refresh lock timeouts", () => {
    const msg = makeAssistantError("file lock timeout for /tmp/openclaw-oauth-refresh.lock");
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication refresh is already in progress elsewhere and this attempt timed out waiting for it. Retry in a moment.",
    );
  });

  it("returns a timeout-specific message for OAuth refresh hard timeouts", () => {
    const msg = makeAssistantError(
      'OAuth refresh call "refreshProviderOAuthCredentialWithPlugin(openai)" exceeded hard timeout (120000ms)',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication refresh timed out before the provider completed. Retry in a moment; re-authenticate only if it keeps failing.",
    );
  });

  it("returns a missing-scope message for OpenAI ChatGPT scope failures", () => {
    const msg = makeAssistantError(
      '401 {"type":"error","error":{"type":"permission_error","message":"Missing scopes: api.responses.write model.request"}}',
    );
    expect(formatAssistantErrorText(msg, { provider: "openai" })).toBe(
      "Authentication is missing the required OpenAI ChatGPT scopes. Re-run OpenAI login and try again.",
    );
  });

  it("returns a missing-scope message for raw OpenAI ChatGPT scope payloads without an HTTP prefix", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"permission_error","message":"Missing scopes: api.responses.write model.request"},"code":401}',
    );
    expect(formatAssistantErrorText(msg, { provider: "openai" })).toBe(
      "Authentication is missing the required OpenAI ChatGPT scopes. Re-run OpenAI login and try again.",
    );
  });

  it("does not misdiagnose other provider permission errors as OpenAI scope failures", () => {
    const msg = makeAssistantError(
      '401 {"type":"error","error":{"type":"permission_error","message":"Missing scopes: api.responses.write model.request"}}',
    );
    expect(formatAssistantErrorText(msg, { provider: "anthropic" })).not.toContain(
      "required OpenAI ChatGPT scopes",
    );
  });

  it("does not misdiagnose generic OpenAI permission failures as missing-scope failures", () => {
    const msg = makeAssistantError(
      '403 {"type":"error","error":{"type":"permission_error","message":"Insufficient permissions for this organization"}}',
    );
    expect(formatAssistantErrorText(msg, { provider: "openai" })).not.toContain(
      "required OpenAI ChatGPT scopes",
    );
  });

  it("returns re-authentication copy for HTML provider 401 auth failures", () => {
    const msg = makeAssistantError("401 <!DOCTYPE html><html><body>Unauthorized</body></html>");
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication failed at the provider. Re-authenticate and verify your provider credentials and account access.",
    );
  });

  it("returns re-authentication copy for HTML provider 403 auth failures", () => {
    const msg = makeAssistantError("403 <!DOCTYPE html><html><body>Access denied</body></html>");
    expect(formatAssistantErrorText(msg)).toBe(
      "Authentication failed at the provider. Re-authenticate and verify your provider credentials and account access.",
    );
  });

  it("sanitizes raw HTTP 401 / Invalid token errors into a re-auth hint (#56197)", () => {
    const reportedPayload = makeAssistantError('HTTP 401: "Invalid token"');
    const friendly = formatAssistantErrorText(reportedPayload);
    expect(friendly).toBe(authInvalidTokenCopy);
    expect(friendly).not.toContain("Invalid token");
  });

  it("sanitizes Unauthorized / token-expired variants under HTTP 401", () => {
    const variants = [
      "401 Unauthorized",
      "HTTP 401 Unauthorized: token expired",
      "HTTP 401: Incorrect API key provided",
      'status code: 401, message: "expired token"',
      '401 {"type":"error","error":{"type":"permission_error","message":"Invalid token"}}',
    ];
    for (const raw of variants) {
      const friendly = formatAssistantErrorText(makeAssistantError(raw));
      expect(friendly, raw).toBe(authInvalidTokenCopy);
    }
  });

  it("does not collapse 401 billing / permanent-auth errors into the generic re-auth hint", () => {
    const billing = makeAssistantError(
      '{"error":{"code":401,"message":"Key limit exceeded","metadata":{"raw":"insufficient credits"}}}',
    );
    const billingFriendly = formatAssistantErrorText(billing);
    expect(billingFriendly).not.toBe(authInvalidTokenCopy);
  });

  it("does not claim HTTP 401 for plain 403 errors that fall through to the generic auth reason (#77394 review)", () => {
    const plain403 = makeAssistantError("403 Forbidden");
    const friendly = formatAssistantErrorText(plain403);
    expect(friendly).toBeDefined();
    expect(friendly).not.toContain("HTTP 401");
    expect(friendly).not.toBe(authInvalidTokenCopy);
  });

  it("does not claim HTTP 401 for message-only auth errors with no HTTP status prefix (#77394 review)", () => {
    const messageOnly = makeAssistantError('{"error":{"code":"invalid_api_key"}}');
    const friendly = formatAssistantErrorText(messageOnly);
    expect(friendly).toBeDefined();
    expect(friendly).not.toContain("HTTP 401");
    expect(friendly).not.toBe(authInvalidTokenCopy);
  });

  it("does not rewrite provider-less missing-scope 401 payloads as invalid-token errors", () => {
    const raw =
      '401 {"type":"error","error":{"type":"permission_error","message":"Missing scopes: api.responses.write"}}';
    const missingScope = makeAssistantMessageFixture({
      provider: undefined,
      errorMessage: raw,
      content: [{ type: "text", text: raw }],
    });
    const friendly = formatAssistantErrorText(missingScope);
    expect(friendly).not.toBe(authInvalidTokenCopy);
    expect(friendly).toContain("permission_error");
  });

  it("returns a proxy-specific message for proxy misroutes", () => {
    const msg = makeAssistantError("407 Proxy Authentication Required");
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request failed: proxy or tunnel configuration blocked the provider request.",
    );
  });

  it("keeps non-transport config errors that mention proxy settings actionable", () => {
    const msg = makeAssistantError(
      'Model-provider request.proxy/request.tls is not yet supported for api "ollama"',
    );
    expect(formatAssistantErrorText(msg)).toContain(
      'Model-provider request.proxy/request.tls is not yet supported for api "ollama"',
    );
    expect(formatAssistantErrorText(msg)).not.toBe(
      "LLM request failed: proxy or tunnel configuration blocked the provider request.",
    );
  });

  it("sanitizes invalid streaming event order errors", () => {
    const msg = makeAssistantError(
      'Unexpected event order, got message_start before receiving "message_stop"',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request failed: provider returned an invalid streaming response. Please try again.",
    );
  });

  it("sanitizes transport-classified malformed streaming fragments (#59076)", () => {
    const msg = makeAssistantError(MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE);
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM streaming response contained a malformed fragment. Please try again.",
    );
  });

  it("does not broadly rewrite non-streaming 'Unexpected token' JSON parse errors", () => {
    const msg = makeAssistantError("Unexpected token < in JSON at position 0");
    expect(formatAssistantErrorText(msg)).toBe("Unexpected token < in JSON at position 0");
  });

  it("does not rewrite non-streaming provider JSON request-validation diagnostics", () => {
    const msg = makeAssistantError("Expected value in JSON at position 12 for messages.0.content");
    expect(formatAssistantErrorText(msg)).toBe(
      "Expected value in JSON at position 12 for messages.0.content",
    );
  });

  it("keeps provider request-validation JSON diagnostics actionable", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error","message":"Expected value in JSON at position 12 for messages.0.content"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request rejected: Expected value in JSON at position 12 for messages.0.content",
    );
    expect(formatUserFacingAssistantErrorText(msg)).toBe(
      "LLM request failed: provider rejected the request schema or tool payload.",
    );
  });

  it("uses structured error body detail for model-not-found copy", () => {
    const msg = makeAssistantMessageFixture({
      errorMessage: "400 Param Incorrect",
      errorCode: "400",
      errorBody:
        '{"code":"400","message":"Param Incorrect","param":"Not supported model some-model-id"}',
      content: [],
    });

    expect(formatAssistantErrorText(msg)).toBe(
      "The selected model was not found by the provider. Check the model id or choose a different model.",
    );
    expect(formatUserFacingAssistantErrorText(msg)).toBe(
      "The selected model was not found by the provider. Check the model id or choose a different model.",
    );
  });
});

describe("formatRawAssistantErrorForUi", () => {
  it("renders HTTP code + type + message from Anthropic payloads", () => {
    const text = formatRawAssistantErrorForUi(
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited."},"request_id":"req_123"}',
    );

    expect(text).toContain("HTTP 429");
    expect(text).toContain("rate_limit_error");
    expect(text).toContain("Rate limited.");
    expect(text).not.toContain("req_123");
  });

  it("renders a generic unknown error message when raw is empty", () => {
    expect(formatRawAssistantErrorForUi("")).toContain("unknown error");
  });

  it("formats plain HTTP status lines", () => {
    expect(formatRawAssistantErrorForUi("500 Internal Server Error")).toBe(
      "HTTP 500: Internal Server Error",
    );
  });

  it("formats colon-delimited HTTP status lines", () => {
    expect(formatRawAssistantErrorForUi("HTTP 410: No body")).toBe("HTTP 410: No body");
  });

  it("formats plain provider internal errors without request ids", () => {
    expect(
      formatRawAssistantErrorForUi(
        "An error occurred while processing your request. Please include the request ID synthetic-provider-request-001 in your message.",
      ),
    ).toBe("The AI service returned an internal error. Please try again in a moment.");
  });

  it("sanitizes HTML error pages into a clean unavailable message", () => {
    const htmlError = `521 <!DOCTYPE html>
<html lang="en-US">
  <head><title>Web server is down | example.com | Cloudflare</title></head>
  <body>Ray ID: abc123</body>
</html>`;

    expect(formatRawAssistantErrorForUi(htmlError)).toBe(
      "The AI service is temporarily unavailable (HTTP 521). Please try again in a moment.",
    );
  });

  it("formats standalone Cloudflare challenge HTML into a clean provider error", () => {
    const htmlError = `<!DOCTYPE html>
<html lang="en-US">
  <head><title>Just a moment...</title></head>
  <body>
    <span id="challenge-error-text">Enable JavaScript and cookies to continue</span>
    <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
  </body>
</html>`;

    expect(formatRawAssistantErrorForUi(htmlError)).toBe(
      "The provider returned an HTML error page instead of an API response. This usually means a CDN or gateway (e.g. Cloudflare) blocked the request. Retry in a moment or check provider status.",
    );
  });
});

describe("raw API error payload helpers", () => {
  it("recognizes provider-prefixed JSON payloads for observation fingerprints", () => {
    const raw =
      'Ollama API error: {"type":"error","error":{"type":"server_error","message":"Boom"},"request_id":"req_123"}';

    expect(isRawApiErrorPayload(raw)).toBe(true);
    expect(getApiErrorPayloadFingerprint(raw)).toBe(
      '{"error":{"message":"Boom","type":"server_error"},"request_id":"req_123","type":"error"}',
    );
  });

  it("recognizes flat JSON payloads with string error code and message (#74079)", () => {
    const raw =
      '{"error":"insufficient_balance","message":"Insufficient MBT balance. Top up or upgrade your subscription to continue.","upgradeUrl":"/settings/billing"}';
    expect(isRawApiErrorPayload(raw)).toBe(true);
    expect(formatRawAssistantErrorForUi(raw)).toBe(
      "LLM error insufficient_balance: Insufficient MBT balance. Top up or upgrade your subscription to continue.",
    );
  });
});

describe("formatBillingErrorMessage — Boon-unified copy", () => {
  const BILLING_URL = "https://app.getboon.ai/billing?open=agent";
  // Boon fork: a Boon user always runs against their org's Boon token allocation
  // via the gateway — there is no provider API key to "switch" and no provider
  // billing dashboard. So EVERY authMode/provider combination returns the same
  // plain Boon top-up copy — never "API key" / provider-dashboard wording.
  const cases: Array<[string, () => string]> = [
    ["oauth", () => formatBillingErrorMessage("Anthropic", "claude-sonnet-4-5", "oauth")],
    ["token", () => formatBillingErrorMessage("Anthropic", "claude-sonnet-4-5", "token")],
    ["api_key", () => formatBillingErrorMessage("Anthropic", "claude-sonnet-4-5", "api_key")],
    ["undefined authMode", () => formatBillingErrorMessage("Anthropic", "claude-sonnet-4-5")],
    ["no provider", () => formatBillingErrorMessage()],
  ];
  for (const [name, build] of cases) {
    it(`returns Boon top-up copy for ${name} — never provider-API-key text`, () => {
      const result = build();
      expect(result).toContain("out of Boon Agent tokens");
      expect(result).toContain(`[Top up your tokens](${BILLING_URL})`);
      expect(result).not.toMatch(/api key/i);
      expect(result).not.toMatch(/billing dashboard/i);
      expect(result).not.toContain("Anthropic");
    });
  }
});

describe("boon-llm-gateway allocation_exhausted", () => {
  // The boon-llm-gateway returns this 429 body when an org's token allocation
  // is spent. Previously it fell through the classifier to the bare
  // "LLM request failed." — the string in the customer (Arguijo) screenshot.
  const GATEWAY_ALLOCATION_EXHAUSTED_BODY =
    '{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to increase your limit."}';

  const makeAllocationError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });

  it("returns dedicated allocation copy, not the generic API-key billing wording", () => {
    const msg = makeAllocationError(GATEWAY_ALLOCATION_EXHAUSTED_BODY);
    const out = formatAssistantErrorText(msg, { provider: "boon-llm-gateway" });
    // Never the raw JSON or the generic fallback.
    expect(out).toBeDefined();
    expect(out).not.toContain("allocation_exhausted");
    expect(out).not.toBe("LLM request failed.");
    // A boon-llm-gateway customer has ONE BOON_API_KEY and an org-level
    // allocation — there is no other API key to "switch" to, so the generic
    // billing copy is misleading here. Copy mirrors the web TokensExhaustedBanner.
    expect(out).toMatch(/out of Boon Agent tokens/i);
    expect(out).not.toMatch(/switch to a different api key/i);
  });

  it("user-facing text never leaks the raw allocation_exhausted JSON", () => {
    const msg = makeAllocationError(GATEWAY_ALLOCATION_EXHAUSTED_BODY);
    const out = formatUserFacingAssistantErrorText(msg, { provider: "boon-llm-gateway" });
    expect(out).not.toContain("allocation_exhausted");
    expect(out).not.toContain("{");
    expect(out).not.toBe("LLM request failed.");
    expect(out).toMatch(/out of Boon Agent tokens/i);
  });

  // Trial sibling of allocation_exhausted: the gateway returns this 402 body when
  // a trial account's one-shot budget is spent. Trials upgrade (no top-up).
  const GATEWAY_TRIAL_EXHAUSTED_BODY =
    '{"error":"trial_budget_exhausted","message":"Trial token budget exhausted; upgrade to continue.","granted":500000,"used":500000}';

  it("recognizes trial_budget_exhausted and returns trial-upgrade copy", () => {
    expect(isTrialBudgetExhaustedErrorMessage(GATEWAY_TRIAL_EXHAUSTED_BODY)).toBe(true);
    const msg = makeAllocationError(GATEWAY_TRIAL_EXHAUSTED_BODY);
    const out = formatAssistantErrorText(msg, { provider: "boon-llm-gateway" });
    expect(out).toBeDefined();
    expect(out).not.toContain("trial_budget_exhausted");
    expect(out).toMatch(/used up your free trial/i);
    expect(out).toMatch(/upgrade/i);
  });
});

describe("consumer audience (ENG-16617)", () => {
  const makeError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });
  const consumerCfg = {
    agents: { defaults: { messaging: { audience: "consumer" } } },
  } as unknown as import("../config/types.openclaw.js").OpenClawConfig;
  const consumer = (msg: AssistantMessage, provider?: string) =>
    formatAssistantErrorText(msg, { cfg: consumerCfg, provider });

  it.each([
    {
      name: "schema/tool rejection",
      raw: '{"type":"error","error":{"message":"SECRET\\nCANARY","type":"invalid_request_error"}}',
      expected: "Something went wrong while I was talking to the AI service",
    },
    {
      name: "timeout",
      raw: "LLM request timed out",
      expected: "The AI service took too long to respond",
    },
    {
      name: "rate limit",
      raw: "429 Too Many Requests",
      expected: "The AI service is busy right now",
    },
    {
      name: "context overflow",
      raw: "request_too_large",
      expected: "This conversation has grown too long",
    },
    {
      name: "auth 401",
      raw: "401 Unauthorized: invalid api key",
      expected: "I hit a sign-in problem reaching the AI service",
    },
    {
      name: "billing credit balance",
      raw: "Your credit balance is too low to access the Anthropic API.",
      expected: "the AI account has hit its usage limit",
    },
  ])("returns plain-language copy for $name", ({ raw, expected }) => {
    const out = consumer(makeError(raw));
    expect(out).toContain(expected);
    // Consumer copy must never leak raw provider/schema/slug detail.
    expect(out).not.toContain("provider rejected");
    expect(out).not.toContain("{");
  });

  it("never exposes raw structured provider payload content to consumers", () => {
    const out = consumer(
      makeError(
        '{"type":"error","error":{"message":"SECRET\\nCANARY","type":"invalid_request_error"}}',
      ),
    );
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("CANARY");
  });

  it("falls back to generic copy for unclassified errors", () => {
    expect(consumer(makeError("some totally unrecognized failure text"))).toBe(
      "Something went wrong while I was working on that. Please try again in a moment.",
    );
  });

  it("keeps token-exhaustion copy identical under both audiences (allocation)", () => {
    const raw =
      '{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to increase your limit."}';
    const operatorOut = formatAssistantErrorText(makeError(raw), { provider: "boon-llm-gateway" });
    const consumerOut = consumer(makeError(raw), "boon-llm-gateway");
    expect(consumerOut).toBe(operatorOut);
    expect(consumerOut).toMatch(/out of Boon Agent tokens/i);
  });

  it("keeps token-exhaustion copy identical under both audiences (trial)", () => {
    const raw =
      '{"error":"trial_budget_exhausted","message":"Trial token budget exhausted; upgrade to continue.","granted":500000,"used":500000}';
    const operatorOut = formatAssistantErrorText(makeError(raw), { provider: "boon-llm-gateway" });
    const consumerOut = consumer(makeError(raw), "boon-llm-gateway");
    expect(consumerOut).toBe(operatorOut);
    expect(consumerOut).toMatch(/used up your free trial/i);
  });
});

describe("buildTokenExhaustedPresentation", () => {
  const BILLING_URL = "https://app.getboon.ai/billing?open=agent";
  // Bodies carry only the code (no top_up_url) — the button uses the static URL.
  const PAID_BODY = '{"error":"allocation_exhausted"}';
  const TRIAL_BODY = '{"error":"trial_budget_exhausted","granted":500000,"used":500000}';

  it("returns undefined when neither the message nor the body is an exhaustion signal", () => {
    expect(
      buildTokenExhaustedPresentation("429 rate limited", '{"error":"rate_limit"}'),
    ).toBeUndefined();
  });

  it("builds a paid card with a 'Top up tokens' button using the static billing URL", () => {
    const p = buildTokenExhaustedPresentation("allocation_exhausted", PAID_BODY);
    expect(p?.tone).toBe("warning");
    // Button-only (payload.text carries the copy + inline link); static URL.
    expect(p?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [{ label: "Top up tokens", url: BILLING_URL, style: "primary" }],
      },
    ]);
  });

  it("builds a trial card with an 'Upgrade plan' button", () => {
    const p = buildTokenExhaustedPresentation("trial_budget_exhausted", TRIAL_BODY);
    const buttons = p?.blocks.find((b) => b.type === "buttons");
    expect(buttons).toEqual({
      type: "buttons",
      buttons: [{ label: "Upgrade plan", url: BILLING_URL, style: "primary" }],
    });
  });

  it("recognizes TRIAL exhaustion from the errorBody code when the message text does not match", () => {
    // Production shape: the prettified message ("Trial token budget exhausted…")
    // does NOT match the trial pattern; the code is only in errorBody. The card
    // must still render — this is the regression this fix guards.
    const p = buildTokenExhaustedPresentation(
      "boon-llm-gateway (402): Trial token budget exhausted; upgrade to continue.",
      TRIAL_BODY,
    );
    expect(p?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [{ label: "Upgrade plan", url: BILLING_URL, style: "primary" }],
      },
    ]);
  });
});

describe("sanitizeUserFacingText — streaming JSON parse error (#59076)", () => {
  it("rewrites transport-classified malformed streaming fragments in error context", () => {
    const result = sanitizeUserFacingText(MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE, {
      errorContext: true,
    });
    expect(result).toBe("LLM streaming response contained a malformed fragment. Please try again.");
  });

  it("does not rewrite JSON parse error when not in error context", () => {
    // When not in error context, the text could be legitimate assistant content
    // mentioning JSON errors. Don't rewrite.
    const text =
      "Expected ',' or '}' after property value in JSON at position 334 (line 1 column 335)";
    const result = sanitizeUserFacingText(text, { errorContext: false });
    expect(result).toBe(text);
  });
});
