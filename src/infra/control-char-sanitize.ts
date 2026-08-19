// Canonical control-char/whitespace sanitizer for text that reaches a
// terminal or a log/line-based parser (console output, structured log
// fields). Kept as one leaf helper so C0/C1 coverage can't drift between
// hand-maintained copies — see agents/console-sanitize.ts and
// infra/diagnostic-error-metadata.ts, both of which import this.
/** Strips C0 (excluding tab/newline/CR) and C1 control code points, then collapses all whitespace to a single space. */
export function sanitizeControlCharsForLogging(text: string): string {
  const withoutControlChars = Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      const isAsciiControl = code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
      const isC1Control = code >= 0x7f && code <= 0x9f;
      return !isAsciiControl && !isC1Control;
    })
    .join("");
  return withoutControlChars.replace(/\s+/g, " ").trim();
}
