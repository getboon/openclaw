// Inbound attachment-failure notice tests cover destination resolution,
// event-kind gating, empty-input skipping, copy rendering, and failure
// swallowing. Mock shape mirrors media-understanding/echo-transcript.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.js";
import type { InboundMediaFailure, MsgContext } from "./templating.js";

const mockDeliverOutboundPayloads = vi.hoisted(() => vi.fn());

vi.mock("../channels/message/runtime.js", () => ({
  sendDurableMessageBatch: (...args: unknown[]) => mockDeliverOutboundPayloads(...args),
}));

vi.mock("../utils/message-channel.js", () => ({
  isDeliverableMessageChannel: (channel: string) => channel === "slack" || channel === "telegram",
}));

import {
  buildInboundMediaFailureNotice,
  sendInboundMediaFailureNotice,
} from "./inbound-media-failure-notice.js";

const EMPTY_CONFIG = {} as OpenClawConfig;

function createCtx(overrides?: Partial<MsgContext>): MsgContext {
  return {
    Provider: "slack",
    From: "U123",
    AccountId: "acc1",
    InboundEventKind: "user_request",
    MediaFailures: [{ name: "spec.pdf", reason: "expired_link" }],
    ...overrides,
  };
}

describe("buildInboundMediaFailureNotice", () => {
  it("renders a single-failure sentence", () => {
    const failures: InboundMediaFailure[] = [{ name: "spec.pdf", reason: "expired_link" }];
    expect(buildInboundMediaFailureNotice(failures)).toBe(
      "I couldn't read \"spec.pdf\" — its download link had expired. Re-attach it and I'll take another look.",
    );
  });

  it("falls back to a positional name when the failure has none", () => {
    const failures: InboundMediaFailure[] = [{ reason: "too_large" }];
    expect(buildInboundMediaFailureNotice(failures)).toBe(
      "I couldn't read file 1 — it's larger than the size limit. Re-attach it and I'll take another look.",
    );
  });

  it("renders a multi-failure sentence naming each file", () => {
    const failures: InboundMediaFailure[] = [
      { name: "a.pdf", reason: "expired_link" },
      { name: "b.png", reason: "too_large" },
    ];
    expect(buildInboundMediaFailureNotice(failures)).toBe(
      'I couldn\'t read 2 of the files you attached: "a.pdf" (its download link had expired), "b.png" (it\'s larger than the size limit). Re-attach them and I\'ll try again.',
    );
  });

  it("truncates beyond 3 named failures with a remainder count", () => {
    const failures: InboundMediaFailure[] = [
      { name: "a.pdf", reason: "fetch_failed" },
      { name: "b.pdf", reason: "fetch_failed" },
      { name: "c.pdf", reason: "fetch_failed" },
      { name: "d.pdf", reason: "fetch_failed" },
      { name: "e.pdf", reason: "fetch_failed" },
    ];
    const notice = buildInboundMediaFailureNotice(failures);
    expect(notice).toContain("I couldn't read 5 of the files you attached:");
    expect(notice).toContain('"a.pdf"');
    expect(notice).toContain('"c.pdf"');
    expect(notice).not.toContain('"d.pdf"');
    expect(notice).toContain("and 2 more");
  });
});

describe("sendInboundMediaFailureNotice", () => {
  beforeEach(() => {
    mockDeliverOutboundPayloads.mockReset();
    mockDeliverOutboundPayloads.mockResolvedValue({
      status: "sent",
      results: [{ channel: "slack", messageId: "notice-1" }],
      receipt: { platformMessageIds: ["notice-1"], parts: [], sentAt: 1 },
    });
  });

  it("sends the failure notice to the resolved origin", async () => {
    await sendInboundMediaFailureNotice({ ctx: createCtx(), cfg: EMPTY_CONFIG });

    expect(mockDeliverOutboundPayloads).toHaveBeenCalledOnce();
    expect(mockDeliverOutboundPayloads).toHaveBeenCalledWith({
      cfg: EMPTY_CONFIG,
      channel: "slack",
      to: "U123",
      accountId: "acc1",
      threadId: undefined,
      payloads: [
        {
          text: "I couldn't read \"spec.pdf\" — its download link had expired. Re-attach it and I'll take another look.",
        },
      ],
      bestEffort: true,
      durability: "best_effort",
    });
  });

  it("does nothing when there are no failures", async () => {
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ MediaFailures: [] }),
      cfg: EMPTY_CONFIG,
    });
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ MediaFailures: undefined }),
      cfg: EMPTY_CONFIG,
    });

    expect(mockDeliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("skips an observed/unmentioned room_event turn — an unsolicited notice would read as the bot butting in", async () => {
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ InboundEventKind: "room_event" }),
      cfg: EMPTY_CONFIG,
    });

    expect(mockDeliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("skips non-deliverable channels", async () => {
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ Provider: "internal-system", From: "some-source" }),
      cfg: EMPTY_CONFIG,
    });

    expect(mockDeliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("skips when ctx has no resolved destination", async () => {
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ From: undefined, OriginatingTo: undefined }),
      cfg: EMPTY_CONFIG,
    });

    expect(mockDeliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("forwards thread metadata to outbound delivery", async () => {
    await sendInboundMediaFailureNotice({
      ctx: createCtx({ MessageThreadId: "77" }),
      cfg: EMPTY_CONFIG,
    });

    expect(mockDeliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "77" }),
    );
  });

  it("swallows delivery failures — the notice is best-effort and must never break the turn", async () => {
    mockDeliverOutboundPayloads.mockRejectedValueOnce(new Error("delivery timeout"));

    await expect(
      sendInboundMediaFailureNotice({ ctx: createCtx(), cfg: EMPTY_CONFIG }),
    ).resolves.toBeUndefined();
  });

  it("survives a turn that would otherwise end with no visible reply (NO_REPLY) — the notice is independent of the agent's own reply", async () => {
    // The notice fires from get-reply.ts before the agent attempt even
    // starts, so a NO_REPLY/silent final on the agent's side cannot suppress
    // it.
    await sendInboundMediaFailureNotice({ ctx: createCtx(), cfg: EMPTY_CONFIG });

    expect(mockDeliverOutboundPayloads).toHaveBeenCalledOnce();
  });
});
