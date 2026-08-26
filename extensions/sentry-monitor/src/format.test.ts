import type { PluginHookModelCallEndedEvent } from "openclaw/plugin-sdk/types";
import { describe, expect, it, vi } from "vitest";
import {
  describeModelCallError,
  fingerprintOf,
  normalizeFingerprintText,
  pruneTags,
  runContext,
  safe,
  stringifyErr,
} from "./format.js";

describe("pruneTags", () => {
  it("drops undefined, null, and empty values and keeps the rest", () => {
    expect(
      pruneTags({
        hook: "model_call_ended",
        provider: "anthropic",
        model: undefined,
        api: "",
        transport: null as unknown as undefined,
      }),
    ).toEqual({ hook: "model_call_ended", provider: "anthropic" });
  });

  it("keeps present string values verbatim", () => {
    expect(pruneTags({ outcome: "error", reason: "stale" })).toEqual({
      outcome: "error",
      reason: "stale",
    });
  });
});

describe("describeModelCallError", () => {
  it("includes category and failure kind when present", () => {
    const event = {
      errorCategory: "rate_limit",
      failureKind: "timeout",
    } as PluginHookModelCallEndedEvent;
    expect(describeModelCallError(event)).toBe(
      "model_call_ended: rate_limit, failure_kind=timeout",
    );
  });

  it("falls back to a generic message when no detail is present", () => {
    expect(describeModelCallError({} as PluginHookModelCallEndedEvent)).toBe(
      "model_call_ended outcome=error",
    );
  });
});

describe("fingerprintOf", () => {
  it("drops undefined, null, and empty parts and stringifies the rest", () => {
    expect(fingerprintOf("after_tool_call", "exec", undefined, "", "boom", 42)).toEqual([
      "after_tool_call",
      "exec",
      "boom",
      "42",
    ]);
  });

  it("returns distinct arrays for distinct inputs", () => {
    expect(fingerprintOf("after_tool_call", "exec", "err a")).not.toEqual(
      fingerprintOf("after_tool_call", "web_fetch", "err a"),
    );
  });
});

describe("normalizeFingerprintText", () => {
  it("leaves text with no volatile tokens unchanged", () => {
    expect(normalizeFingerprintText("Session history visibility is restricted")).toBe(
      "Session history visibility is restricted",
    );
  });

  it("scrubs a UUID", () => {
    expect(
      normalizeFingerprintText("File not found: f3b7865c-3ab9-4fce-b998-d767dcbd9d88.pdf"),
    ).toBe("File not found: <uuid>.pdf");
  });

  it("scrubs an absolute path with multiple segments", () => {
    expect(
      normalizeFingerprintText("Local media path is not under /tmp/mvisd_turf/L202-1.png"),
    ).toBe("Local media path is not under <path>");
  });

  it("scrubs a bare filename with extension", () => {
    expect(normalizeFingerprintText("Wrote report-final.xlsx")).toBe("Wrote <file>");
  });

  it("scrubs an NxM dimension pair", () => {
    expect(normalizeFingerprintText("exceeds limit: 9072x3240")).toBe("exceeds limit: <dim>");
  });

  it("scrubs a short 'Mon DD HH:MM' date", () => {
    expect(normalizeFingerprintText("written Aug 20 13:33")).toBe("written <ts>");
  });

  it("scrubs an ISO timestamp", () => {
    expect(normalizeFingerprintText("at 2026-08-20T13:33:03.872Z")).toBe("at <ts>");
  });

  it("scrubs bare numbers, including comma-grouped ones", () => {
    expect(normalizeFingerprintText("31429 bytes, limit 25,000,000")).toBe("<n> bytes, limit <n>");
  });

  it("normalizes two occurrences that differ only by volatile tokens to the same text", () => {
    const a = normalizeFingerprintText("-rw-rw-r-- 1 ubuntu ubuntu 31429 Aug 20 13:33 report.xlsx");
    const b = normalizeFingerprintText("-rw-rw-r-- 1 ubuntu ubuntu 88 Aug 21 09:02 report.xlsx");
    expect(a).toBe(b);
  });
});

describe("runContext", () => {
  it("returns undefined when no ids are present", () => {
    expect(runContext()).toBeUndefined();
  });

  it("maps provided ids to snake_case context keys", () => {
    expect(runContext("r1", "s1", "c1")).toEqual({ run_id: "r1", session_id: "s1", call_id: "c1" });
  });
});

describe("safe", () => {
  it("swallows handler errors and logs them instead of throwing", () => {
    const logger = { error: vi.fn() };
    expect(() =>
      safe(logger, "sentry-monitor", "model_call_ended", () => {
        throw new Error("boom");
      }),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0]?.[0]).toContain("model_call_ended");
    expect(logger.error.mock.calls[0]?.[0]).toContain("boom");
  });

  it("runs the body and does not log on success", () => {
    const logger = { error: vi.fn() };
    const body = vi.fn();
    safe(logger, "sentry-monitor", "agent_end", body);
    expect(body).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("stringifyErr", () => {
  it("uses the message for Error instances", () => {
    expect(stringifyErr(new Error("nope"))).toBe("nope");
  });

  it("JSON-stringifies plain objects", () => {
    expect(stringifyErr({ code: 1 })).toBe('{"code":1}');
  });
});
