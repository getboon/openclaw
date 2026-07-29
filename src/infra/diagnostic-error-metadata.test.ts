// Covers diagnostic error metadata extraction.
import { describe, expect, it } from "vitest";
import {
  classify5xxSource,
  diagnosticErrorCategory,
  diagnosticErrorFailureKind,
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
});
