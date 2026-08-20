// Inbound attachment failure notice delivery. Every channel and core staging
// step that can drop an inbound attachment records the failure on
// ctx.MediaFailures instead of silently dropping the file; this module is
// the single place that turns that fact into a best-effort user-visible
// message, modeled on media-understanding/echo-transcript.ts's delivery shape.
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../config/types.js";
import { logVerbose, shouldLogVerbose } from "../globals.js";
import { isDeliverableMessageChannel } from "../utils/message-channel.js";
import { sanitizeInlineMediaNoteValue } from "./media-note.js";
import type { InboundMediaFailure, InboundMediaFailureReason, MsgContext } from "./templating.js";

let messageRuntimePromise: Promise<typeof import("../channels/message/runtime.js")> | null = null;

function loadMessageRuntime() {
  // The message runtime is heavy and only needed when notice delivery
  // actually proceeds to a deliverable channel.
  messageRuntimePromise ??= import("../channels/message/runtime.js");
  return messageRuntimePromise;
}

// Plain-language phrase per closed failure reason. Keyed as a Record so
// adding a reason to InboundMediaFailureReason is a compile error here until
// this table handles it too — the model-facing twin is
// media-note.ts's MEDIA_FAILURE_REASON_TEXT.
const NOTICE_REASON_TEXT: Record<InboundMediaFailureReason, string> = {
  too_large: "it's larger than the size limit",
  expired_link: "its download link had expired",
  fetch_failed: "it couldn't be downloaded",
  over_file_limit: "too many files were attached at once",
  unavailable: "file storage was temporarily unavailable",
  timed_out: "the download timed out",
};

const MAX_NAMED_FAILURES = 3;

// Sanitize with the same helper as the model-facing twin (media-note.ts) —
// this is untrusted, user-controlled filename text going into a delivered
// chat message, and a name containing control characters or newlines would
// otherwise render uncleanly (or break the message layout).
function formatFailureName(failure: InboundMediaFailure, index: number): string {
  const name = sanitizeInlineMediaNoteValue(failure.name);
  return name ? `"${name}"` : `file ${index + 1}`;
}

/** Builds the user-facing sentence for one or more dropped inbound attachments. */
export function buildInboundMediaFailureNotice(failures: readonly InboundMediaFailure[]): string {
  if (failures.length === 1) {
    const failure = failures[0];
    return `I couldn't read ${formatFailureName(failure, 0)} — ${NOTICE_REASON_TEXT[failure.reason]}. Re-attach it and I'll take another look.`;
  }
  const named = failures
    .slice(0, MAX_NAMED_FAILURES)
    .map(
      (failure, index) =>
        `${formatFailureName(failure, index)} (${NOTICE_REASON_TEXT[failure.reason]})`,
    );
  const remaining = failures.length - named.length;
  const list = remaining > 0 ? `${named.join(", ")}, and ${remaining} more` : named.join(", ");
  return `I couldn't read ${failures.length} of the files you attached: ${list}. Re-attach them and I'll try again.`;
}

/**
 * Sends a best-effort notice back to the originating deliverable chat naming
 * dropped attachments. Reads `ctx.MediaFailures` by default; pass `failures`
 * explicitly to report only a subset (e.g. a caller that already reported an
 * earlier batch and only wants to notify about ones added since).
 */
export async function sendInboundMediaFailureNotice(params: {
  ctx: MsgContext;
  cfg: OpenClawConfig;
  failures?: readonly InboundMediaFailure[];
}): Promise<void> {
  const { ctx, cfg } = params;
  const failures = params.failures ?? ctx.MediaFailures;
  if (!failures || failures.length === 0) {
    return;
  }
  // Skip observed/unmentioned room activity — an unsolicited notice on a
  // turn the user didn't address to the agent would read as a bot butting
  // in, not as help. A direct user request always gets the notice.
  if (ctx.InboundEventKind && ctx.InboundEventKind !== "user_request") {
    return;
  }

  const channel = ctx.Provider ?? ctx.Surface ?? "";
  const to = ctx.OriginatingTo ?? ctx.From ?? "";
  if (!channel || !to) {
    if (shouldLogVerbose()) {
      logVerbose("media: attachment-failure notice skipped (no channel/to resolved from ctx)");
    }
    return;
  }

  const normalizedChannel = normalizeLowercaseStringOrEmpty(channel);
  if (!isDeliverableMessageChannel(normalizedChannel)) {
    if (shouldLogVerbose()) {
      logVerbose(
        `media: attachment-failure notice skipped (channel "${normalizedChannel}" is not deliverable)`,
      );
    }
    return;
  }

  const text = buildInboundMediaFailureNotice(failures);

  try {
    const { sendDurableMessageBatch } = await loadMessageRuntime();
    const send = await sendDurableMessageBatch({
      cfg,
      channel: normalizedChannel,
      to,
      accountId: ctx.AccountId ?? undefined,
      threadId: ctx.MessageThreadId ?? undefined,
      payloads: [{ text }],
      bestEffort: true,
      durability: "best_effort",
    });
    if (send.status === "failed" || send.status === "partial_failed") {
      throw send.error;
    }
    if (send.status === "suppressed") {
      if (shouldLogVerbose()) {
        logVerbose(`media: attachment-failure notice suppressed (${send.reason})`);
      }
      return;
    }
    if (shouldLogVerbose()) {
      logVerbose(`media: attachment-failure notice sent to ${normalizedChannel}/${to}`);
    }
  } catch (err) {
    logVerbose(`media: attachment-failure notice delivery failed: ${String(err)}`);
  }
}
