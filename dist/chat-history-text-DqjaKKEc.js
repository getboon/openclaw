import { r as sanitizeAssistantVisibleTextWithProfile } from "./assistant-visible-text-BdVjc-xz.js";
import { f as sanitizeUserFacingText } from "./sanitize-user-facing-text-CD2Sz7YJ.js";
import { t as extractAssistantTextForPhase } from "./chat-message-content-DjYNz8gU.js";
//#region src/agents/tools/chat-history-text.ts
/**
* Chat-history text helpers for session tools.
*
* Removes tool messages and tool-plumbing-only assistant stubs, and extracts
* sanitized assistant-visible text from stored messages.
*/
function stripToolMessages(messages) {
	return messages.filter((msg) => {
		if (!msg || typeof msg !== "object") return true;
		const role = msg.role;
		return role !== "toolResult" && role !== "tool";
	});
}
function hasAssistantVisibleContentBlock(content) {
	if (Array.isArray(content)) return content.some((block) => {
		if (!block || typeof block !== "object") return false;
		const type = block.type;
		if (type === "image") return true;
		const text = block.text;
		return (type === "text" || type === "input_text" || type === "output_text") && typeof text === "string" && text.trim().length > 0;
	});
	return typeof content === "string" && content.trim().length > 0;
}
/**
* Drops assistant transcript entries that carry only thinking/tool-call
* plumbing and no visible text or image. In message-tool-only delivery, the
* real inference-turn record has no text block at all — the reply text lives
* solely in a paired `delivery-mirror` entry written back after the send —
* so these stubs add zero conversational value once `stripToolMessages` has
* already dropped tool results, but still eat a caller's requested history
* window ahead of the turns it actually asked for. `delivery-mirror` entries
* are the only record of that text and must never be dropped here.
*/
function dropToolPlumbingOnlyAssistantMessages(messages) {
	return messages.filter((msg) => {
		if (!msg || typeof msg !== "object") return true;
		if (msg.role !== "assistant") return true;
		if (msg.model === "delivery-mirror") return true;
		return hasAssistantVisibleContentBlock(msg.content);
	});
}
/**
* Sanitize text content to strip tool call markers and thinking tags.
* This ensures user-facing text doesn't leak internal tool representations.
*/
function sanitizeTextContent(text) {
	return sanitizeAssistantVisibleTextWithProfile(text, "history");
}
function extractAssistantText(message) {
	if (!message || typeof message !== "object") return;
	if (message.role !== "assistant") return;
	const joined = extractAssistantTextForPhase(message, {
		phase: "final_answer",
		sanitizeText: sanitizeTextContent,
		joinWith: ""
	}) ?? extractAssistantTextForPhase(message, {
		sanitizeText: sanitizeTextContent,
		joinWith: ""
	});
	const errorContext = message.stopReason === "error";
	return joined ? sanitizeUserFacingText(joined, { errorContext }) : void 0;
}
//#endregion
export { stripToolMessages as i, extractAssistantText as n, sanitizeTextContent as r, dropToolPlumbingOnlyAssistantMessages as t };
