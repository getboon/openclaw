import { describe, expect, it, vi } from "vitest";

const { recordChannelBotPairLoopAndCheckSuppression } = vi.hoisted(() => ({
  recordChannelBotPairLoopAndCheckSuppression: vi.fn(() => ({ suppressed: false })),
}));

vi.mock("openclaw/plugin-sdk/channel-inbound", () => ({
  recordChannelBotPairLoopAndCheckSuppression,
}));

import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { TelegramContext } from "./bot/types.js";
import {
  recordTelegramBotPairLoopSuppression,
  shouldSuppressTelegramPeerBotTurn,
} from "./peer-bot-loop.js";

const cfg = {} as OpenClawConfig;

describe("recordTelegramBotPairLoopSuppression", () => {
  it("derives conversationId from chatId and messageThreadId and forwards ids as strings", () => {
    recordChannelBotPairLoopAndCheckSuppression.mockClear();

    recordTelegramBotPairLoopSuppression({
      chatId: -100123,
      messageThreadId: 7,
      senderId: "111",
      receiverId: "222",
      accountId: "acct-1",
      cfg,
    });

    expect(recordChannelBotPairLoopAndCheckSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: "acct-1",
        conversationId: "-100123:7",
        senderId: "111",
        receiverId: "222",
        defaultEnabled: true,
      }),
    );
  });

  it("falls back to an empty thread segment when messageThreadId is absent", () => {
    recordChannelBotPairLoopAndCheckSuppression.mockClear();

    recordTelegramBotPairLoopSuppression({
      chatId: 42,
      senderId: "1",
      receiverId: "2",
      accountId: "acct-1",
      cfg,
    });

    expect(recordChannelBotPairLoopAndCheckSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "42:" }),
    );
  });
});

describe("shouldSuppressTelegramPeerBotTurn", () => {
  it("skips the suppression check when the message is not from a bot", () => {
    recordChannelBotPairLoopAndCheckSuppression.mockClear();
    const ctx = {
      me: { id: 1 },
      message: { chat: { id: 5 }, from: { id: 2, is_bot: false } },
    } as unknown as TelegramContext;

    const result = shouldSuppressTelegramPeerBotTurn({ ctx, cfg, accountId: "acct-1" });

    expect(result).toBe(false);
    expect(recordChannelBotPairLoopAndCheckSuppression).not.toHaveBeenCalled();
  });

  it("delegates to the shared suppression recorder for a peer-bot message", () => {
    recordChannelBotPairLoopAndCheckSuppression.mockClear();
    const ctx = {
      me: { id: 1 },
      message: { chat: { id: 5 }, from: { id: 2, is_bot: true }, message_thread_id: 9 },
    } as unknown as TelegramContext;

    shouldSuppressTelegramPeerBotTurn({ ctx, cfg, accountId: "acct-1" });

    expect(recordChannelBotPairLoopAndCheckSuppression).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: "acct-1",
        conversationId: "5:9",
        senderId: "2",
        receiverId: "1",
      }),
    );
  });
});
