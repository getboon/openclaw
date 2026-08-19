import type {
  PluginHookAfterToolCallEvent,
  PluginHookAgentEndEvent,
  PluginHookCronChangedEvent,
  PluginHookMessageSentEvent,
  PluginHookModelCallEndedEvent,
  PluginHookSessionEndEvent,
  PluginHookSubagentEndedEvent,
} from "openclaw/plugin-sdk/types";
import { describe, expect, it } from "vitest";
import {
  buildAfterToolCallCapture,
  buildAgentEndCapture,
  buildCronChangedCapture,
  buildMessageSentCapture,
  buildModelCallEndedCapture,
  buildSessionEndCapture,
  buildSubagentEndedCapture,
} from "./captures.js";

const HOST = "gw-1";

function modelCall(
  overrides: Partial<PluginHookModelCallEndedEvent> = {},
): PluginHookModelCallEndedEvent {
  return {
    runId: "r1",
    callId: "c1",
    provider: "anthropic",
    model: "claude",
    durationMs: 10,
    outcome: "error",
    ...overrides,
  };
}

describe("buildModelCallEndedCapture", () => {
  it("ignores completed calls", () => {
    expect(buildModelCallEndedCapture(modelCall({ outcome: "completed" }), HOST)).toBeNull();
  });

  it("captures errored calls as an exception with provider/model/host tags", () => {
    const capture = buildModelCallEndedCapture(
      modelCall({
        errorCategory: "rate_limit",
        failureKind: "timeout",
        api: "messages",
        transport: "http",
      }),
      HOST,
    );
    expect(capture).not.toBeNull();
    expect(capture?.kind).toBe("exception");
    expect(capture?.message).toBe("model_call_ended: rate_limit, failure_kind=timeout");
    expect(capture?.tags).toMatchObject({
      hook: "model_call_ended",
      host: HOST,
      provider: "anthropic",
      model: "claude",
      api: "messages",
      transport: "http",
      failure_kind: "timeout",
      error_category: "rate_limit",
    });
    expect(capture?.contexts?.run).toEqual({ run_id: "r1", session_id: undefined, call_id: "c1" });
    expect(capture?.fingerprint).toEqual([
      "model_call_ended",
      "anthropic",
      "claude",
      "timeout",
      "rate_limit",
    ]);
  });

  it("tags a relayed upstream provider 5xx (Bedrock 503) with error_class + http_status (ENG-16922)", () => {
    const capture = buildModelCallEndedCapture(
      modelCall({ httpStatus: 503, errorClass: "upstream_provider_5xx", errorCategory: "Error" }),
      HOST,
    );
    expect(capture?.tags).toMatchObject({ error_class: "upstream_provider_5xx" });
    expect(capture?.extra).toMatchObject({ http_status: 503 });
    expect(capture?.message).toBe(
      "model_call_ended: upstream_provider_5xx, http_status=503, Error",
    );
    expect(capture?.fingerprint).toEqual([
      "model_call_ended",
      "anthropic",
      "claude",
      "upstream_provider_5xx",
      "503",
      "Error",
    ]);
  });

  it("tags a gateway-synthesized 502 as gateway_origin_5xx (ENG-16922)", () => {
    const capture = buildModelCallEndedCapture(
      modelCall({ httpStatus: 502, errorClass: "gateway_origin_5xx", errorCategory: "Error" }),
      HOST,
    );
    expect(capture?.tags).toMatchObject({ error_class: "gateway_origin_5xx" });
    expect(capture?.extra).toMatchObject({ http_status: 502 });
    expect(capture?.message).toBe("model_call_ended: gateway_origin_5xx, http_status=502, Error");
    expect(capture?.fingerprint).toEqual([
      "model_call_ended",
      "anthropic",
      "claude",
      "gateway_origin_5xx",
      "502",
      "Error",
    ]);
  });

  it("fingerprints the same error_class with different http statuses into different issues", () => {
    const bedrock503 = buildModelCallEndedCapture(
      modelCall({ httpStatus: 503, errorClass: "upstream_provider_5xx", errorCategory: "Error" }),
      HOST,
    );
    const bedrock502 = buildModelCallEndedCapture(
      modelCall({ httpStatus: 502, errorClass: "upstream_provider_5xx", errorCategory: "Error" }),
      HOST,
    );
    expect(bedrock503?.fingerprint).not.toEqual(bedrock502?.fingerprint);
  });

  it("omits error_class when the failure carries no 5xx classification", () => {
    const capture = buildModelCallEndedCapture(
      modelCall({ failureKind: "connection_reset", errorCategory: "Error" }),
      HOST,
    );
    expect(capture?.tags).not.toHaveProperty("error_class");
    expect(capture?.extra).toMatchObject({ http_status: undefined });
  });
});

