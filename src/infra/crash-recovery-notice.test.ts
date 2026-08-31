import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const sendDurableMessageBatch = vi.fn();
vi.mock("../channels/message/runtime.js", () => ({
  sendDurableMessageBatch: (...args: unknown[]) => sendDurableMessageBatch(...args),
}));

const { sendCrashRecoveryNotice } = await import("./crash-recovery-notice.js");

describe("sendCrashRecoveryNotice", () => {
  const cfg = {} as OpenClawConfig;

  it("returns false without attempting delivery when channel or to is missing", async () => {
    const sent = await sendCrashRecoveryNotice({
      cfg,
      text: "hello",
      target: { channel: "telegram" },
    });
    expect(sent).toBe(false);
    expect(sendDurableMessageBatch).not.toHaveBeenCalled();
  });

  it("sends through sendDurableMessageBatch and returns true on success", async () => {
    sendDurableMessageBatch.mockResolvedValueOnce({ status: "sent" });
    const sent = await sendCrashRecoveryNotice({
      cfg,
      text: "hello",
      target: { channel: "telegram", to: "123", sessionKey: "sess-1" },
    });
    expect(sent).toBe(true);
    expect(sendDurableMessageBatch).toHaveBeenCalledOnce();
    const call = sendDurableMessageBatch.mock.calls[0]?.[0];
    expect(call.channel).toBe("telegram");
    expect(call.to).toBe("123");
    expect(call.payloads).toEqual([{ text: "hello" }]);
  });

  it("returns false when the send fails or partially fails", async () => {
    sendDurableMessageBatch.mockResolvedValueOnce({ status: "failed", error: new Error("boom") });
    const sent = await sendCrashRecoveryNotice({
      cfg,
      text: "hello",
      target: { channel: "telegram", to: "123" },
    });
    expect(sent).toBe(false);
  });

  it("returns false without throwing when sendDurableMessageBatch itself throws", async () => {
    sendDurableMessageBatch.mockRejectedValueOnce(new Error("network down"));
    const sent = await sendCrashRecoveryNotice({
      cfg,
      text: "hello",
      target: { channel: "telegram", to: "123" },
    });
    expect(sent).toBe(false);
  });
});
