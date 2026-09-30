//#region src/infra/control-char-sanitize.ts
/** Strips C0 (excluding tab/newline/CR) and C1 control code points, then collapses all whitespace to a single space. */
function sanitizeControlCharsForLogging(text) {
	return Array.from(text).filter((char) => {
		const code = char.charCodeAt(0);
		return !(code <= 31 && code !== 9 && code !== 10 && code !== 13) && !(code >= 127 && code <= 159);
	}).join("").replace(/\s+/g, " ").trim();
}
//#endregion
export { sanitizeControlCharsForLogging as t };
