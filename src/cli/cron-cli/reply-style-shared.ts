// Cron CLI parsing helper for the --reply-style delivery flag (ENG-14117).
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import type { CronReplyStyle } from "../../cron/types.js";

/**
 * Parses `--reply-style` into a CronReplyStyle. "top-level" makes a scheduled
 * completion post a fresh channel-root message; "thread" forces threading.
 * Unset returns undefined so the channel/global default is preserved.
 */
export function parseCronReplyStyleOption(value: unknown): CronReplyStyle | undefined {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    return undefined;
  }
  const lower = normalizeLowercaseStringOrEmpty(raw);
  if (lower === "thread" || lower === "top-level") {
    return lower;
  }
  throw new Error('--reply-style must be "thread" or "top-level"');
}
