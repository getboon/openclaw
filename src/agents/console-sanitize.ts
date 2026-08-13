// Console text sanitizer for short diagnostic strings. It removes control
// characters, flattens whitespace, and caps length before logging/display.
import { sanitizeControlCharsForLogging } from "../infra/control-char-sanitize.js";

/** Sanitize optional text for compact console output. */
export function sanitizeForConsole(text: string | undefined, maxChars = 200): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sanitized = sanitizeControlCharsForLogging(trimmed);
  if (!sanitized) {
    return undefined;
  }
  return sanitized.length > maxChars ? `${sanitized.slice(0, maxChars)}…` : sanitized;
}
