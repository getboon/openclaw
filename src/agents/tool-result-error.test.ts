// Covers the tool-result-error classifier, including the truthy `details.error`
// path a bestEffort message send relies on to become a real tool failure
// instead of silently reading as success.
import { describe, expect, it } from "vitest";
import { isToolResultError, readToolResultStatus } from "./tool-result-error.js";

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
