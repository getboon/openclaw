// Covers diagnostic error metadata extraction.
import { describe, expect, it } from "vitest";
import {
  classify5xxSource,
  diagnosticErrorCategory,
  diagnosticErrorFailureKind,
  diagnosticFailoverDetailSuffix,
  diagnosticHttpStatusCode,
  diagnosticProviderRequestIdHash,
} from "./diagnostic-error-metadata.js";

describe("diagnostic error metadata", () => {
  it("returns stable categories without reading mutable Error.name", () => {
    const namedFailure = new Error("bad");
    Object.defineProperty(namedFailure, "name", {
      get() {
        throw new Error("should not read name");
      },
    });

    expect(diagnosticErrorCategory(new TypeError("bad"))).toBe("TypeError");
    expect(diagnosticErrorCategory(namedFailure)).toBe("Error");
    expect(diagnosticErrorCategory("bad")).toBe("string");
    expect(diagnosticErrorCategory(null)).toBe("null");
  });

  it("accepts only own HTTP status data properties as error codes", () => {
    expect(diagnosticHttpStatusCode({ status: 429 })).toBe("429");
    expect(diagnosticHttpStatusCode({ statusCode: 503 })).toBe("503");
    expect(diagnosticHttpStatusCode({ code: "SECRET_TOKEN" })).toBeUndefined();
    expect(diagnosticHttpStatusCode({ status: 99 })).toBeUndefined();
    expect(diagnosticHttpStatusCode({ status: "https://example.invalid/secret" })).toBeUndefined();
  });

  it("does not invoke throwing getters while extracting status codes", () => {
    const errorLike = {};
    Object.defineProperty(errorLike, "status", {
      get() {
        throw new Error("should not read getter");
      },
    });

    expect(diagnosticHttpStatusCode(errorLike)).toBeUndefined();
  });

  it("contains proxy traps during extraction", () => {
    const errorLike = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("hostile descriptor");
        },
      },
    );

    expect(diagnosticHttpStatusCode(errorLike)).toBeUndefined();
  });

  it("extracts bounded provider request id hashes without exposing raw ids", () => {
    expect(diagnosticProviderRequestIdHash({ requestId: "req_123" })).toMatch(
      /^sha256:[a-f0-9]{12}$/,
    );
    expect(
      diagnosticProviderRequestIdHash(
        new Error("Provider API error (429): quota [request_id=req_456]"),
      ),
    ).toMatch(/^sha256:[a-f0-9]{12}$/);
    expect(
      diagnosticProviderRequestIdHash({ requestId: "https://example.invalid/secret" }),
    ).toBeUndefined();
  });

  it("does not invoke throwing getters while extracting provider request ids", () => {
    const errorLike = {};
    Object.defineProperty(errorLike, "requestId", {
      get() {
        throw new Error("should not read getter");
      },
    });

    expect(diagnosticProviderRequestIdHash(errorLike)).toBeUndefined();
  });

  it("classifies low-cardinality transport failure kinds without exposing messages", () => {
    expect(diagnosticErrorFailureKind(new Error("terminated"))).toBe("terminated");
    expect(
      diagnosticErrorFailureKind(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })),
    ).toBe("connection_reset");
    expect(
      diagnosticErrorFailureKind({
        error: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }),
      }),
    ).toBe("connection_closed");
    expect(diagnosticErrorFailureKind(new Error("request timed out after 120000ms"))).toBe(
      "timeout",
    );
    expect(diagnosticErrorFailureKind(new Error("operation was aborted"))).toBe("aborted");
    expect(diagnosticErrorFailureKind(new Error("provider rejected the request"))).toBeUndefined();
  });

  it("does not invoke throwing getters while classifying failure kinds", () => {
    const errorLike = {};
    Object.defineProperty(errorLike, "code", {
      get() {
        throw new Error("should not read getter");
      },
    });
    Object.defineProperty(errorLike, "message", {
      get() {
        throw new Error("should not read getter");
      },
    });

    expect(diagnosticErrorFailureKind(errorLike)).toBeUndefined();
  });

  describe("classify5xxSource (ENG-16922)", () => {
    it("classifies relayed upstream provider 5xx by status band", () => {
      expect(classify5xxSource(500)).toBe("upstream_provider_5xx");
      expect(classify5xxSource(503)).toBe("upstream_provider_5xx");
      expect(classify5xxSource(529)).toBe("upstream_provider_5xx");
    });

    it("classifies gateway-synthesized 502 and other 5xx as gateway-origin", () => {
      expect(classify5xxSource(502)).toBe("gateway_origin_5xx");
      expect(classify5xxSource(504)).toBe("gateway_origin_5xx");
      expect(classify5xxSource(500 + 20)).toBe("gateway_origin_5xx"); // 520, unknown 5xx
    });

    it("returns undefined for a missing or non-5xx status", () => {
      expect(classify5xxSource(undefined)).toBeUndefined();
      expect(classify5xxSource(429)).toBeUndefined();
      expect(classify5xxSource(400)).toBeUndefined();
      expect(classify5xxSource(200)).toBeUndefined();
    });

    it("uses a recognized provider error.type to break an ambiguous-status tie", () => {
      // A 502 that actually wraps a relayed provider api_error body is upstream.
      expect(classify5xxSource(502, { error: { type: "api_error" } })).toBe(
        "upstream_provider_5xx",
      );
      expect(classify5xxSource(502, { type: "overloaded_error" })).toBe("upstream_provider_5xx");
      // The type tie-break never fires below the 5xx floor.
      expect(classify5xxSource(429, { type: "api_error" })).toBeUndefined();
    });

    it("ignores an unrelated provider error.type and falls back to the status band", () => {
      expect(classify5xxSource(502, { type: "invalid_request_error" })).toBe("gateway_origin_5xx");
      expect(classify5xxSource(503, { type: "invalid_request_error" })).toBe(
        "upstream_provider_5xx",
      );
    });

    it("does not trigger userland getters while reading the error type", () => {
      const errorLike = {};
      Object.defineProperty(errorLike, "type", {
        get() {
          throw new Error("should not read getter");
        },
      });
      // Falls back to the status band without throwing.
      expect(classify5xxSource(502, errorLike)).toBe("gateway_origin_5xx");
    });
  });

  describe("diagnosticFailoverDetailSuffix", () => {
    it("formats a FailoverError-shaped error's reason/status/code/provider/model/rawError as a log suffix", () => {
      const err = {
        name: "FailoverError",
        reason: "schema",
        status: 429,
        code: "invalid_request_error",
        provider: "anthropic",
        model: "claude-opus-4-6",
        rawError: "invalid_request_error: tool_use.input failed schema validation",
      };
      expect(diagnosticFailoverDetailSuffix(err)).toBe(
        ' reason="schema" status="429" code="invalid_request_error" provider="anthropic" model="claude-opus-4-6" rawError="invalid_request_error: tool_use.input failed schema validation"',
      );
    });

    it("returns an empty string when no failover detail properties are present", () => {
      expect(diagnosticFailoverDetailSuffix(new Error("plain failure"))).toBe("");
    });

    it("ignores an unrelated error that merely has coincidentally-named reason/rawError properties", () => {
      // Only a real FailoverError shape (name + reason) should surface detail —
      // otherwise an unrelated error type gets mislabeled as failover detail.
      const unrelated = {
        name: "SomeOtherError",
        reason: "not-a-failover-reason",
        rawError: "unrelated raw text",
      };
      expect(diagnosticFailoverDetailSuffix(unrelated)).toBe("");
    });

    it("escapes embedded double quotes and backslashes so a JSON rawError can't break the log line", () => {
      const err = {
        name: "FailoverError",
        reason: "schema",
        rawError: '{"error":{"type":"invalid_request_error","path":"C:\\\\models"}}',
      };
      expect(diagnosticFailoverDetailSuffix(err)).toBe(
        ' reason="schema" rawError="{\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"path\\":\\"C:\\\\\\\\models\\"}}"',
      );
    });

    it("single-lines and truncates an oversized rawError", () => {
      const longRaw = `line one\nline two ${"x".repeat(250)}`;
      const suffix = diagnosticFailoverDetailSuffix({
        name: "FailoverError",
        reason: "schema",
        rawError: longRaw,
      });
      expect(suffix).not.toContain("\n");
      expect(suffix.length).toBeLessThan(longRaw.length);
    });

    it("bounds the escaped output even when escaping would expand it past the raw length cap", () => {
      // Escaping must run before truncation: a rawError dense with quotes/backslashes
      // roughly doubles in length when escaped, and the cap must apply to that
      // final escaped string, not let escaping blow past it afterward.
      const denseRaw = '"\\'.repeat(150);
      const suffix = diagnosticFailoverDetailSuffix({
        name: "FailoverError",
        reason: "schema",
        rawError: denseRaw,
      });
      const rawErrorValue = /rawError="(.*)"$/.exec(suffix)?.[1] ?? "";
      expect(rawErrorValue.length).toBeLessThanOrEqual(201);
    });

    it("strips control characters (ESC, bell, C1, line/paragraph separators) instead of leaving them in the log", () => {
      const esc = String.fromCharCode(27);
      const bell = String.fromCharCode(7);
      const c1 = String.fromCharCode(0x9d);
      const lineSeparator = String.fromCharCode(8232);
      const paragraphSeparator = String.fromCharCode(8233);
      const controlHeavyRaw =
        "bad" +
        esc +
        "value" +
        lineSeparator +
        "with" +
        paragraphSeparator +
        "control" +
        bell +
        c1 +
        "chars";
      const suffix = diagnosticFailoverDetailSuffix({
        name: "FailoverError",
        reason: "schema",
        rawError: controlHeavyRaw,
      });
      expect(suffix).not.toContain(esc);
      expect(suffix).not.toContain(bell);
      expect(suffix).not.toContain(c1);
      expect(suffix).not.toContain(lineSeparator);
      expect(suffix).not.toContain(paragraphSeparator);
      expect(suffix).toContain("rawError=");
    });

    it("never truncates mid-escape-pair, leaving a dangling backslash before the closing quote", () => {
      // 199 plain chars, then a quote (which escapes to a 2-char "\"" pair
      // starting right at the 200-char cap) plus trailing text so the value
      // is long enough to require truncation. A naive slice(0, 200) would cut
      // between the pair's backslash and its quote, corrupting the log line.
      const raw = `${"x".repeat(199)}"${"y".repeat(50)}`;
      const suffix = diagnosticFailoverDetailSuffix({
        name: "FailoverError",
        reason: "schema",
        rawError: raw,
      });
      const rawErrorValue = /rawError="(.*)"$/.exec(suffix)?.[1] ?? "";
      // A well-formed value never ends in an odd (unpaired) run of backslashes.
      const trailingBackslashes = /\\*$/.exec(rawErrorValue.replace(/…$/, ""))?.[0].length ?? 0;
      expect(trailingBackslashes % 2).toBe(0);
    });

    it("omits a field entirely when its value is nothing but stripped control characters", () => {
      // rawError of only control chars is truthy pre-sanitize but sanitizes to
      // "", which must omit the field rather than emit a spurious rawError="".
      const c1 = String.fromCharCode(0x9d);
      const suffix = diagnosticFailoverDetailSuffix({
        name: "FailoverError",
        reason: "schema",
        rawError: c1,
      });
      expect(suffix).toBe(' reason="schema"');
      expect(suffix).not.toContain("rawError=");
    });

    it("does not invoke throwing getters while reading failover detail properties", () => {
      const errorLike = { name: "FailoverError", reason: "schema" };
      Object.defineProperty(errorLike, "rawError", {
        get() {
          throw new Error("should not read getter");
        },
      });
      expect(diagnosticFailoverDetailSuffix(errorLike)).toBe(' reason="schema"');
    });
  });
});