describe("buildAgentEndCapture", () => {
  it("ignores successful turns", () => {
    expect(buildAgentEndCapture({ messages: [], success: true }, HOST)).toBeNull();
  });

  it("captures failed turns, using the error message and message count", () => {
    const capture = buildAgentEndCapture(
      {
        messages: [{}, {}],
        success: false,
        error: "context overflow",
        runId: "r9",
        durationMs: 5,
      } as PluginHookAgentEndEvent,
      HOST,
    );
    expect(capture?.kind).toBe("exception");
    expect(capture?.message).toBe("context overflow");
    expect(capture?.extra?.message_count).toBe(2);
    expect(capture?.fingerprint).toEqual(["agent_end", "context overflow"]);
    expect(capture?.contexts?.run).toEqual({
      run_id: "r9",
      session_id: undefined,
      call_id: undefined,
    });
  });

  it("falls back to a generic message when no error string is present", () => {
    expect(buildAgentEndCapture({ messages: [], success: false }, HOST)?.message).toBe(
      "agent_end success=false",
    );
  });
});

describe("buildAfterToolCallCapture", () => {
  it("ignores tool calls without an error", () => {
    const ok: PluginHookAfterToolCallEvent = { toolName: "bash", params: {} };
    expect(buildAfterToolCallCapture(ok, HOST)).toBeNull();
  });

  it("captures tool errors and tags the tool name", () => {
    const capture = buildAfterToolCallCapture(
      { toolName: "bash", params: {}, error: "exit 1", toolCallId: "tc1" },
      HOST,
    );
    expect(capture?.kind).toBe("exception");
    expect(capture?.message).toBe("exit 1");
    expect(capture?.tags.tool).toBe("bash");
    expect(capture?.extra?.tool_call_id).toBe("tc1");
    expect(capture?.fingerprint).toEqual(["after_tool_call", "bash", "exit 1"]);
  });

  it("fingerprints different tools' failures into different issues", () => {
    // Every after_tool_call capture is thrown from the same call site in
    // dispatch.ts, so without an explicit fingerprint Sentry's stack-based
    // grouping merges unrelated tool failures into one issue.
    const execFailure = buildAfterToolCallCapture(
      { toolName: "exec", params: {}, error: "Traceback (most recent call last):" },
      HOST,
    );
    const webFetchFailure = buildAfterToolCallCapture(
      { toolName: "web_fetch", params: {}, error: "Web fetch failed (403)" },
      HOST,
    );
    expect(execFailure?.fingerprint).not.toEqual(webFetchFailure?.fingerprint);
  });

  it("fingerprints different errors from the same tool into different issues", () => {
    const timeout = buildAfterToolCallCapture(
      { toolName: "exec", params: {}, error: "ValueError: bad input" },
      HOST,
    );
    const denied = buildAfterToolCallCapture(
      { toolName: "exec", params: {}, error: "KeyError: 'missing'" },
      HOST,
    );
    expect(timeout?.fingerprint).not.toEqual(denied?.fingerprint);
  });
});

describe("buildMessageSentCapture", () => {
  it("ignores successful deliveries", () => {
    const ok: PluginHookMessageSentEvent = { to: "c", content: "hi", success: true };
    expect(buildMessageSentCapture(ok, HOST)).toBeNull();
  });

  it("captures delivery failures", () => {
    const capture = buildMessageSentCapture(
      { to: "c", content: "hi", success: false, error: "socket closed", messageId: "m1" },
      HOST,
    );
    expect(capture?.message).toBe("socket closed");
    expect(capture?.extra?.message_id).toBe("m1");
    expect(capture?.fingerprint).toEqual(["message_sent", "socket closed"]);
  });
});

