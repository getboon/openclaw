import type { MsgContext } from "./templating.js";
/**
 * Strips control characters/newlines and closing brackets from a value
 * before it's interpolated into prompt or chat text. Exported so
 * inbound-media-failure-notice.ts's user-facing copy stays consistent with
 * this module's model-facing copy for the same untrusted, user-controlled
 * attachment filename.
 */
export declare function sanitizeInlineMediaNoteValue(value: string | undefined): string;
/** Formats a prompt-visible media attachment note, omitting audio already represented by transcript. */
export declare function buildInboundMediaNote(ctx: MsgContext): string | undefined;
