import type { AssistantMessage } from "../../../llm/types.js";
import type { FailoverReason } from "../../embedded-agent-helpers.js";
import { hasAttemptTerminalState } from "./incomplete-turn.js";

/**
 * Same-model retry for a generation cut off mid-stream.
 *
 * Very long single generations (one huge tool call or reply) are the ones providers drop. A
 * cut-off generation cannot be continued — a half-written tool call is unusable — but the
 * transcript still holds everything completed before it, and none of the cut-off turn's tool
 * calls ran. Without this, the failure goes to model fallback and, when every model fails, the
 * parent re-spawns the sub-agent; each restart re-sends the same oversized call. Retrying once
 * on the same model and asking for the step in smaller pieces breaks that loop. After the one
 * retry the existing failure handling applies, so the user is asked before more work.
 */

export const MAX_STREAM_CUTOFF_RETRIES = 1;

export const STREAM_CUTOFF_RETRY_INSTRUCTION =
  "Your previous step was cut off before it finished, most likely because it was very long. Nothing from that step was applied; everything before it is still in place. Redo that step, but split large output into several smaller tool calls (for example create a file, then add the rest in sections, or build a workbook part by part) so each call finishes quickly. If you were writing a long reply, put the bulk into a file and reply with a short summary.";

// Anthropic/Bedrock streams missing message_stop/messageStop or ending with a content block still
// open, the gateway proxy ending before its terminal event, the LLM gateway's upstream stream
// failure, and a stream that closed in the middle of a tool call.
const CUT_OFF_PATTERN =
  /stream ended before message_?stop|stream ended with an unclosed content block|proxy stream ended before terminal event|upstream error during stream|completed stream with an incomplete tool call/i;

// Failure classes a cut-off retry may cover. A gateway "upstream error during stream" can wrap a
// rate limit, overload, auth, or edge block; those keep their own handling.
const RETRYABLE_REASONS: ReadonlySet<FailoverReason | null> = new Set([
  null,
  "timeout",
  "server_error",
  "empty_response",
  "no_error_details",
  "unclassified",
  "unknown",
]);

export function shouldRetryCutOffGeneration(params: {
  assistant: Pick<AssistantMessage, "stopReason" | "errorMessage"> | undefined;
  attempt: Parameters<typeof hasAttemptTerminalState>[0];
  aborted: boolean;
  timedOut: boolean;
  idleTimedOut: boolean;
  promptError: unknown;
  authFailure: boolean;
  rateLimitFailure: boolean;
  billingFailure: boolean;
  failoverReason: FailoverReason | null;
  priorRetries: number;
}): boolean {
  const { assistant } = params;
  return (
    assistant?.stopReason === "error" &&
    typeof assistant.errorMessage === "string" &&
    CUT_OFF_PATTERN.test(assistant.errorMessage) &&
    params.priorRetries < MAX_STREAM_CUTOFF_RETRIES &&
    !params.aborted &&
    !params.timedOut &&
    !params.idleTimedOut &&
    !params.promptError &&
    !params.authFailure &&
    !params.rateLimitFailure &&
    !params.billingFailure &&
    RETRYABLE_REASONS.has(params.failoverReason) &&
    // Delivery / media / async evidence a fresh attempt would not carry over.
    !hasAttemptTerminalState(params.attempt)
  );
}
