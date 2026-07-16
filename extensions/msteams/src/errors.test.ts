// Msteams tests cover errors plugin behavior.
import { describe, expect, it, vi } from "vitest";
import {
  classifyMSTeamsSendError,
  formatMSTeamsErrorDetail,
  formatMSTeamsSendErrorHint,
  formatUnknownError,
  isRevokedProxyError,
} from "./errors.js";
import { withRevokedProxyFallback } from "./revoked-context.js";

describe("msteams errors", () => {
  it("formats unknown errors", () => {
    expect(formatUnknownError("oops")).toBe("oops");
    expect(formatUnknownError(null)).toBe("null");
  });

  it("classifies auth errors", () => {
    expect(classifyMSTeamsSendError({ statusCode: 401 }).kind).toBe("auth");
    expect(classifyMSTeamsSendError({ statusCode: 403 }).kind).toBe("auth");
  });

  it("classifies ContentStreamNotAllowed as permanent instead of auth", () => {
    const result = classifyMSTeamsSendError({
      statusCode: 403,
      response: {
        body: {
          error: {
            code: "ContentStreamNotAllowed",
          },
        },
      },
    });
    expect(result.kind).toBe("permanent");
    expect(result.statusCode).toBe(403);
    expect(result.errorCode).toBe("ContentStreamNotAllowed");
  });

  it("extracts the error code from an axios-shaped response.data body", () => {
    // Bot Framework / Graph errors surfaced by the Teams SDK are axios errors:
    // the parsed body lives on `response.data`, not `response.body`.
    const result = classifyMSTeamsSendError({
      message: "Request failed with status code 400",
      response: {
        status: 400,
        data: {
          error: {
            code: "BadRequest",
            message: "Attachment type is not supported in this conversation.",
          },
        },
      },
    });
    expect(result.kind).toBe("permanent");
    expect(result.statusCode).toBe(400);
    expect(result.errorCode).toBe("BadRequest");
  });

  it("classifies throttling errors and parses retry-after", () => {
    const result = classifyMSTeamsSendError({ statusCode: 429, retryAfter: "1.5" });
    expect(result.kind).toBe("throttled");
    expect(result.statusCode).toBe(429);
    expect(result.retryAfterMs).toBe(1500);
  });

  it("does not parse partial retry-after values", () => {
    expect(
      classifyMSTeamsSendError({ statusCode: 429, retryAfter: "1.5s" }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        response: { headers: { "retry-after": "2 seconds" } },
      }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        response: { headers: new Headers({ "retry-after": "3 seconds" }) },
      }).retryAfterMs,
    ).toBeUndefined();
  });

  it("ignores unsafe retry-after magnitudes", () => {
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        retryAfterMs: Number.MAX_SAFE_INTEGER + 1,
      }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        retryAfter: Number.MAX_SAFE_INTEGER,
      }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        retryAfter: "9007199254741",
      }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        response: { headers: { "retry-after": "9007199254741" } },
      }).retryAfterMs,
    ).toBeUndefined();
    expect(
      classifyMSTeamsSendError({
        statusCode: 429,
        response: { headers: new Headers({ "retry-after": "9007199254741" }) },
      }).retryAfterMs,
    ).toBeUndefined();
  });

  it("does not parse partial or fractional status codes", () => {
    expect(classifyMSTeamsSendError({ statusCode: "429oops" }).kind).toBe("unknown");
    expect(classifyMSTeamsSendError({ statusCode: 429.5 }).kind).toBe("unknown");
    expect(
      classifyMSTeamsSendError({ response: { status: "503 temporarily unavailable" } }).kind,
    ).toBe("unknown");
  });

  it("classifies transient errors", () => {
    const result = classifyMSTeamsSendError({ statusCode: 503 });
    expect(result.kind).toBe("transient");
    expect(result.statusCode).toBe(503);
  });

  it("classifies permanent 4xx errors", () => {
    const result = classifyMSTeamsSendError({ statusCode: 400 });
    expect(result.kind).toBe("permanent");
    expect(result.statusCode).toBe(400);
  });

  it("provides actionable hints for common cases", () => {
    expect(formatMSTeamsSendErrorHint({ kind: "auth" })).toContain("msteams");
    expect(formatMSTeamsSendErrorHint({ kind: "throttled" })).toContain("throttled");
    expect(
      formatMSTeamsSendErrorHint({
        kind: "permanent",
        errorCode: "ContentStreamNotAllowed",
      }),
    ).toContain("expired the content stream");
  });

  it("classifies transport-level network errors and provides smba egress hint (#77674)", () => {
    const econnrefused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND smba.trafficmanager.net"), {
      code: "ENOTFOUND",
    });
    const etimedout = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });

    const econnrefusedResult = classifyMSTeamsSendError(econnrefused);
    expect(econnrefusedResult.kind).toBe("network");
    expect(econnrefusedResult.errorCode).toBe("ECONNREFUSED");
    const enotfoundResult = classifyMSTeamsSendError(enotfound);
    expect(enotfoundResult.kind).toBe("network");
    expect(enotfoundResult.errorCode).toBe("ENOTFOUND");
    const etimedoutResult = classifyMSTeamsSendError(etimedout);
    expect(etimedoutResult.kind).toBe("network");
    expect(etimedoutResult.errorCode).toBe("ETIMEDOUT");

    // Hints for network errors must mention smba (Connector endpoint) and egress
    expect(formatMSTeamsSendErrorHint({ kind: "network" })).toContain("smba");
    expect(formatMSTeamsSendErrorHint({ kind: "network" })).toContain("egress");
  });

  it("still classifies HTTP errors as unknown when no status code and no network code", () => {
    expect(classifyMSTeamsSendError(new Error("unexpected error")).kind).toBe("unknown");
    expect(classifyMSTeamsSendError(null).kind).toBe("unknown");
  });

  describe("formatMSTeamsErrorDetail", () => {
    it("appends the axios response.data Graph/Connector body to the base message", () => {
      const err = Object.assign(new Error("Request failed with status code 400"), {
        response: {
          status: 400,
          data: {
            error: {
              code: "BadRequest",
              message: "Attachment type is not supported in this conversation.",
            },
          },
        },
      });
      const detail = formatMSTeamsErrorDetail(err);
      // The generic axios message is retained, but the real Graph reason is now visible.
      expect(detail).toContain("Request failed with status code 400");
      expect(detail).toContain("BadRequest");
      expect(detail).toContain("Attachment type is not supported in this conversation.");
    });

    it("falls back to the base message when there is no response body", () => {
      expect(formatMSTeamsErrorDetail(new Error("boom"))).toBe("boom");
      expect(formatMSTeamsErrorDetail("oops")).toBe("oops");
    });

    it("does not duplicate the body when it is already contained in the base message", () => {
      const err = Object.assign(new Error("failed: Attachment type is not supported"), {
        response: { status: 400, data: { error: { message: "Attachment type is not supported" } } },
      });
      const detail = formatMSTeamsErrorDetail(err);
      expect(detail).toBe("failed: Attachment type is not supported");
    });

    it("stringifies a non-standard response.data body", () => {
      const err = Object.assign(new Error("Request failed with status code 400"), {
        response: { status: 400, data: { message: "Invalid request", target: "attachments" } },
      });
      const detail = formatMSTeamsErrorDetail(err);
      expect(detail).toContain("Request failed with status code 400");
      expect(detail).toContain("Invalid request");
    });
  });

  describe("isRevokedProxyError", () => {
    it("returns true for revoked proxy TypeError", () => {
      expect(
        isRevokedProxyError(new TypeError("Cannot perform 'set' on a proxy that has been revoked")),
      ).toBe(true);
      expect(
        isRevokedProxyError(new TypeError("Cannot perform 'get' on a proxy that has been revoked")),
      ).toBe(true);
    });

    it("returns false for non-TypeError errors", () => {
      expect(isRevokedProxyError(new Error("proxy that has been revoked"))).toBe(false);
    });

    it("returns false for unrelated TypeErrors", () => {
      expect(isRevokedProxyError(new TypeError("undefined is not a function"))).toBe(false);
    });

    it("returns false for non-error values", () => {
      expect(isRevokedProxyError(null)).toBe(false);
      expect(isRevokedProxyError("proxy that has been revoked")).toBe(false);
    });
  });

  describe("withRevokedProxyFallback", () => {
    it("returns primary result when no error occurs", async () => {
      await expect(
        withRevokedProxyFallback({
          run: async () => "ok",
          onRevoked: async () => "fallback",
        }),
      ).resolves.toBe("ok");
    });

    it("uses fallback when proxy-revoked TypeError is thrown", async () => {
      const onRevokedLog = vi.fn();
      await expect(
        withRevokedProxyFallback({
          run: async () => {
            throw new TypeError("Cannot perform 'get' on a proxy that has been revoked");
          },
          onRevoked: async () => "fallback",
          onRevokedLog,
        }),
      ).resolves.toBe("fallback");
      expect(onRevokedLog).toHaveBeenCalledOnce();
    });

    it("rethrows non-revoked errors", async () => {
      const err = Object.assign(new Error("boom"), { statusCode: 500 });
      await expect(
        withRevokedProxyFallback({
          run: async () => {
            throw err;
          },
          onRevoked: async () => "fallback",
        }),
      ).rejects.toBe(err);
    });
  });
});
