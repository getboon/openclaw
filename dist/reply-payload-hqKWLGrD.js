//#region src/channels/message/message-origin.ts
const CODE_COPY = {
	agent_failed_before_reply: "Something went wrong before I could reply. Please try again in a moment.",
	missing_api_key: "This agent isn't configured with a working API credential yet. An operator needs to set it up.",
	model_login_expired: "The model login for this agent has expired. An operator needs to re-authenticate it.",
	token_allocation_exhausted: "You're out of Boon Agent tokens. [Top up your tokens](https://app.getboon.ai/billing?open=agent) to keep going.",
	model_context_length_exceeded: "That request is too large for the model's context window. Start a fresh session or shorten the input.",
	provider_rate_limit_shared: "The AI service is rate limited right now — I'm retrying automatically. This may take a moment.",
	provider_upstream_5xx: "The AI service returned a temporary error — I'm retrying automatically. This may take a moment.",
	provider_malformed_history: "The session history got into a bad state. Start a fresh session and try again.",
	agent_failed_transient_after_retries: "Something went wrong and automatic retries didn't recover. Please try again in a moment.",
	subagent_still_working: "Still working on this in the background — I'll follow up when it's done.",
	boon_core_unreachable: "I couldn't reach your project data just now. General chat still works — please try that request again in a moment."
};
const CODE_RETRY_AFFORDANCE = {
	agent_failed_before_reply: "user_can_retry",
	missing_api_key: "requires_operator",
	model_login_expired: "requires_operator",
	token_allocation_exhausted: "requires_billing_action",
	model_context_length_exceeded: "user_can_retry",
	provider_rate_limit_shared: "will_auto_retry",
	provider_upstream_5xx: "will_auto_retry",
	provider_malformed_history: "user_can_retry",
	agent_failed_transient_after_retries: "user_can_retry",
	subagent_still_working: "will_auto_retry",
	boon_core_unreachable: "user_can_retry"
};
/** Canonical user-facing sentence for a gateway-failure code. */
function messageOriginCodeCopy(code) {
	return CODE_COPY[code];
}
/** How the user is expected to act on a gateway-failure code. */
function messageOriginCodeRetryAffordance(code) {
	return CODE_RETRY_AFFORDANCE[code];
}
//#endregion
//#region src/auto-reply/reply-payload.ts
/** Metadata for fast-auto progress notices. */
const FAST_MODE_AUTO_PROGRESS_KIND = "fast-mode-auto";
function isFastModeAutoProgressPayload(payload) {
	return payload.channelData?.openclawProgressKind === FAST_MODE_AUTO_PROGRESS_KIND;
}
const REPLY_MEDIA_FAILURE_WARNING = "⚠️ Media failed.";
/** Appends the standard media failure warning without duplicating it. */
function appendReplyMediaFailureWarning(text) {
	if (!text?.trim()) return REPLY_MEDIA_FAILURE_WARNING;
	if (text.includes(REPLY_MEDIA_FAILURE_WARNING)) return text;
	return `${text}\n${REPLY_MEDIA_FAILURE_WARNING}`;
}
function normalizeTtsSupplementSpokenText(value) {
	return typeof value === "string" && value.trim() ? value : void 0;
}
function hasReplyPayloadMedia(payload) {
	return Boolean(payload.mediaUrl?.trim() || payload.mediaUrls?.some((url) => url.trim()));
}
/** Returns normalized TTS supplement metadata only when the payload has media to carry it. */
function getReplyPayloadTtsSupplement(payload) {
	const spokenText = normalizeTtsSupplementSpokenText(payload.ttsSupplement?.spokenText);
	if (!spokenText || !hasReplyPayloadMedia(payload)) return;
	return {
		spokenText,
		...payload.ttsSupplement?.visibleTextAlreadyDelivered === true ? { visibleTextAlreadyDelivered: true } : {}
	};
}
/** Returns true when the payload is a valid TTS supplement media payload. */
function isReplyPayloadTtsSupplement(payload) {
	return Boolean(getReplyPayloadTtsSupplement(payload));
}
/** Marks a reply payload as supplemental TTS media while preserving the original shape. */
function markReplyPayloadAsTtsSupplement(payload, spokenText = payload.spokenText ?? payload.text ?? "", options) {
	const normalizedSpokenText = normalizeTtsSupplementSpokenText(spokenText);
	if (!normalizedSpokenText) return payload;
	return {
		...payload,
		spokenText: normalizedSpokenText,
		ttsSupplement: {
			spokenText: normalizedSpokenText,
			...options?.visibleTextAlreadyDelivered === true ? { visibleTextAlreadyDelivered: true } : {}
		}
	};
}
/** Removes visible-only fields from a payload that should be delivered as TTS supplement media. */
function buildTtsSupplementMediaPayload(payload) {
	const supplement = getReplyPayloadTtsSupplement(payload);
	if (!supplement) return payload;
	const { text: _text, presentation: _presentation, interactive: _interactive, btw: _btw, ...mediaPayload } = payload;
	return {
		...mediaPayload,
		spokenText: supplement.spokenText,
		ttsSupplement: supplement
	};
}
const replyPayloadMetadata = /* @__PURE__ */ new WeakMap();
/** Adds internal metadata to a reply payload object. */
function setReplyPayloadMetadata(payload, metadata) {
	const previous = replyPayloadMetadata.get(payload);
	replyPayloadMetadata.set(payload, {
		...previous,
		...metadata
	});
	return payload;
}
/** Reads internal metadata attached to a reply payload object. */
function getReplyPayloadMetadata(payload) {
	return replyPayloadMetadata.get(payload);
}
/** Returns true when a payload is the synthesized warning for a non-terminal tool error. */
function isReplyPayloadNonTerminalToolErrorWarning(payload) {
	return getReplyPayloadMetadata(payload)?.nonTerminalToolErrorWarning === true;
}
/** Reads the per-failure digest attached to a non-terminal tool-error warning payload, if any. */
function getReplyPayloadToolFailureDigest(payload) {
	return getReplyPayloadMetadata(payload)?.toolFailureDigest;
}
/**
* Why a turn stopped, for a terminal run-failure reply: a closed code plus how the user can act.
* Lets a channel render its own stop state without matching the copy text.
*/
function getReplyPayloadGatewayFailure(payload) {
	const code = getReplyPayloadMetadata(payload)?.gatewayFailureCode;
	return code ? {
		code,
		retryAffordance: messageOriginCodeRetryAffordance(code)
	} : void 0;
}
/** Copies internal payload metadata when cloning or transforming payload objects. */
function copyReplyPayloadMetadata(source, payload) {
	const metadata = getReplyPayloadMetadata(source);
	return metadata ? setReplyPayloadMetadata(payload, metadata) : payload;
}
/** Marks a notice payload as deliverable even when normal source replies are suppressed. */
function markReplyPayloadForSourceSuppressionDelivery(payload) {
	return setReplyPayloadMetadata(payload, { deliverDespiteSourceReplySuppression: true });
}
function markCommandReplyForDelivery(reply) {
	if (!reply) return reply;
	if (Array.isArray(reply)) return reply.map((payload) => markReplyPayloadForSourceSuppressionDelivery(payload));
	return markReplyPayloadForSourceSuppressionDelivery(reply);
}
/** Returns true for internal status/notice payloads, not assistant answer content. */
function isReplyPayloadStatusNotice(payload) {
	return Boolean(payload.isCompactionNotice || payload.isStatusNotice);
}
//#endregion
export { messageOriginCodeCopy as _, getReplyPayloadGatewayFailure as a, getReplyPayloadTtsSupplement as c, isReplyPayloadStatusNotice as d, isReplyPayloadTtsSupplement as f, setReplyPayloadMetadata as g, markReplyPayloadForSourceSuppressionDelivery as h, copyReplyPayloadMetadata as i, isFastModeAutoProgressPayload as l, markReplyPayloadAsTtsSupplement as m, appendReplyMediaFailureWarning as n, getReplyPayloadMetadata as o, markCommandReplyForDelivery as p, buildTtsSupplementMediaPayload as r, getReplyPayloadToolFailureDigest as s, FAST_MODE_AUTO_PROGRESS_KIND as t, isReplyPayloadNonTerminalToolErrorWarning as u, messageOriginCodeRetryAffordance as v };
