import type { HistoryMediaEntry } from "../../auto-reply/reply/history.types.js";
import type { InboundMediaFailure } from "../../auto-reply/templating.js";
import type { InboundMediaFacts } from "../turn/types.js";
/**
 * Attachment metadata accepted from channel plugins before core normalization.
 */
export type ChannelInboundMediaInput = {
    path?: string | null;
    url?: string | null;
    contentType?: string | null;
    kind?: InboundMediaFacts["kind"] | null;
    transcribed?: boolean | null;
    messageId?: string | null;
};
/**
 * Environment payload fields consumed by prompt/context builders for inbound media attachments.
 */
export type ChannelInboundMediaPayload = {
    MediaPath?: string;
    MediaUrl?: string;
    MediaType?: string;
    MediaPaths?: string[];
    MediaUrls?: string[];
    MediaTypes?: string[];
    MediaTranscribedIndexes?: number[];
    MediaFailures?: InboundMediaFailure[];
};
/**
 * Normalizes plugin-provided attachment facts into the channel turn media shape.
 */
export declare function toInboundMediaFacts(media: readonly ChannelInboundMediaInput[] | null | undefined, defaults?: {
    kind?: InboundMediaFacts["kind"];
    messageId?: string;
    transcribed?: (media: ChannelInboundMediaInput, index: number) => boolean;
}): InboundMediaFacts[];
/**
 * Projects inbound attachment facts into transcript history without transient turn-only flags.
 */
export declare function toHistoryMediaEntries(media: readonly ChannelInboundMediaInput[] | null | undefined, defaults?: {
    kind?: InboundMediaFacts["kind"];
    messageId?: string;
}): HistoryMediaEntry[];
/**
 * Builds prompt environment media fields while keeping single-item legacy fields populated.
 *
 * `failures` is intentionally a separate, unaligned parameter rather than part
 * of `media` — a failed attachment has no path/url/index of its own, and
 * folding it into the aligned arrays would corrupt every index-aligned
 * consumer (MediaTranscribedIndexes, MediaUnderstanding[].attachmentIndex).
 */
export declare function buildChannelInboundMediaPayload(media: readonly InboundMediaFacts[] | null | undefined, failures?: readonly InboundMediaFailure[] | null): ChannelInboundMediaPayload;
