import { a as normalizeLowercaseStringOrEmpty } from "./string-coerce-DW4mBlAt.js";
import { a as shouldLogVerbose, r as logVerbose } from "./globals-C-cvQH14.js";
import { t as isDeliverableMessageChannel } from "./message-channel-normalize-CADqpu1-.js";
import "./message-channel-BmnltGSU.js";
import { n as sanitizeInlineMediaNoteValue } from "./media-note-C5eV4I_f.js";
//#region src/auto-reply/inbound-media-failure-notice.ts
let messageRuntimePromise = null;
function loadMessageRuntime() {
	messageRuntimePromise ??= import("./runtime-CBdidkyn.js");
	return messageRuntimePromise;
}
const NOTICE_REASON_TEXT = {
	too_large: "it's larger than the size limit",
	expired_link: "its download link had expired",
	fetch_failed: "it couldn't be downloaded",
	over_file_limit: "too many files were attached at once",
	unavailable: "file storage was temporarily unavailable",
	timed_out: "the download timed out"
};
const MAX_NAMED_FAILURES = 3;
function formatFailureName(failure, index) {
	const name = sanitizeInlineMediaNoteValue(failure.name);
	return name ? `"${name}"` : `file ${index + 1}`;
}
/** Builds the user-facing sentence for one or more dropped inbound attachments. */
function buildInboundMediaFailureNotice(failures) {
	if (failures.length === 1) {
		const failure = failures[0];
		return `I couldn't read ${formatFailureName(failure, 0)} — ${NOTICE_REASON_TEXT[failure.reason]}. Re-attach it and I'll take another look.`;
	}
	const named = failures.slice(0, MAX_NAMED_FAILURES).map((failure, index) => `${formatFailureName(failure, index)} (${NOTICE_REASON_TEXT[failure.reason]})`);
	const remaining = failures.length - named.length;
	const list = remaining > 0 ? `${named.join(", ")}, and ${remaining} more` : named.join(", ");
	return `I couldn't read ${failures.length} of the files you attached: ${list}. Re-attach them and I'll try again.`;
}
/**
* Sends a best-effort notice back to the originating deliverable chat naming
* dropped attachments. Reads `ctx.MediaFailures` by default; pass `failures`
* explicitly to report only a subset (e.g. a caller that already reported an
* earlier batch and only wants to notify about ones added since).
*/
async function sendInboundMediaFailureNotice(params) {
	const { ctx, cfg } = params;
	const failures = params.failures ?? ctx.MediaFailures;
	if (!failures || failures.length === 0) return;
	if (ctx.InboundEventKind && ctx.InboundEventKind !== "user_request") return;
	const channel = ctx.Provider ?? ctx.Surface ?? "";
	const to = ctx.OriginatingTo ?? ctx.From ?? "";
	if (!channel || !to) {
		if (shouldLogVerbose()) logVerbose("media: attachment-failure notice skipped (no channel/to resolved from ctx)");
		return;
	}
	const normalizedChannel = normalizeLowercaseStringOrEmpty(channel);
	if (!isDeliverableMessageChannel(normalizedChannel)) {
		if (shouldLogVerbose()) logVerbose(`media: attachment-failure notice skipped (channel "${normalizedChannel}" is not deliverable)`);
		return;
	}
	const text = buildInboundMediaFailureNotice(failures);
	try {
		const { sendDurableMessageBatch } = await loadMessageRuntime();
		const send = await sendDurableMessageBatch({
			cfg,
			channel: normalizedChannel,
			to,
			accountId: ctx.AccountId ?? void 0,
			threadId: ctx.MessageThreadId ?? void 0,
			payloads: [{ text }],
			bestEffort: true,
			durability: "best_effort"
		});
		if (send.status === "failed" || send.status === "partial_failed") throw send.error;
		if (send.status === "suppressed") {
			if (shouldLogVerbose()) logVerbose(`media: attachment-failure notice suppressed (${send.reason})`);
			return;
		}
		if (shouldLogVerbose()) logVerbose(`media: attachment-failure notice sent to ${normalizedChannel}/${to}`);
	} catch (err) {
		logVerbose(`media: attachment-failure notice delivery failed: ${String(err)}`);
	}
}
//#endregion
export { sendInboundMediaFailureNotice };