describe("buildSubagentEndedCapture", () => {
  it("ignores ok and undefined outcomes", () => {
    const base = {
      targetSessionKey: "s",
      targetKind: "subagent",
      reason: "done",
    } as PluginHookSubagentEndedEvent;
    expect(buildSubagentEndedCapture({ ...base, outcome: "ok" }, HOST)).toBeNull();
    expect(buildSubagentEndedCapture(base, HOST)).toBeNull();
  });

  it.each(["error", "timeout", "killed", "reset", "deleted"] as const)(
    "captures the %s outcome",
    (outcome) => {
      const capture = buildSubagentEndedCapture(
        { targetSessionKey: "s", targetKind: "subagent", reason: "r", outcome },
        HOST,
      );
      expect(capture?.kind).toBe("exception");
      expect(capture?.tags.outcome).toBe(outcome);
      expect(capture?.message).toBe(`subagent_ended outcome=${outcome}`);
      expect(capture?.fingerprint).toEqual([
        "subagent_ended",
        outcome,
        "subagent",
        `outcome=${outcome}`,
      ]);
    },
  );
});

describe("buildCronChangedCapture", () => {
  const base: PluginHookCronChangedEvent = { action: "finished", jobId: "j1" };

  it("ignores non-error lifecycle changes", () => {
    expect(buildCronChangedCapture({ ...base, status: "ok" }, HOST)).toBeNull();
    expect(buildCronChangedCapture({ ...base, action: "added" }, HOST)).toBeNull();
  });

  it("captures a run error even when the error text is missing", () => {
    expect(buildCronChangedCapture({ ...base, status: "error" }, HOST)?.message).toBe(
      "cron_changed status=error delivery=unknown",
    );
    expect(
      buildCronChangedCapture({ ...base, status: "error", error: "boom" }, HOST)?.message,
    ).toBe("boom");
  });

  it("captures a delivery error independent of run status", () => {
    const capture = buildCronChangedCapture({ ...base, deliveryError: "post failed" }, HOST);
    expect(capture?.kind).toBe("exception");
    expect(capture?.message).toBe("post failed");
    expect(capture?.tags.delivery_status).toBeUndefined();
    expect(capture?.extra?.delivery_error).toBe("post failed");
    expect(capture?.fingerprint).toEqual(["cron_changed", "finished", "post failed"]);
  });

  it("captures a not-delivered status even with no error string (dropped output)", () => {
    const capture = buildCronChangedCapture(
      { ...base, status: "ok", deliveryStatus: "not-delivered" },
      HOST,
    );
    expect(capture?.kind).toBe("exception");
    expect(capture?.tags.delivery_status).toBe("not-delivered");
    expect(capture?.message).toBe("cron_changed status=ok delivery=not-delivered");
  });

  it("ignores benign delivery statuses", () => {
    expect(
      buildCronChangedCapture({ ...base, status: "ok", deliveryStatus: "not-requested" }, HOST),
    ).toBeNull();
    expect(
      buildCronChangedCapture({ ...base, status: "ok", deliveryStatus: "delivered" }, HOST),
    ).toBeNull();
  });

  it("never ships the free-form run summary as content", () => {
    const capture = buildCronChangedCapture(
      { ...base, status: "error", error: "boom", summary: "customer X owes $5000" },
      HOST,
    );
    expect(capture?.extra).not.toHaveProperty("summary");
    expect(JSON.stringify(capture)).not.toContain("customer X");
  });
});

describe("buildSessionEndCapture", () => {
  const base: PluginHookSessionEndEvent = { sessionId: "s1", messageCount: 3 };

  it.each([
    "idle",
    "new",
    "daily",
    "compaction",
    "deleted",
    "shutdown",
    "restart",
    "reset",
  ] as const)("ignores normal lifecycle reason %s", (reason) => {
    expect(buildSessionEndCapture({ ...base, reason }, HOST)).toBeNull();
  });

  it("captures unknown (or missing) reason as a warning message", () => {
    const fromUnknown = buildSessionEndCapture({ ...base, reason: "unknown" }, HOST);
    const fromMissing = buildSessionEndCapture(base, HOST);
    for (const capture of [fromUnknown, fromMissing]) {
      expect(capture?.kind).toBe("message");
      expect(capture?.kind === "message" && capture.level).toBe("warning");
      expect(capture?.message).toBe("session_end reason=unknown");
      expect(capture?.extra?.message_count).toBe(3);
      expect(capture?.fingerprint).toEqual(["session_end", "unknown"]);
    }
  });
});
