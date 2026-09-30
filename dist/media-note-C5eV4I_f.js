import { a as normalizeLowercaseStringOrEmpty } from "./string-coerce-DW4mBlAt.js";
import { s as getMediaDir } from "./store-DfsBxqbu.js";
import path from "node:path";
//#region src/auto-reply/media-note.ts
/** Builds compact prompt notes for inbound media attachments. */
function stripDarwinPrivatePrefix(value) {
	return value.startsWith("/private/var/") ? value.slice(8) : value;
}
function normalizeManagedInboundMediaRef(value) {
	if (!path.isAbsolute(value)) return value;
	const mediaDir = stripDarwinPrivatePrefix(path.resolve(getMediaDir()));
	const candidate = stripDarwinPrivatePrefix(path.resolve(value));
	const inboundDir = path.join(mediaDir, "inbound");
	const relativeToInbound = path.relative(inboundDir, candidate);
	if (!relativeToInbound || relativeToInbound.startsWith("..") || path.isAbsolute(relativeToInbound)) return value;
	return `media://inbound/${path.basename(candidate)}`;
}
/**
* Strips control characters/newlines and closing brackets from a value
* before it's interpolated into prompt or chat text. Exported so
* inbound-media-failure-notice.ts's user-facing copy stays consistent with
* this module's model-facing copy for the same untrusted, user-controlled
* attachment filename.
*/
function sanitizeInlineMediaNoteValue(value) {
	const trimmed = value?.trim();
	if (!trimmed) return "";
	return normalizeManagedInboundMediaRef(trimmed).replace(/[\p{Cc}\]]+/gu, " ").replace(/\s+/g, " ").trim();
}
function formatMediaAttachedLine(params) {
	const prefix = typeof params.index === "number" && typeof params.total === "number" ? `[media attached ${params.index}/${params.total}: ` : "[media attached: ";
	const pathValue = sanitizeInlineMediaNoteValue(params.path);
	const typeRaw = sanitizeInlineMediaNoteValue(params.type);
	const typePart = typeRaw ? ` (${typeRaw})` : "";
	const urlRaw = sanitizeInlineMediaNoteValue(params.url);
	return `${prefix}${pathValue}${typePart}${urlRaw && urlRaw !== pathValue ? ` | ${urlRaw}` : ""}]`;
}
const AUDIO_EXTENSIONS = new Set([
	".ogg",
	".opus",
	".mp3",
	".m4a",
	".wav",
	".webm",
	".flac",
	".aac",
	".wma",
	".aiff",
	".alac",
	".oga"
]);
function isAudioPath(pathLocal) {
	if (!pathLocal) return false;
	const lower = normalizeLowercaseStringOrEmpty(pathLocal);
	for (const ext of AUDIO_EXTENSIONS) if (lower.endsWith(ext)) return true;
	return false;
}
const MEDIA_FAILURE_REASON_TEXT = {
	too_large: "file too large",
	expired_link: "download link expired",
	fetch_failed: "download failed",
	over_file_limit: "too many files attached",
	unavailable: "temporarily unavailable",
	timed_out: "download timed out"
};
function formatMediaFailureLine(failure) {
	return `[attachment not delivered: "${sanitizeInlineMediaNoteValue(failure.name) || "file"}" (${MEDIA_FAILURE_REASON_TEXT[failure.reason]})]`;
}
function isValidAttachmentIndex(index, attachmentCount) {
	return Number.isSafeInteger(index) && index >= 0 && index < attachmentCount;
}
function collectTranscribedAudioAttachmentIndices(ctx, attachmentCount) {
	const transcribedAudioIndices = /* @__PURE__ */ new Set();
	if (Array.isArray(ctx.MediaUnderstanding)) {
		for (const output of ctx.MediaUnderstanding) if (output.kind === "audio.transcription" && isValidAttachmentIndex(output.attachmentIndex, attachmentCount)) transcribedAudioIndices.add(output.attachmentIndex);
	}
	if (Array.isArray(ctx.MediaUnderstandingDecisions)) for (const decision of ctx.MediaUnderstandingDecisions) {
		if (decision.capability !== "audio" || decision.outcome !== "success") continue;
		for (const attachment of decision.attachments) if (attachment.chosen?.outcome === "success" && isValidAttachmentIndex(attachment.attachmentIndex, attachmentCount)) transcribedAudioIndices.add(attachment.attachmentIndex);
	}
	return transcribedAudioIndices;
}
/** Formats a prompt-visible media attachment note, omitting audio already represented by transcript. */
function buildInboundMediaNote(ctx) {
	const pathsFromArray = Array.isArray(ctx.MediaPaths) ? ctx.MediaPaths : void 0;
	const paths = pathsFromArray && pathsFromArray.length > 0 ? pathsFromArray : ctx.MediaPath?.trim() ? [ctx.MediaPath.trim()] : [];
	const failureLines = (ctx.MediaFailures ?? []).map(formatMediaFailureLine);
	if (paths.length === 0) return failureLines.length > 0 ? failureLines.join("\n") : void 0;
	const transcribedAudioIndices = collectTranscribedAudioAttachmentIndices(ctx, paths.length);
	const urls = Array.isArray(ctx.MediaUrls) && ctx.MediaUrls.length === paths.length ? ctx.MediaUrls : void 0;
	const types = Array.isArray(ctx.MediaTypes) && ctx.MediaTypes.length === paths.length ? ctx.MediaTypes : void 0;
	const canStripSingleAttachmentByTranscript = Boolean(ctx.Transcript?.trim()) && paths.length === 1;
	const entries = paths.map((entry, index) => ({
		path: entry ?? "",
		type: types?.[index] ?? ctx.MediaType,
		url: urls?.[index] ?? ctx.MediaUrl,
		index
	})).filter((entry) => {
		const isAudioByMime = types !== void 0 && normalizeLowercaseStringOrEmpty(entry.type).startsWith("audio/");
		if (!(isAudioPath(entry.path) || isAudioByMime)) return true;
		if (transcribedAudioIndices.has(entry.index) || canStripSingleAttachmentByTranscript && entry.index === 0) return false;
		return true;
	});
	if (entries.length === 0) return failureLines.length > 0 ? failureLines.join("\n") : void 0;
	if (entries.length === 1) return [formatMediaAttachedLine({
		path: entries[0]?.path ?? "",
		type: entries[0]?.type,
		url: entries[0]?.url
	}), ...failureLines].join("\n");
	const count = entries.length;
	const lines = [`[media attached: ${count} files]`];
	for (const [idx, entry] of entries.entries()) lines.push(formatMediaAttachedLine({
		path: entry.path,
		index: idx + 1,
		total: count,
		type: entry.type,
		url: entry.url
	}));
	lines.push(...failureLines);
	return lines.join("\n");
}
//#endregion
export { sanitizeInlineMediaNoteValue as n, buildInboundMediaNote as t };
