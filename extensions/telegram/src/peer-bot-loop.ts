import { recordChannelBotPairLoopAndCheckSuppression } from "openclaw/plugin-sdk/channel-inbound";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { TelegramContext } from "./bot/types.js";

/**
 * Shared tail for both Telegram bot-loop suppression paths (native commands
 * and generic peer-bot turns). Each caller keeps its own pre-guard for which
 * messages count as a peer-bot loop candidate; only the suppression-recording
 * call itself is shared, so the two ingress paths cannot drift on it.
 */
export function recordTelegramBotPairLoopSuppression(params: {
  chatId: number;
  messageThreadId?: number;
  senderId: string;
  receiverId: string;
  accountId: string;
  cfg: OpenClawConfig;
}): boolean {
  return recordChannelBotPairLoopAndCheckSuppression({
    scopeId: params.accountId,
    conversationId: `${params.chatId}:${params.messageThreadId ?? ""}`,
    senderId: params.senderId,
    receiverId: params.receiverId,
    defaultsConfig: params.cfg.channels?.defaults?.botLoopProtection,
    defaultEnabled: true,
  }).suppressed;
}

export function shouldSuppressTelegramPeerBotTurn(params: {
  ctx: TelegramContext;
  cfg: OpenClawConfig;
  accountId: string;
}): boolean {
  const msg = params.ctx.message;
  if (
    msg.from?.is_bot !== true ||
    msg.sender_chat != null ||
    msg.from.id == null ||
    params.ctx.me?.id == null
  ) {
    return false;
  }
  return recordTelegramBotPairLoopSuppression({
    chatId: msg.chat.id,
    messageThreadId: msg.message_thread_id,
    senderId: String(msg.from.id),
    receiverId: String(params.ctx.me.id),
    accountId: params.accountId,
    cfg: params.cfg,
  });
}
