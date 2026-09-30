import { t as sanitizeControlCharsForLogging } from "./control-char-sanitize-BAIDpw7A.js";
//#region src/agents/console-sanitize.ts
/** Sanitize optional text for compact console output. */
function sanitizeForConsole(text, maxChars = 200) {
	const trimmed = text?.trim();
	if (!trimmed) return;
	const sanitized = sanitizeControlCharsForLogging(trimmed);
	if (!sanitized) return;
	return sanitized.length > maxChars ? `${sanitized.slice(0, maxChars)}…` : sanitized;
}
//#endregion
export { sanitizeForConsole as t };
