// Msteams plugin module implements payload behavior.
import { buildMediaPayload, type InboundMediaFailure } from "../../runtime-api.js";
import type { MSTeamsAttachmentFailure } from "./types.js";

export function buildMSTeamsMediaPayload(
  mediaList: Array<{ path: string; contentType?: string }>,
  failures?: MSTeamsAttachmentFailure[],
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
  MediaFailures?: InboundMediaFailure[];
} {
  return {
    ...buildMediaPayload(mediaList, { preserveMediaTypeCardinality: true }),
    // `MSTeamsAttachmentFailure` shares its shape with core's
    // `InboundMediaFailure` (see types.ts) — no conversion needed here.
    MediaFailures: failures && failures.length > 0 ? failures : undefined,
  };
}
