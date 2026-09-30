import { c as CommandTurnContext } from "./templating-Ce4r6y4Y.js";
import { v as resolveChunkMode } from "./outbound.types-D2X8O80C.js";
import { Gr as DispatchReplyWithDispatcher, Hr as finalizeInboundContext, Wr as DispatchReplyWithBufferedBlockDispatcher } from "./types-EobE1w4i.js";
import { r as ReplyPayload } from "./reply-payload-BLeaC3Wn.js";
import { n as generateConversationLabel } from "./conversation-label-generator-BsjDR8M9.js";

//#region src/plugin-sdk/reply-dispatch-runtime.d.ts
/** Dispatches a reply with buffered block support after lazy-loading the runtime dispatcher. */
declare const dispatchReplyWithBufferedBlockDispatcher: DispatchReplyWithBufferedBlockDispatcher;
/** Dispatches a reply through the provider dispatcher after lazy-loading runtime code. */
declare const dispatchReplyWithDispatcher: DispatchReplyWithDispatcher;
//#endregion
export { type CommandTurnContext, type DispatchReplyWithBufferedBlockDispatcher, type DispatchReplyWithDispatcher, type ReplyPayload, dispatchReplyWithBufferedBlockDispatcher, dispatchReplyWithDispatcher, finalizeInboundContext, generateConversationLabel, resolveChunkMode };