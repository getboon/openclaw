import { a as SourceReplyDeliveryMode, d as ReplyPayload$1, n as GetReplyOptions, t as BlockReplyContext } from "./types-DLZ49gm8.js";
import { c as CommandTurnContext, o as MsgContext, t as FinalizedMsgContext } from "./templating-Ce4r6y4Y.js";
import { i as OpenClawConfig } from "./types.openclaw-B8P7XeUR.js";
import { _ as chunkTextWithMode, f as ChunkMode, g as chunkText, h as chunkMarkdownTextWithMode, m as chunkMarkdownText, v as resolveChunkMode, y as resolveTextChunkLimit } from "./outbound.types-D2X8O80C.js";
import { Cn as ReplyFollowupAdmissionBarrierTimeoutPolicy, Sn as ReplyDispatcher, bn as ReplyDispatchKind } from "./hook-types-DJzI2ddc.js";
import { $r as CommandSessionMetadataChange, As as HEARTBEAT_PROMPT, Gr as DispatchReplyWithDispatcher, Hr as finalizeInboundContext, Jr as createReplyDispatcher, Kr as ReplyDispatcherOptions, Ms as stripHeartbeatToken, Qr as InternalGetReplyOptions, Ur as settleReplyDispatcher, Wr as DispatchReplyWithBufferedBlockDispatcher, Xr as DispatchFromConfigResult, Yr as createReplyDispatcherWithTyping, Zr as InternalGetReplyFromConfig, js as resolveHeartbeatPrompt, ks as DEFAULT_HEARTBEAT_ACK_MAX_CHARS, qr as ReplyDispatcherWithTypingOptions } from "./types-EobE1w4i.js";
import { r as ReplyPayload } from "./reply-payload-BLeaC3Wn.js";
import { i as isSilentReplyText, n as SILENT_REPLY_TOKEN, t as HEARTBEAT_TOKEN } from "./tokens-CLx0Aap_.js";
import { n as createInboundDebouncer, r as resolveInboundDebounceMs } from "./inbound-debounce-B288Kufa.js";
import { n as isAbortRequestText, t as isBtwRequestText } from "./btw-command-1azZL86a.js";
import { n as normalizeGroupActivation, r as parseActivationCommand } from "./group-activation-CvYoinGh.js";
import { t as resetInboundDedupe } from "./inbound-dedupe-ySEx5MpS.js";
import { n as generateConversationLabel, t as ConversationLabelParams } from "./conversation-label-generator-BsjDR8M9.js";
import { t as createReplyReferencePlanner } from "./reply-reference-M_PIpHDf.js";

//#region src/auto-reply/dispatch.d.ts
type InternalDispatchReplyOptions = Omit<InternalGetReplyOptions, "onBlockReply">;
type ReplyPayloadRunState = {
  runId?: string;
};
type DispatchInboundResult = DispatchFromConfigResult;
/** Dispatches one finalized inbound message through reply resolution and queued delivery. */
declare function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  toolsAllow?: string[];
  replyOptions?: InternalDispatchReplyOptions;
  replyResolver?: InternalGetReplyFromConfig;
  onSessionMetadataChanges?: (changes: CommandSessionMetadataChange[]) => void;
  replyPayloadRunState?: ReplyPayloadRunState;
}): Promise<DispatchInboundResult>;
/** Creates a buffered dispatcher with typing, hooks, and stale foreground delivery suppression. */
declare function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  toolsAllow?: string[];
  replyOptions?: InternalDispatchReplyOptions;
  replyResolver?: InternalGetReplyFromConfig;
  onSessionMetadataChanges?: (changes: CommandSessionMetadataChange[]) => void;
}): Promise<DispatchInboundResult>;
/** Creates a plain dispatcher, installs global send hooks, and dispatches the inbound message. */
declare function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  toolsAllow?: string[];
  replyOptions?: InternalDispatchReplyOptions;
  replyResolver?: InternalGetReplyFromConfig;
}): Promise<DispatchInboundResult>;
//#endregion
//#region src/auto-reply/heartbeat-reply-payload.d.ts
/**
 * Pick the last outbound-capable reply payload for heartbeat delivery.
 *
 * Reasoning payloads are skipped using the shared SDK classifier
 * `isReasoningReplyPayload`, which recognizes the `isReasoning` flag plus the
 * common reasoning/thinking text prefixes (including lowercased and Markdown
 * blockquoted forms). Heartbeat reasoning is delivered separately and only when
 * `includeReasoning` is enabled; without this guard a trailing reasoning
 * payload (which reasoning models can emit after the final answer) would be
 * selected as the user-visible heartbeat reply.
 */
declare function resolveHeartbeatReplyPayload(replyResult: ReplyPayload$1 | ReplyPayload$1[] | undefined): ReplyPayload$1 | undefined;
//#endregion
//#region src/auto-reply/reply/get-reply.d.ts
declare function getReplyFromConfig(ctx: MsgContext, opts?: GetReplyOptions, configOverride?: OpenClawConfig): Promise<ReplyPayload$1 | ReplyPayload$1[] | undefined>;
//#endregion
//#region src/auto-reply/reply/provider-dispatcher.d.ts
/** Dispatch a reply using the buffered block dispatcher path. */
declare const dispatchReplyWithBufferedBlockDispatcher: DispatchReplyWithBufferedBlockDispatcher;
/** Dispatch a reply using the standard dispatcher path. */
declare const dispatchReplyWithDispatcher: DispatchReplyWithDispatcher;
//#endregion
export { type BlockReplyContext, type ChunkMode, type CommandTurnContext, type ConversationLabelParams, DEFAULT_HEARTBEAT_ACK_MAX_CHARS, type FinalizedMsgContext, type GetReplyOptions, HEARTBEAT_PROMPT, HEARTBEAT_TOKEN, type MsgContext, type ReplyDispatchKind, type ReplyDispatcher, type ReplyDispatcherOptions, type ReplyDispatcherWithTypingOptions, type ReplyFollowupAdmissionBarrierTimeoutPolicy, type ReplyPayload, SILENT_REPLY_TOKEN, type SourceReplyDeliveryMode, chunkMarkdownText, chunkMarkdownTextWithMode, chunkText, chunkTextWithMode, createInboundDebouncer, createReplyDispatcher, createReplyDispatcherWithTyping, createReplyReferencePlanner, dispatchInboundMessage, dispatchInboundMessageWithBufferedDispatcher, dispatchInboundMessageWithDispatcher, dispatchReplyWithBufferedBlockDispatcher, dispatchReplyWithDispatcher, finalizeInboundContext, generateConversationLabel, getReplyFromConfig, isAbortRequestText, isBtwRequestText, isSilentReplyText, normalizeGroupActivation, parseActivationCommand, resetInboundDedupe, resolveChunkMode, resolveHeartbeatPrompt, resolveHeartbeatReplyPayload, resolveInboundDebounceMs, resolveTextChunkLimit, settleReplyDispatcher, stripHeartbeatToken };