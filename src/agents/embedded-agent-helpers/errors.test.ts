// Covers assistant error formatting for streaming, sandbox, and context errors.
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { MALFORMED_STREAMING_FRAGMENT_ERROR_MESSAGE } from "../../shared/assistant-error-format.js";
import { makeAssistantMessageFixture } from "../test-helpers/assistant-message-fixtures.js";
import {
  formatAssistantErrorText,
  formatUserFacingAssistantErrorText,
  isLikelyContextOverflowError,
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
  // Real wire shape: the gateway sends HTTP 429 + {"error":"allocation_exhausted",
  // "message":"..."}, but the OpenAI SDK collapses that to `429 "allocation_exhausted"`
  // (status-prefixed, message dropped). Verified end-to-end against the installed
  // SDK and boon-llm-gateway middleware/quota.go.
  const SDK_SHAPE = '429 "allocation_exhausted"';
  const HTTP_SHAPE = 'HTTP 429: {"error":"allocation_exhausted","message":"x"}';
  const BARE_JSON =
    '{"error":"allocation_exhausted","message":"Token allocation exhausted. Contact sales to upgrade your plan."}';
  const EXPECTED =
    "LLM error allocation_exhausted: Token allocation exhausted. Contact sales to upgrade your plan.";
  const makeGatewayError = (errorMessage: string): AssistantMessage =>
    makeAssistantMessageFixture({
      provider: "boon-llm-gateway",
      model: "claude-opus-4-8",
      errorMessage,
      content: [],
    });
  const opts = { provider: "boon-llm-gateway", model: "claude-opus-4-8" };

  it("renders the exhaustion copy for the real SDK-collapsed shape", () => {
    // Core guard: this shape otherwise classifies as rate_limit → "API rate limit
    // reached", never surfacing the exhaustion reason to the user.
    expect(formatAssistantErrorText(makeGatewayError(SDK_SHAPE), opts)).toBe(EXPECTED);
  });

  it("renders the exhaustion copy end-to-end (through the passthrough net)", () => {
    const text = formatUserFacingAssistantErrorText(makeGatewayError(SDK_SHAPE), opts);
    expect(text).toBe(EXPECTED);
    expect(text).not.toBe("LLM request failed.");
    expect(text).not.toContain("rate limit");
  });

  it("also handles the HTTP-prefixed and bare-JSON shapes", () => {
    // Robustness across however the code is surfaced; the match is on the code, not the shape.
    expect(formatAssistantErrorText(makeGatewayError(HTTP_SHAPE), opts)).toBe(EXPECTED);
    expect(formatAssistantErrorText(makeGatewayError(BARE_JSON), opts)).toBe(EXPECTED);
  });

  it("does not match unrelated exhausted codes", () => {
    // Guard against over-matching: resource_exhausted / connection pool exhausted
    // must not hit the gateway branch.
    expect(formatAssistantErrorText(makeGatewayError('429 "resource_exhausted"'), opts)).not.toBe(
      EXPECTED,
    );
    expect(formatAssistantErrorText(makeGatewayError("connection pool exhausted"), opts)).not.toBe(
      EXPECTED,
    );
  });
});
