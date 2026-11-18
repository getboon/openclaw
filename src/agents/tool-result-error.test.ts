// Covers the tool-result-error classifier, including the truthy `details.error`
// path a bestEffort message send relies on to become a real tool failure
// instead of silently reading as success.
import { describe, expect, it } from "vitest";
import {
  isToolResultError,
  readToolResultStatus,
  resolveToolExecutionErrorKind,
  resolveToolResultFailureKind,
} from "./tool-result-error.js";

describe("isToolResultError", () => {
  it("treats a truthy details.error as a failed tool result", () => {
    expect(isToolResultError({ details: { error: "transport unavailable" } })).toBe(true);
  });

  it("treats a MessageSendResult with deliveryStatus:'failed' and error as failed", () => {
    // Mirrors the exact shape sendMessage() now returns for a bestEffort send
    // whose delivery genuinely failed (src/infra/outbound/message.ts).
    const messageSendResult = {
      channel: "anychat-boon-web",
      to: "thread-668",
      via: "direct" as const,
      mediaUrl: null,
      deliveryStatus: "failed" as const,
      error: "Unknown target",
    };
    expect(isToolResultError({ details: messageSendResult })).toBe(true);
  });

  it("treats a successful send with no error field as not failed", () => {
    const messageSendResult = {
      channel: "anychat-boon-web",
      to: "thread-668",
      via: "direct" as const,
      mediaUrl: null,
    };
    expect(isToolResultError({ details: messageSendResult })).toBe(false);
  });

  it("treats an explicit ok:false as failed even without a status field", () => {
    expect(isToolResultError({ details: { ok: false } })).toBe(true);
  });

  it("does not read a status field that is absent", () => {
    expect(readToolResultStatus({ details: {} })).toBeUndefined();
  });
});

describe("resolveToolExecutionErrorKind", () => {
  it("recognizes structured timeout identities", () => {
    expect(
      resolveToolExecutionErrorKind(
        Object.assign(new Error("deadline elapsed"), { name: "TimeoutError" }),
      ),
    ).toBe("timed_out");
    expect(resolveToolExecutionErrorKind({ code: "ETIMEDOUT" })).toBe("timed_out");
    expect(resolveToolExecutionErrorKind({ reason: "timeout" })).toBe("timed_out");
  });

  it("does not infer timeout from validation text", () => {
    expect(resolveToolExecutionErrorKind(new Error("timeoutMs must be a positive number"))).toBe(
      "failed",
    );
  });

  it("contains hostile error fields", () => {
    const hostile = Object.defineProperty({}, "name", {
      get() {
        throw new Error("name getter escaped");
      },
    });
    expect(resolveToolExecutionErrorKind(hostile)).toBe("failed");
  });
});

describe("resolveToolResultFailureKind", () => {
  it("contains hostile structured result fields", () => {
    const hostileDetails = new Proxy(
      {},
      {
        has() {
          throw new Error("details field check escaped");
        },
        get() {
          throw new Error("details field getter escaped");
        },
      },
    );
    const hostileResult = Object.defineProperty({}, "details", {
      get() {
        throw new Error("details getter escaped");
      },
    });

    expect(resolveToolResultFailureKind({ details: hostileDetails })).toBeUndefined();
    expect(resolveToolResultFailureKind(hostileResult)).toBeUndefined();
  });
});
