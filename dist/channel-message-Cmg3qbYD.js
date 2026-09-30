import { t as createChannelReplyPipeline } from "./reply-pipeline-ZxWovYVM.js";
import "./inbound-reply-dispatch-C6-JWvs-.js";
import { t as deliverInboundReplyWithMessageSendContext } from "./channel-outbound-GLSbUyRv.js";
//#region src/plugin-sdk/channel-message.ts
/** @deprecated Use `createChannelMessageReplyPipeline(...)` from `openclaw/plugin-sdk/channel-outbound`. */
function createChannelTurnReplyPipeline(params) {
	return createChannelReplyPipeline(params);
}
/** @deprecated Use `deliverInboundReplyWithMessageSendContext(...)` from `openclaw/plugin-sdk/channel-outbound`. */
const deliverDurableInboundReplyPayload = deliverInboundReplyWithMessageSendContext;
//#endregion
export { deliverDurableInboundReplyPayload as n, createChannelTurnReplyPipeline as t };
