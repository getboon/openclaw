// Slack plugin module implements media types behavior.
import type { InboundMediaFailureReason } from "openclaw/plugin-sdk/channel-inbound";

export type SlackMediaResult = {
  path: string;
  contentType?: string;
  placeholder: string;
};

/**
 * One Slack file/attachment that failed to download. Reuses core's closed
 * InboundMediaFailureReason (rather than a Slack-local union) so there is one
 * failure vocabulary end to end, not two that can drift (ENG-18116).
 */
export type SlackMediaFailure = {
  name?: string;
  contentType?: string;
  reason: InboundMediaFailureReason;
};

/** Result of resolving a batch of Slack media: never a bare `null` on failure. */
export type SlackMediaOutcome = {
  media: SlackMediaResult[];
  failures: SlackMediaFailure[];
};

export const MAX_SLACK_MEDIA_FILES = 8;
