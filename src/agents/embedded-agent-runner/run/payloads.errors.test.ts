// Error payload tests ensure embedded runs convert provider/tool failures into
// concise user-facing replies without leaking raw provider bodies or secrets.
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { getReplyPayloadMetadata } from "../../../auto-reply/reply-payload.js";
import { formatBillingErrorMessage } from "../../embedded-agent-helpers.js";
import { makeAssistantMessageFixture } from "../../test-helpers/assistant-message-fixtures.js";
import {
  buildPayloads,
  expectSinglePayloadText,
  expectSingleToolErrorPayload,
} from "./payloads.test-helpers.js";

describe("buildEmbeddedRunPayloads", () => {
  const OVERLOADED_FALLBACK_TEXT =
    "The AI service is temporarily overloaded. Please try again in a moment.";
  const errorJson =
    '{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CX7DwS7tSvggaNHmefwWg"}';
  const errorJsonPretty = `{
  "type": "error",
  "error": {
    "details": null,
    "type": "overloaded_error",
    "message": "Overloaded"
  },
  "request_id": "req_011CX7DwS7tSvggaNHmefwWg"
}`;
  const makeAssistant = (overrides: Partial<AssistantMessage>): AssistantMessage =>
    // Default to an overloaded provider error so each test can override only
    // the assistant fields relevant to user-visible payload sanitization.
    makeAssistantMessageFixture({
      errorMessage: errorJson,
      content: [{ type: "text", text: errorJson }],
      ...overrides,
    });
  const makeStoppedAssistant = () =>
    makeAssistant({
      stopReason: "stop",
      errorMessage: undefined,
      content: [],
    });

  const expectOverloadedFallback = (payloads: ReturnType<typeof buildPayloads>) => {
    // Overloaded JSON is normalized into stable copy rather than replayed as a
    // raw provider object.
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.text).toBe(OVERLOADED_FALLBACK_TEXT);
  };

  const expectNoPayloadTextContaining = (
    payloads: ReturnType<typeof buildPayloads>,
    needle: string,
  ) => {
    expect(payloads.map((payload) => payload.text ?? "").join("\n")).not.toContain(needle);
  };

  function expectSinglePayloadSummary(
    payloads: ReturnType<typeof buildPayloads>,
    expected: { text: string; isError?: boolean },
  ) {
    expectSinglePayloadText(payloads, expected.text);
    if (expected.isError === undefined) {
      expect(payloads[0]?.isError).toBeUndefined();
      return;
    }
    expect(payloads[0]?.isError).toBe(expected.isError);
  }

  function expectNoPayloads(params: Parameters<typeof buildPayloads>[0]) {
    const payloads = buildPayloads(params);
    expect(payloads).toHaveLength(0);
  }

  function expectNoSyntheticCompletionForSession(sessionKey: string) {
    expectNoPayloads({
      sessionKey,
      toolMetas: [{ toolName: "write", meta: "/tmp/out.md" }],
      lastAssistant: makeAssistant({
        stopReason: "stop",
        errorMessage: undefined,
        content: [],
      }),
    });
  }

  it("suppresses raw API error JSON when the assistant errored", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJson],
      lastAssistant: makeAssistant({}),
    });

    expectOverloadedFallback(payloads);
    expect(payloads[0]?.isError).toBe(true);
    expect(payloads.map((payload) => payload.text)).not.toContain(errorJson);
  });

  it("marks the assistant-error payload for delivery despite message_tool_only suppression", () => {
    // A provider/run-level error is exactly the kind of failure signal that
    // must not vanish just because normal assistant prose is suppressed on
    // this channel.
    const payloads = buildPayloads({
      assistantTexts: [errorJson],
      lastAssistant: makeAssistant({}),
      sourceReplyDeliveryMode: "message_tool_only",
    });

    expectOverloadedFallback(payloads);
    expect(
      getReplyPayloadMetadata(payloads[0] as object)?.deliverDespiteSourceReplySuppression,
    ).toBe(true);
  });

  // Token-exhaustion replies carry plain-language copy with an inline billing
  // link AND a rich-card button (static Boon billing URL). The gateway 402 code
  // (allocation_exhausted / trial_budget_exhausted) lands in errorBody; the
  // prettified errorMessage carries only the human message (no code), so
  // recognition must key on the body — reproducing the live-tested trial gap.
  const BILLING_URL = "https://app.getboon.ai/billing?open=agent";

  it("PAID exhaustion: inline top-up link in text + button (recognized from errorBody code)", () => {
    const errorBody =
      '{"error":"allocation_exhausted","message":"Token allocation exhausted. Top up to continue."}';
    const payloads = buildPayloads({
      assistantTexts: ["boon-llm-gateway (402): Token allocation exhausted. Top up to continue."],
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: "boon-llm-gateway (402): Token allocation exhausted. Top up to continue.",
        errorBody,
      }),
    });

    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain(`[Top up your tokens](${BILLING_URL})`);
    expect(payloads[0]?.text).not.toMatch(/switch to a different api key/i);
    expect(payloads[0]?.presentation?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [{ label: "Top up tokens", url: BILLING_URL, style: "primary" }],
      },
    ]);
  });

  it("TRIAL exhaustion: inline upgrade link in text + button (message text alone would NOT match)", () => {
    // "Trial token budget exhausted; upgrade to continue." does NOT match
    // /trial[_ ]budget[_ ]exhausted/ (the word "token" is between "Trial" and
    // "budget"), so recognition MUST come from the errorBody code.
    const errorBody =
      '{"error":"trial_budget_exhausted","message":"Trial token budget exhausted; upgrade to continue.","granted":500000,"used":500000}';
    const payloads = buildPayloads({
      assistantTexts: [
        "boon-llm-gateway (402): Trial token budget exhausted; upgrade to continue.",
      ],
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: "boon-llm-gateway (402): Trial token budget exhausted; upgrade to continue.",
        errorBody,
      }),
    });

    expect(payloads[0]?.text).toContain(`[Upgrade your plan](${BILLING_URL})`);
    expect(payloads[0]?.presentation?.blocks).toEqual([
      { type: "buttons", buttons: [{ label: "Upgrade plan", url: BILLING_URL, style: "primary" }] },
    ]);
  });

  it("suppresses mutating tool warnings when an assistant error reply already covers the turn", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJson],
      lastAssistant: makeAssistant({}),
      lastToolError: { toolName: "edit", error: "file missing" },
      sessionKey: "agent:main:telegram:direct:u123",
    });

    expectOverloadedFallback(payloads);
    expect(payloads[0]?.isError).toBe(true);
    expectNoPayloadTextContaining(payloads, "Edit");
    expectNoPayloadTextContaining(payloads, "missing");
  });

  it("suppresses the sessions_spawn failure badge when an assistant error reply already covers the turn", () => {
    // ENG-16868: a genuine spawn failure on a turn the assistant already
    // reported as an error must not stack a second "⚠️ Sub-agent failed" line —
    // matches the mutating branch this replaced (hasUserFacingErrorReply guard).
    const payloads = buildPayloads({
      assistantTexts: [errorJson],
      lastAssistant: makeAssistant({}),
      lastToolError: { toolName: "sessions_spawn", error: "sub-agent step errored" },
      sessionKey: "agent:main:telegram:direct:u123",
    });

    expectOverloadedFallback(payloads);
    expect(payloads[0]?.isError).toBe(true);
    expectNoPayloadTextContaining(payloads, "Sub-agent");
    expectNoPayloadTextContaining(payloads, "failed");
  });

  it("keeps mutating tool warnings when assistant error artifacts are not user-facing", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJson],
      lastAssistant: makeAssistant({}),
      lastToolError: { toolName: "edit", error: "file missing" },
      didSendDeterministicApprovalPrompt: true,
      sessionKey: "agent:main:telegram:direct:u123",
    });

    expectSingleToolErrorPayload(payloads, {
      title: "Edit",
      absentDetail: "missing",
    });
  });

  it("suppresses pretty-printed error JSON that differs from the errorMessage", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJsonPretty],
      lastAssistant: makeAssistant({ errorMessage: errorJson }),
      inlineToolResultsAllowed: true,
      verboseLevel: "on",
    });

    expectOverloadedFallback(payloads);
    expect(payloads.map((payload) => payload.text)).not.toContain(errorJsonPretty);
  });

  it("suppresses raw error JSON from fallback assistant text", () => {
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({ content: [{ type: "text", text: errorJsonPretty }] }),
    });

    expectOverloadedFallback(payloads);
    expectNoPayloadTextContaining(payloads, "request_id");
  });

  it("does not expose provider request ids from generic internal errors", () => {
    const rawError =
      "An error occurred while processing your request. Please include request ID req_synthetic_provider_request_001 in your message.";
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        errorMessage: rawError,
        content: [{ type: "text", text: rawError }],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "The AI service returned an internal error. Please try again in a moment.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "request ID");
    expectNoPayloadTextContaining(payloads, "req_synthetic_provider_request_001");
  });

  it("suppresses raw assistant error messages in user-facing reply payloads", () => {
    // Canary text proves raw provider error strings do not escape into channel
    // replies when the assistant stopped in an error state.
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: "SECRET_CANARY_69737",
        content: [],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request failed.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "SECRET_CANARY_69737");
  });

  it("suppresses structured provider error messages in user-facing reply payloads", () => {
    const rawError =
      '{"type":"error","error":{"type":"invalid_request_error","message":"SECRET_CANARY_69737"}}';
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: rawError,
        content: [{ type: "text", text: rawError }],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request failed: provider rejected the request schema or tool payload.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "SECRET_CANARY_69737");
    expectNoPayloadTextContaining(payloads, "LLM request rejected");
  });

  it("uses structured provider details for model-not-found reply payloads", () => {
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: "400 Param Incorrect",
        errorCode: "400",
        errorBody:
          '{"code":"400","message":"Param Incorrect","param":"Not supported model some-model-id"}',
        content: [],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "The selected model was not found by the provider. Check the model id or choose a different model.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "some-model-id");
    expectNoPayloadTextContaining(payloads, "Param Incorrect");
  });

  it("suppresses escaped structured provider error messages in user-facing reply payloads", () => {
    const rawError =
      '{"type":"error","error":{"type":"invalid_request_error","message":"SECRET\\nCANARY_69737"}}';
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: rawError,
        content: [{ type: "text", text: rawError }],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request failed: provider rejected the request schema or tool payload.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "SECRET");
    expectNoPayloadTextContaining(payloads, "CANARY_69737");
    expectNoPayloadTextContaining(payloads, "LLM request rejected");
  });

  it("renders plain-language error copy under the consumer audience (ENG-16617)", () => {
    const rawError =
      '{"type":"error","error":{"type":"invalid_request_error","message":"SECRET\\nCANARY_69737"}}';
    const payloads = buildPayloads({
      config: {
        agents: { defaults: { messaging: { audience: "consumer" } } },
      } as unknown as import("../../../config/types.openclaw.js").OpenClawConfig,
      lastAssistant: makeAssistant({
        stopReason: "error",
        errorMessage: rawError,
        content: [{ type: "text", text: rawError }],
      }),
    });

    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain(
      "Something went wrong while I was talking to the AI service",
    );
    expectNoPayloadTextContaining(payloads, "provider rejected");
    expectNoPayloadTextContaining(payloads, "SECRET");
    expectNoPayloadTextContaining(payloads, "CANARY_69737");
  });

  it("still attaches the top-up card under the consumer audience", () => {
    const body =
      '{"error":"allocation_exhausted","message":"Token allocation exhausted. Top up to continue.","top_up_url":"https://app.getboon.ai/billing?open=agent"}';
    const payloads = buildPayloads({
      config: {
        agents: { defaults: { messaging: { audience: "consumer" } } },
      } as unknown as import("../../../config/types.openclaw.js").OpenClawConfig,
      assistantTexts: [body],
      lastAssistant: makeAssistant({ stopReason: "error", errorMessage: body, errorBody: body }),
    });

    // Token-exhaustion copy + button stay identical for consumers (not routed
    // into the generic consumer map).
    expect(payloads[0]?.text).toMatch(/out of Boon Agent tokens/i);
    expect(payloads[0]?.presentation?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [
          {
            label: "Top up tokens",
            url: "https://app.getboon.ai/billing?open=agent",
            style: "primary",
          },
        ],
      },
    ]);
  });

  it("surfaces OpenAI model capacity errors instead of generic empty-response copy", () => {
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        errorMessage: "Selected model is at capacity. Please try a different model.",
        content: [],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "⚠️ Selected model is at capacity. Try a different model, or wait and retry.",
      isError: true,
    });
  });

  it("suppresses aborted assistant partial text and surfaces a clean timeout error", () => {
    const payloads = buildPayloads({
      runAborted: true,
      assistantTexts: [
        "Need answer concise mention not fully E2E tested tomorrow.\n[[reply_to_current]] Final draft",
      ],
      lastAssistant: makeAssistant({
        stopReason: "aborted",
        errorMessage: "request timed out",
        content: [
          {
            type: "text",
            text: "Need answer concise mention not fully E2E tested tomorrow.\n[[reply_to_current]] Final draft",
          },
        ],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request timed out.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "Need answer concise");
    expectNoPayloadTextContaining(payloads, "[[reply_to_current]]");
  });

  it("suppresses raw aborted assistant error messages in user-facing reply payloads", () => {
    const payloads = buildPayloads({
      runAborted: true,
      assistantTexts: [],
      lastAssistant: makeAssistant({
        stopReason: "aborted",
        errorMessage: "SECRET_CANARY_69737",
        content: [],
      }),
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request failed.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "SECRET_CANARY_69737");
  });

  it("suppresses aborted assistant reasoning text as well as partial answer text", () => {
    const payloads = buildPayloads({
      runAborted: true,
      assistantTexts: ["partial answer that should not leak"],
      lastAssistant: makeAssistant({
        stopReason: "aborted",
        errorMessage: "request timed out",
        content: [
          { type: "thinking", thinking: "partial hidden reasoning" },
          { type: "text", text: "partial answer that should not leak" },
        ],
      }),
      reasoningLevel: "on",
    });

    expectSinglePayloadSummary(payloads, {
      text: "LLM request timed out.",
      isError: true,
    });
    expectNoPayloadTextContaining(payloads, "partial hidden reasoning");
    expectNoPayloadTextContaining(payloads, "partial answer that should not leak");
  });

  it("preserves aborted-without-error behavior without adding a generic error payload", () => {
    const payloads = buildPayloads({
      runAborted: true,
      assistantTexts: [],
      lastAssistant: makeAssistant({
        stopReason: "aborted",
        errorMessage: undefined,
        content: [],
      }),
    });

    expect(payloads).toHaveLength(0);
  });

  it("does not replay a stale previous assistant when an aborted run has no new text", () => {
    const payloads = buildPayloads({
      runAborted: true,
      assistantTexts: [],
      lastAssistant: makeAssistant({
        stopReason: "stop",
        errorMessage: undefined,
        content: [{ type: "text", text: "Previous completed assistant reply" }],
      }),
    });

    expect(payloads).toHaveLength(0);
  });

  it("includes provider and model context for billing errors", () => {
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        model: "claude-3-5-sonnet",
        errorMessage: "insufficient credits",
        content: [{ type: "text", text: "insufficient credits" }],
      }),
      provider: "Anthropic",
      model: "claude-3-5-sonnet",
    });

    expectSinglePayloadSummary(payloads, {
      text: formatBillingErrorMessage("Anthropic", "claude-3-5-sonnet"),
      isError: true,
    });
  });

  it("does not emit a synthetic billing error for successful turns with stale errorMessage", () => {
    // Some providers leave stale errorMessage fields on otherwise successful
    // assistant messages; stopReason/content decide user-facing output.
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "stop",
        errorMessage: "insufficient credits for embedding model",
        content: [{ type: "text", text: "Handle payment required errors in your API." }],
      }),
    });

    expectSinglePayloadText(payloads, "Handle payment required errors in your API.");
  });

  it("suppresses raw error JSON even when errorMessage is missing", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJsonPretty],
      lastAssistant: makeAssistant({ errorMessage: undefined }),
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.isError).toBe(true);
    expectNoPayloadTextContaining(payloads, "request_id");
  });

  it("does not suppress error-shaped JSON when the assistant did not error", () => {
    const payloads = buildPayloads({
      assistantTexts: [errorJsonPretty],
      lastAssistant: makeStoppedAssistant(),
    });

    expectSinglePayloadText(payloads, errorJsonPretty.trim());
  });

  it("adds a fallback error when a tool fails and no assistant output exists", () => {
    const payloads = buildPayloads({
      lastToolError: { toolName: "browser", error: "tab not found" },
    });

    expectSingleToolErrorPayload(payloads, {
      title: "Browser",
      absentDetail: "tab not found",
    });
  });

  it("does not add tool error fallback when assistant output exists", () => {
    const payloads = buildPayloads({
      assistantTexts: ["All good"],
      lastAssistant: makeStoppedAssistant(),
      lastToolError: { toolName: "browser", error: "tab not found" },
    });

    expectSinglePayloadText(payloads, "All good");
  });

  it("does not add synthetic completion text when tools run without final assistant text", () => {
    expectNoPayloads({
      sessionKey: "agent:main:discord:direct:u123",
      toolMetas: [{ toolName: "write", meta: "/tmp/out.md" }],
      lastAssistant: makeStoppedAssistant(),
    });
  });

  it("does not add synthetic completion text for channel sessions", () => {
    expectNoSyntheticCompletionForSession("agent:main:discord:channel:c123");
  });

  it("does not add synthetic completion text for group sessions", () => {
    expectNoSyntheticCompletionForSession("agent:main:telegram:group:g123");
  });

  it("does not add synthetic completion text when messaging tool already delivered output", () => {
    expectNoPayloads({
      sessionKey: "agent:main:discord:direct:u123",
      toolMetas: [{ toolName: "message_send", meta: "sent to #ops" }],
      didSendViaMessagingTool: true,
      lastAssistant: makeAssistant({
        stopReason: "stop",
        errorMessage: undefined,
        content: [],
      }),
    });
  });

  it("does not add synthetic completion text when the run still has a tool error", () => {
    expectNoPayloads({
      toolMetas: [{ toolName: "browser", meta: "open https://example.com" }],
      lastToolError: { toolName: "browser", error: "url required" },
    });
  });

  it("does not add synthetic completion text when no tools ran", () => {
    expectNoPayloads({
      lastAssistant: makeStoppedAssistant(),
    });
  });

  it("adds compact tool error fallback when the assistant only invoked tools and verbose mode is on", () => {
    const payloads = buildPayloads({
      lastAssistant: makeAssistant({
        stopReason: "toolUse",
        errorMessage: undefined,
        content: [
          {
            type: "toolCall",
            id: "toolu_01",
            name: "exec",
            arguments: { command: "echo hi" },
          },
        ],
      }),
      lastToolError: { toolName: "exec", error: "Command exited with code 1" },
      verboseLevel: "on",
    });

    expectSingleToolErrorPayload(payloads, {
      title: "Exec",
      absentDetail: "code 1",
    });
  });

  it("does not add tool error fallback when assistant text exists after tool calls", () => {
    const payloads = buildPayloads({
      assistantTexts: ["Checked the page and recovered with final answer."],
      lastAssistant: makeAssistant({
        stopReason: "toolUse",
        errorMessage: undefined,
        content: [
          {
            type: "toolCall",
            id: "toolu_01",
            name: "browser",
            arguments: { action: "search", query: "openclaw docs" },
          },
        ],
      }),
      lastToolError: { toolName: "browser", error: "connection timeout" },
    });

    expectSinglePayloadSummary(payloads, {
      text: "Checked the page and recovered with final answer.",
    });
  });

  it.each(["url required", "url missing", "invalid parameter: url"])(
    "suppresses recoverable non-mutating tool error: %s",
    (error) => {
      expectNoPayloads({
        lastToolError: { toolName: "browser", error },
      });
    },
  );

  it("suppresses non-mutating non-recoverable tool errors when messages.suppressToolErrors is enabled", () => {
    expectNoPayloads({
      lastToolError: { toolName: "browser", error: "connection timeout" },
      config: { messages: { suppressToolErrors: true } },
    });
  });

  it("suppresses genuinely-failed sessions_spawn errors when messages.suppressToolErrors is enabled", () => {
    // sessions_spawn honest-failure badge must still respect the operator's
    // global suppressToolErrors config (ENG-16868 review finding).
    expectNoPayloads({
      assistantTexts: [],
      lastToolError: { toolName: "sessions_spawn", error: "sub-agent step errored" },
      config: { messages: { suppressToolErrors: true } },
    });
  });

  it("suppresses mutating tool errors when suppressToolErrorWarnings is enabled", () => {
    expectNoPayloads({
      lastToolError: { toolName: "exec", error: "command not found" },
      suppressToolErrorWarnings: true,
    });
  });

  it.each([
    {
      name: "suppresses mutating tool errors when messages.suppressToolErrors is enabled",
      payload: {
        lastToolError: { toolName: "write", error: "connection timeout" },
        config: { messages: { suppressToolErrors: true } },
      },
      title: "Write",
      absentDetail: "connection timeout",
      suppressed: true,
    },
    {
      name: "shows recoverable tool errors for mutating tools",
      payload: {
        lastToolError: { toolName: "message", meta: "reply", error: "text required" },
      },
      title: "Message",
      absentDetail: "required",
    },
    {
      name: "shows non-recoverable tool failure summaries to the user",
      payload: {
        lastToolError: { toolName: "browser", error: "connection timeout" },
      },
      title: "Browser",
      absentDetail: "connection timeout",
    },
  ])("$name", ({ payload, title, absentDetail, suppressed }) => {
    const payloads = buildPayloads(payload);
    if (suppressed) {
      expect(payloads).toEqual([]);
      return;
    }
    expectSingleToolErrorPayload(payloads, { title, absentDetail });
  });

  it("shows mutating tool errors when assistant output claims success", () => {
    const payloads = buildPayloads({
      assistantTexts: ["Done."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "write", error: "file missing" },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.text).toBe("Done.");
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Write");
    expect(payloads[1]?.text).not.toContain("missing");
    expect(getReplyPayloadMetadata(payloads[1] as object)?.nonTerminalToolErrorWarning).toBe(
      undefined,
    );
  });

  it("still shows write tool errors when timedOut is true but no fileTarget was recorded", () => {
    // Without `fileTarget` we cannot distinguish a confirmed file write from
    // an unrelated mutating-tool timeout, so the default-visible warning is
    // preserved to avoid hiding real failures.
    const payloads = buildPayloads({
      assistantTexts: ["Done."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "write",
        error: "invoke timed out",
        timedOut: true,
        mutatingAction: true,
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Write");
  });

  it("still shows write tool errors when timedOut and fileTarget only prove the attempted path", () => {
    const payloads = buildPayloads({
      assistantTexts: ["Done."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "write",
        error: "invoke timed out",
        timedOut: true,
        mutatingAction: true,
        fileTarget: { path: "/tmp/openclaw/output.md" },
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Write");
  });

  it("still surfaces a read-only exec failure when the turn produced no reply", () => {
    // Regression: boon keeps the ENG-16330 exec suppression below the mutating
    // branch, but it must require a delivered reply. A read-only exec failure
    // (mutatingAction false) with no assistant text skips the mutating branch, so
    // an unconditional suppression returned zero payloads and the failure vanished
    // silently -- the user saw nothing at all.
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "exec",
        error: "/bin/bash: line 1: python: command not found",
        mutatingAction: false,
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain("Exec");
  });

  it("reframes a recovered exec timeout on a successful turn as an intermediate status", () => {
    // A recovered exec/bash/process error on a turn that still produced a
    // real reply is non-terminal — the deliverable is the answer, not the command
    // call. Reframe the false "⚠️ Exec failed" badge into a note that names the
    // step and the classified reason, not a terminal warning.
    const payloads = buildPayloads({
      assistantTexts: ["The script is ready."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "exec",
        error: "command timed out",
        timedOut: true,
        mutatingAction: true,
      },
    });

    expect(payloads).toHaveLength(2);
    const warning = payloads[1];
    expect(getReplyPayloadMetadata(warning as object)?.nonTerminalToolErrorWarning).toBe(true);
    expect(warning?.text).not.toContain("⚠️");
    expect(warning?.text).not.toContain("failed");
    // Names the step, the classified reason, and the impact on the reply above.
    expect(warning?.text).toContain("Step:");
    expect(warning?.text).toContain("timed out");
    expect(warning?.text).toMatch(/reply above|redo that step/i);
  });

  it("attaches a Retry button to the non-terminal step-failure note", () => {
    const payloads = buildPayloads({
      assistantTexts: ["The script is ready."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "exec",
        error: "command timed out",
        timedOut: true,
        mutatingAction: true,
      },
    });

    const warning = payloads[1];
    expect(warning?.presentation?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [{ label: "Retry", action: { type: "command", command: "/retry" } }],
      },
    ]);
  });

  it("attaches a Retry button and a suppression-bypass mark to a terminal '⚠️ … failed' badge", () => {
    // A terminal badge means no usable reply exists at all — that is exactly
    // the state a failed mutating send (e.g. the message tool failing to
    // deliver a generated file) leaves the user in, so it needs Retry and
    // must survive message_tool_only delivery suppression just like the
    // non-terminal reframe does.
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "process",
        meta: "salty-shore",
        error: "Process exited with code 1.",
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.presentation?.blocks).toEqual([
      {
        type: "buttons",
        buttons: [{ label: "Retry", action: { type: "command", command: "/retry" } }],
      },
    ]);
    expect(
      getReplyPayloadMetadata(payloads[0] as object)?.deliverDespiteSourceReplySuppression,
    ).toBe(true);
  });

  it("reframes a recovered exec error as an intermediate status when the turn claims success", () => {
    const payloads = buildPayloads({
      assistantTexts: ["The script is ready to use and saved in your workspace."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "exec",
        error: "/bin/bash: line 1: python: command not found",
        mutatingAction: true,
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.text).toBe("The script is ready to use and saved in your workspace.");
    const warning = payloads[1];
    expect(getReplyPayloadMetadata(warning as object)?.nonTerminalToolErrorWarning).toBe(true);
    expect(warning?.text).not.toContain("⚠️");
    expect(warning?.text).not.toContain("failed");
    // Raw error text stays hidden at default verbosity; only the fixed,
    // classified reason ("not found") is user-safe to surface.
    expect(warning?.text).not.toContain("python: command not found");
    expect(warning?.text).toContain("not found");
  });

  it("suppresses the recovered-exec note entirely when the failing step was benign housekeeping (ENG-16318)", () => {
    // The customer symptom: a correct triage answer followed by a trailing
    // `find /` that exited non-zero on permission-denied. The failing step is
    // bookkeeping, not the task — so no ⚠️ badge AND no "↻ kept going" note.
    const payloads = buildPayloads({
      assistantTexts: ["Here is the discipline-by-discipline breakdown of the permit set."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "exec",
        error: "find: '/proc': Permission denied",
        benignHousekeepingError: true,
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.text).toBe(
      "Here is the discipline-by-discipline breakdown of the permit set.",
    );
    expect(payloads[0]?.isError).toBeFalsy();
  });

  it("keeps the recovered-exec note when the failing step was NOT benign housekeeping (ENG-16318)", () => {
    // A recovered exec whose failing tail was real work (not read-only) still
    // gets the named-step note — only benign housekeeping is silent.
    const payloads = buildPayloads({
      assistantTexts: ["The build script is ready."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "exec",
        error: "python: command not found",
      },
    });

    expect(payloads).toHaveLength(2);
    const warning = payloads[1];
    expect(getReplyPayloadMetadata(warning as object)?.nonTerminalToolErrorWarning).toBe(true);
    expect(warning?.text).toContain("Step:");
  });

  it("still flushes a terminal badge for a benign-housekeeping exec error when NO reply exists (ENG-16318 guard)", () => {
    // No user-facing reply → the turn did not recover into a real answer, so the
    // honest terminal badge must still surface even for read-only housekeeping.
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "exec",
        error: "find: '/proc': Permission denied",
        benignHousekeepingError: true,
      },
      verboseLevel: "full",
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain("⚠️");
    expect(payloads[0]?.text).toContain("failed");
  });

  it("shows mutating tool errors when assistant output does not acknowledge the failure", () => {
    const payloads = buildPayloads({
      assistantTexts: ["No issues found. The update is complete."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "edit", error: "file missing" },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.text).toBe("No issues found. The update is complete.");
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Edit");
    expect(payloads[1]?.text).not.toContain("missing");
  });

  it("shows mutating tool errors when assistant says it did not find issues in the file", () => {
    const text = "I did not find any issues in the file. The update is complete.";
    const payloads = buildPayloads({
      assistantTexts: [text],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "edit", error: "file missing" },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.text).toBe(text);
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Edit");
    expect(payloads[1]?.text).not.toContain("missing");
  });

  it.each([
    "I did not need to update the file; it is already correct.",
    "I did not have to edit the file because it was already correct.",
  ])("shows mutating tool errors when assistant output uses no-op phrasing: %s", (text) => {
    const payloads = buildPayloads({
      assistantTexts: [text],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "edit", error: "file missing" },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.text).toBe(text);
    expect(payloads[1]?.isError).toBe(true);
    expect(payloads[1]?.text).toContain("Edit");
    expect(payloads[1]?.text).not.toContain("missing");
  });

  it("suppresses mutating tool errors when assistant output explicitly acknowledges the failed action", () => {
    const text = "I couldn't update the file, so no changes were applied.";
    const payloads = buildPayloads({
      assistantTexts: [text],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "edit", error: "file missing" },
      sourceReplyDeliveryMode: "automatic",
    });

    expectSinglePayloadSummary(payloads, { text });
  });

  it("still shows a failed message-tool send when the acknowledging prose is message_tool_only-private", () => {
    // message_tool_only prose is dropped at dispatch (only payloads marked
    // deliverDespiteSourceReplySuppression survive). A model writing
    // "I couldn't send the file" there is not an acknowledgement the user saw
    // — it is text nobody will ever see, so it must not disable the failure
    // badge for the one signal that actually reaches the user.
    const text = "I couldn't send the spreadsheet, so it wasn't delivered.";
    const payloads = buildPayloads({
      assistantTexts: [text],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "message", error: "Unknown target", mutatingAction: true },
      sourceReplyDeliveryMode: "message_tool_only",
    });

    const warning = payloads.find((payload) => payload.isError === true);
    expect(warning).toBeDefined();
    expect(warning?.text).toContain("failed");
    expect(getReplyPayloadMetadata(warning as object)?.deliverDespiteSourceReplySuppression).toBe(
      true,
    );
  });

  it("suppresses exec warnings when assistant output explicitly acknowledges the command failure", () => {
    const text = "I couldn't run the command because python was not found.";
    const payloads = buildPayloads({
      assistantTexts: [text],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: { toolName: "exec", error: "/bin/bash: line 1: python: command not found" },
    });

    expectSinglePayloadSummary(payloads, { text });
  });

  it("does not treat session_status read failures as mutating when explicitly flagged", () => {
    const payloads = buildPayloads({
      assistantTexts: ["Status loaded."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "session_status",
        error: "model required",
        mutatingAction: false,
      },
    });

    expectSinglePayloadSummary(payloads, { text: "Status loaded." });
  });

  it("dedupes identical tool warning text already present in assistant output", () => {
    const seed = buildPayloads({
      lastToolError: {
        toolName: "write",
        error: "file missing",
        mutatingAction: true,
      },
    });
    const warningText = seed[0]?.text;
    expect(warningText).toBe("⚠️ ✍️ Write failed");

    const payloads = buildPayloads({
      assistantTexts: [warningText ?? ""],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      lastToolError: {
        toolName: "write",
        error: "file missing",
        mutatingAction: true,
      },
    });

    expectSinglePayloadSummary(payloads, { text: warningText ?? "" });
  });

  it("suppresses a middleware (post-processing) tool failure entirely once a reply was delivered", () => {
    // A middleware failure means the tool's result couldn't be sanitized — not
    // that the tool itself failed (buildMiddlewareFailureResult). Its outcome
    // is genuinely unknown, so "a step didn't complete" overstates the
    // evidence. Once a real reply was delivered, drop the note entirely —
    // same precedent as the sessions_spawn suppression above.
    const payloads = buildPayloads({
      assistantTexts: ["Here's the summary you asked for."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      currentAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      toolMetas: [
        { toolName: "bash", meta: "run migration" },
        { toolName: "read", meta: "config.json" },
        { toolName: "message", meta: undefined },
      ],
      lastToolError: {
        toolName: "message",
        error: "transient send failure",
        middlewareError: true,
        mutatingAction: true,
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.text).toBe("Here's the summary you asked for.");
    expect(getReplyPayloadMetadata(payloads[0] as object)?.nonTerminalToolErrorWarning).toBe(
      undefined,
    );
  });

  it("still surfaces a middleware tool failure honestly when the turn produced NO reply", () => {
    // No user-facing reply → the outcome is not "unknown but fine", it's a
    // genuine failure. The suppression above only applies once a reply exists.
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "message",
        error: "transient send failure",
        middlewareError: true,
        mutatingAction: true,
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain("⚠️");
    expect(payloads[0]?.text).toContain("failed");
  });

  it("keeps tool identity + raw error detail in the non-terminal status when verbose (operator debug)", () => {
    // Middleware failures are suppressed outright (see above), so the verbose
    // operator-detail path is now proven on a recovered exec/process failure —
    // the class of failure that still reaches the non-terminal builder.
    const payloads = buildPayloads({
      assistantTexts: ["Here's the summary you asked for."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      currentAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      toolMetas: [
        { toolName: "bash", meta: "run migration" },
        { toolName: "process", meta: undefined },
      ],
      lastToolError: {
        toolName: "process",
        error: "transient send failure",
      },
      verboseLevel: "full",
    });

    const warning = payloads.find(
      (p) => getReplyPayloadMetadata(p)?.nonTerminalToolErrorWarning === true,
    );
    expect(warning).toBeDefined();
    // Still a continuation, still no terminal "failed".
    expect(warning?.text).not.toContain("⚠️");
    // But verbose retains the raw detail for the operator, beyond the fixed
    // classified reason.
    expect(warning?.text).toContain("transient send failure");
  });

  it("counts only successfully-completed tools when MULTIPLE calls errored in the turn", () => {
    // Two transient failures in one turn: bash ok, read errored, process errored.
    // toolMetas carries an `errored` flag per call, so the count must be the
    // number of non-errored tools (1), not toolMetas.length - 1 (which assumes
    // a single failure and would wrongly say 2).
    const payloads = buildPayloads({
      assistantTexts: ["Here's the summary you asked for."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      currentAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      toolMetas: [
        { toolName: "bash", meta: "run migration" },
        { toolName: "read", meta: "config.json", errored: true },
        { toolName: "process", meta: undefined, errored: true },
      ],
      lastToolError: {
        toolName: "process",
        error: "transient send failure",
      },
    });

    const warning = payloads.find(
      (p) => getReplyPayloadMetadata(p)?.nonTerminalToolErrorWarning === true,
    );
    expect(warning).toBeDefined();
    expect(warning?.text).toContain("1 of 3 steps completed");
    // Header pluralizes with the count of steps that didn't finish (2), not a
    // hardcoded singular "One step" regardless of how many actually failed.
    expect(warning?.text).toContain("2 steps didn't finish");
    // The label and closing guidance stay plural-consistent with the header
    // instead of naming a single "Step:" while multiple steps failed.
    expect(warning?.text).toContain("Most recent step:");
    expect(warning?.text).toMatch(/redo them/i);
    expect(warning?.text).not.toMatch(/\bStep:/);
    expect(warning?.text).not.toMatch(/redo that step/i);
  });

  it("wraps markdown-capable mutating tool warnings so mention-looking names stay inert", () => {
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "bash",
        meta: "show matrix-progress-@room-@alice:matrix-qa.test-!room:matrix-qa.test.txt (workspace)",
        error: "file missing",
        mutatingAction: true,
      },
      toolResultFormat: "markdown",
    });

    expectSinglePayloadSummary(payloads, {
      text: "⚠️ 🛠️ `show matrix-progress-@room-@alice:matrix-qa.test-!room:matrix-qa.test.txt (workspace)` failed",
      isError: true,
    });
  });

  it("reframes a recovered bg-process non-zero exit as a named, classified intermediate status", () => {
    // The gandalf `salty-shore` case: a backgrounded process session exits
    // non-zero, the agent RECOVERS (produces a real final reply), the turn
    // succeeds — yet core rendered "⚠️ 🧰 Process: salty-shore failed", giving the
    // user the wrong intuition ("the agent broke"). A recovered exec/bash/process
    // error on a successful turn is non-terminal — but this supersedes the
    // earlier choice to hide the process identity here: the terminal "⚠️ failed"
    // path already names it (see the no-reply regression guard below), so
    // hiding it only in the recovered case was an inconsistency, not a
    // deliberate redaction. Naming which process recovered is exactly what the
    // reported bug asked for.
    const payloads = buildPayloads({
      assistantTexts: ["Here's the honest status while the draft work runs."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      currentAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      toolMetas: [
        { toolName: "read", meta: "plan.md" },
        { toolName: "process", meta: "salty-shore" },
      ],
      lastToolError: {
        toolName: "process",
        meta: "salty-shore",
        error: "Process exited with code 1.",
      },
    });

    const warning = payloads.find(
      (p) => getReplyPayloadMetadata(p)?.nonTerminalToolErrorWarning === true,
    );
    expect(warning).toBeDefined();
    expect(warning?.text).not.toContain("⚠️");
    expect(warning?.text).not.toContain("failed");
    expect(warning?.text).toContain("salty-shore");
    expect(warning?.text).toContain("exited with an error");
  });

  it("reframes a recovered exec non-zero exit as a named intermediate status on a successful turn", () => {
    const payloads = buildPayloads({
      assistantTexts: ["The script is ready to use and saved in your workspace."],
      lastAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      currentAssistant: { stopReason: "end_turn" } as unknown as AssistantMessage,
      toolMetas: [{ toolName: "exec", meta: "python build.py" }],
      lastToolError: {
        toolName: "exec",
        error: "/bin/bash: line 1: python: command not found",
      },
    });

    const warning = payloads.find(
      (p) => getReplyPayloadMetadata(p)?.nonTerminalToolErrorWarning === true,
    );
    expect(warning).toBeDefined();
    expect(warning?.text).not.toContain("⚠️");
    expect(warning?.text).not.toContain("failed");
    expect(warning?.text).toContain("Step:");
    expect(warning?.text).toContain("not found");
  });

  it("still flushes a terminal '⚠️ … failed' badge for a recovered tool when the turn produced NO reply (regression guard)", () => {
    // No user-facing reply → the turn did not recover into a real answer, so the
    // honest terminal badge must still surface (no #53/#47/#48/#50 regression).
    const payloads = buildPayloads({
      lastToolError: {
        toolName: "process",
        meta: "salty-shore",
        error: "Process exited with code 1.",
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.isError).toBe(true);
    expect(payloads[0]?.text).toContain("⚠️");
    expect(payloads[0]?.text).toContain("failed");
    expect(getReplyPayloadMetadata(payloads[0] as object)?.nonTerminalToolErrorWarning).toBe(
      undefined,
    );
  });

  it("keeps non-recoverable tool errors compact when verbose mode is on", () => {
    const payloads = buildPayloads({
      lastToolError: { toolName: "browser", error: "connection timeout" },
      verboseLevel: "on",
    });

    expectSingleToolErrorPayload(payloads, {
      title: "Browser",
      absentDetail: "connection timeout",
    });
  });

  it("includes non-recoverable tool error details when verbose mode is full", () => {
    const payloads = buildPayloads({
      lastToolError: { toolName: "browser", error: "connection timeout" },
      verboseLevel: "full",
    });

    expectSingleToolErrorPayload(payloads, {
      title: "Browser",
      detail: "connection timeout",
    });
  });
});
