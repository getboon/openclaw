// Slack plugin module implements reply blocks behavior.
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { parseSlackBlocksInput, SLACK_MAX_BLOCKS } from "./blocks-input.js";
import {
  buildSlackInteractiveBlocks,
  buildSlackPresentationBlocks,
  resolveSlackInteractiveBlockOffsets,
  type SlackBlock,
} from "./blocks-render.js";
import { escapeSlackMrkdwn } from "./monitor/mrkdwn.js";
import { truncateSlackText } from "./truncate.js";

// Slack rejects a text object (context element / section) above 3000 chars with
// a 400; boon-core then drops the whole reply. The item cap alone is not enough
// because 12 escaped 120-char tool names across two lists can still exceed it,
// so the assembled block text is truncated to this budget as the final guard.
const SLACK_AUDIT_TRACE_TEXT_MAX = 3000;

function formatAuditTraceList(values: readonly string[]): string {
  if (values.length === 0) {
    return "none";
  }
  const visible = values.slice(0, 12).map(escapeSlackMrkdwn);
  const remainder = values.length - visible.length;
  return remainder > 0 ? `${visible.join(", ")} (+${remainder} more)` : visible.join(", ");
}

function formatAuditTraceReason(reason: NonNullable<ReplyPayload["auditTrace"]>["reason"]): string {
  return reason.replaceAll("_", " ");
}

/**
 * Renders the bounded "How this was verified" audit-trace context block.
 *
 * BOON PORT NOTE: upstream openclaw PR #80 appends this block to a "segments"
 * model where the assistant text renders as its own text segment and the trace
 * renders as a separate blocks segment (two Slack messages). Boon has no
 * segments model: `resolveSlackReplyBlocks` returns a single flat block array
 * delivered alongside `text`, and Slack drops the top-level `text` to fallback
 * whenever `blocks` are present. Appending this block into
 * `resolveSlackReplyBlocks` would therefore SUPPRESS the assistant's answer for
 * the (common) plain-text reply case. To preserve #80's separate-segment
 * semantics, the delivery layer (`deliverReplies`) sends this block as a
 * trailing, standalone context-block message instead — keeping the primary
 * reply's native text rendering untouched. This helper is that block.
 */
export function resolveSlackAuditTraceBlock(payload: ReplyPayload): SlackBlock | undefined {
  const trace = payload.auditTrace;
  if (!trace) {
    return undefined;
  }
  const invoked = trace.toolInvocations.map(
    (invocation) => `${invocation.name} (${invocation.status})`,
  );
  const lines = [
    "*How this was verified*",
    `Tools visible: ${formatAuditTraceList(trace.visibleTools)}`,
    `Tools invoked: ${formatAuditTraceList(invoked)}`,
    `Confidence: ${trace.confidence}`,
    `Outcome: ${trace.disposition} (${formatAuditTraceReason(trace.reason)})`,
  ];
  return {
    type: "context",
    elements: [
      { type: "mrkdwn", text: truncateSlackText(lines.join("\n"), SLACK_AUDIT_TRACE_TEXT_MAX) },
    ],
  } as SlackBlock;
}

export function resolveSlackReplyBlocks(payload: ReplyPayload): SlackBlock[] | undefined {
  const slackData = payload.channelData?.slack;
  let channelBlocks: SlackBlock[] = [];
  if (slackData && typeof slackData === "object" && !Array.isArray(slackData)) {
    channelBlocks =
      (parseSlackBlocksInput((slackData as { blocks?: unknown }).blocks) as SlackBlock[]) ?? [];
  }
  const presentationBlocks = buildSlackPresentationBlocks(
    payload.presentation,
    resolveSlackInteractiveBlockOffsets(channelBlocks),
  );
  const interactiveBlocks = buildSlackInteractiveBlocks(
    payload.interactive,
    resolveSlackInteractiveBlockOffsets([...channelBlocks, ...presentationBlocks]),
  );
  const blocks = [...channelBlocks, ...presentationBlocks, ...interactiveBlocks];
  if (blocks.length > SLACK_MAX_BLOCKS) {
    throw new Error(
      `Slack blocks cannot exceed ${SLACK_MAX_BLOCKS} items after interactive render`,
    );
  }
  return blocks.length > 0 ? blocks : undefined;
}
