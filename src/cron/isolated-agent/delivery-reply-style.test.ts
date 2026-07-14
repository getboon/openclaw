// ENG-14117: cron completion delivery must be able to post a fresh top-level
// channel message (scheduled report) while conversational replies stay threaded.
import { describe, expect, it } from "vitest";
import type { CronJob } from "../types.js";
import { resolveCronDeliveryThreadSuppressed } from "./delivery-reply-style.js";

function jobWithReplyStyle(replyStyle?: "thread" | "top-level"): CronJob {
  return {
    delivery: {
      mode: "announce",
      channel: "msteams",
      to: "conversation:19:channel@thread.tacv2",
      ...(replyStyle ? { replyStyle } : {}),
    },
  } as unknown as CronJob;
}

describe("resolveCronDeliveryThreadSuppressed", () => {
  it("suppresses threading when the job asks for a top-level completion post", () => {
    expect(resolveCronDeliveryThreadSuppressed(jobWithReplyStyle("top-level"))).toBe(true);
  });

  it("does not suppress threading when the job forces thread replies", () => {
    expect(resolveCronDeliveryThreadSuppressed(jobWithReplyStyle("thread"))).toBe(false);
  });

  it("leaves threading to the channel default when replyStyle is unset", () => {
    expect(resolveCronDeliveryThreadSuppressed(jobWithReplyStyle())).toBe(false);
  });
});
