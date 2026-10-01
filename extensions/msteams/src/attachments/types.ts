// Msteams type declarations define plugin contracts.
import type { InboundMediaFailure } from "../../runtime-api.js";

export type MSTeamsAttachmentLike = {
  contentType?: string | null;
  contentUrl?: string | null;
  name?: string | null;
  thumbnailUrl?: string | null;
  content?: unknown;
};

export type MSTeamsAccessTokenProvider = {
  getAccessToken: (scope: string) => Promise<string>;
};

export type MSTeamsInboundMedia = {
  path: string;
  contentType?: string;
  placeholder: string;
};

/**
 * One inbound attachment download attempted and failed. A direct alias of
 * core's `InboundMediaFailure` (same shape, not a reimplementation) —
 * matches the Slack pattern (extensions/slack/src/monitor/media-types.ts).
 */
export type MSTeamsAttachmentFailure = InboundMediaFailure;

export type MSTeamsHtmlAttachmentSummary = {
  htmlAttachments: number;
  imgTags: number;
  dataImages: number;
  cidImages: number;
  srcHosts: string[];
  attachmentTags: number;
  attachmentIds: string[];
};

export type MSTeamsGraphMediaResult = {
  media: MSTeamsInboundMedia[];
  /** Downloads attempted and failed; see `MSTeamsAttachmentFailure`. */
  failures: MSTeamsAttachmentFailure[];
  hostedCount?: number;
  attachmentCount?: number;
  hostedStatus?: number;
  attachmentStatus?: number;
  messageUrl?: string;
  tokenError?: boolean;
};

/**
 * Narrow logger surface used by `downloadMSTeamsGraphMedia` for diagnostic
 * events. Accepting an optional callback keeps the helper testable without
 * pulling in the full channel logger type, while still allowing the monitor
 * handler to forward its plugin logger.
 */
export type MSTeamsGraphMediaLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
};
