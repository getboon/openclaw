// Covers assistant error formatting for streaming, sandbox, and context errors.
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE } from "../../shared/assistant-error-format.js";
import { makeAssistantMessageFixture } from "../test-helpers/assistant-message-fixtures.js";
import {
  classifyFailoverReason,
  formatAssistantErrorText,
  formatUserFacingAssistantErrorText,
  isBillingErrorMessage,
  isLikelyContextOverflowError,
  isRawAssistantErrorPassthrough,
} from "./errors.js";

const { toolPolicyAuditInfo } = vi.hoisted(() => ({
  toolPolicyAuditInfo: vi.fn(),
}));

vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: toolPolicyAuditInfo,
    warn: vi.fn(),
  }),
}));

describe("formatAssistantErrorText streaming JSON parse classification", () => {
  beforeEach(() => {
    toolPolicyAuditInfo.mockClear();
  });

  const makeAssistantError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      errorMessage,
      content: [{ type: "text", text: errorMessage }],
    });

  it("suppresses transport-classified malformed streaming fragments", () => {
    // Transport JSON fragmentation is not user-authored content and should get
    // stable retry copy instead of raw parser text.
    const msg = makeAssistantError(MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE);
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM streaming response contained a malformed fragment. Please try again.",
    );
  });

  it("does not suppress unclassified JSON.parse text", () => {
    const msg = makeAssistantError(
      "Expected ',' or '}' after property value in JSON at position 334 (line 1 column 335)",
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "Expected ',' or '}' after property value in JSON at position 334 (line 1 column 335)",
    );
  });

  it("keeps non-streaming provider request-validation syntax diagnostics", () => {
    const msg = makeAssistantError(
      '{"type":"error","error":{"type":"invalid_request_error","message":"Expected value in JSON at position 12 for messages.0.content"}}',
    );
    expect(formatAssistantErrorText(msg)).toBe(
      "LLM request rejected: Expected value in JSON at position 12 for messages.0.content",
    );
  });

  it("audits a sandbox tool-policy block once per assistant error", () => {
    // Formatting may be called multiple times for the same error; audit logs
    // should stay deduplicated per blocked assistant error.
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          sandbox: { mode: "non-main", scope: "agent" },
        },
      },
      tools: {
        sandbox: {
          tools: {
            deny: ["browser"],
          },
        },
      },
    };
    const msg = makeAssistantError("unknown tool: browser");

    expect(
      formatAssistantErrorText(msg, { cfg, sessionKey: "agent:main:mobilechat:g1" }),
    ).toContain('Tool "browser" blocked by sandbox tool policy');
    expect(
      formatAssistantErrorText(msg, { cfg, sessionKey: "agent:main:mobilechat:g1" }),
    ).toContain('Tool "browser" blocked by sandbox tool policy');

    expect(toolPolicyAuditInfo).toHaveBeenCalledTimes(1);
    expect(toolPolicyAuditInfo).toHaveBeenCalledWith(
      "sandbox tool policy blocked browser via tools.sandbox.tools.deny; matched browser",
      {
        tool: "browser",
        ruleKind: "deny",
        ruleSource: "global",
        configKey: "tools.sandbox.tools.deny",
        matchedRule: "browser",
        sandboxMode: "non-main",
      },
    );
  });
});

describe("isLikelyContextOverflowError", () => {
  it("detects Codex promptError wording for a full context window", () => {
    expect(
      isLikelyContextOverflowError(
        "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      ),
    ).toBe(true);
  });
});

describe("boon-llm-gateway token allocation exhausted", () => {
  const GATEWAY_BODY =
    '{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to upgrade your plan."}';
  const EXPECTED =
    "LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.";
  const makeGatewayError = (): AssistantMessage =>
    makeAssistantMessageFixture({
      provider: "boon-llm-gateway",
      model: "claude-opus-4-8",
      errorMessage: GATEWAY_BODY,
      content: [],
    });
  const opts = { provider: "boon-llm-gateway", model: "claude-opus-4-8" };

  it("formatAssistantErrorText renders the raw legacy string (reaches the raw path)", () => {
    // Guards that this error is NOT billing-classified; if it were, billing copy
    // would return before the raw path and the passthrough exception never runs.
    expect(formatAssistantErrorText(makeGatewayError(), opts)).toBe(EXPECTED);
  });

  it("isRawAssistantErrorPassthrough does not suppress the allocation_exhausted string", () => {
    expect(
      isRawAssistantErrorPassthrough({ friendlyError: EXPECTED, rawError: GATEWAY_BODY }),
    ).toBe(false);
  });

  it("formatUserFacingAssistantErrorText surfaces the legacy string instead of the generic fallback", () => {
    // Core regression guard: without the exception this returns "LLM request failed.".
    const text = formatUserFacingAssistantErrorText(makeGatewayError(), opts);
    expect(text).toBe(EXPECTED);
    expect(text).not.toBe("LLM request failed.");
  });

  it("stays unclassified for failover (legacy behavior: no billing lane)", () => {
    expect(classifyFailoverReason(GATEWAY_BODY)).toBe(null);
    expect(isBillingErrorMessage(GATEWAY_BODY)).toBe(false);
  });

  it("does not suppress-exempt an unrelated exhausted code", () => {
    // The exception is keyed strictly to allocation_exhausted; a different code
    // must still be governed by the normal passthrough rules.
    const otherBody = '{"error":"resource_exhausted","message":"retries exhausted"}';
    const otherFriendly = "LLM error resource_exhausted: retries exhausted";
    expect(
      isRawAssistantErrorPassthrough({ friendlyError: otherFriendly, rawError: otherBody }),
    ).toBe(true);
  });
});
