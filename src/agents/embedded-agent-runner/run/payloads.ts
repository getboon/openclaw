/**
 * Builds embedded-agent payload objects from attempt inputs and outcomes.
 */
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import type { SourceReplyDeliveryMode } from "../../../auto-reply/get-reply-options.types.js";
import {
  createHeartbeatToolResponsePayload,
  type HeartbeatToolResponse,
} from "../../../auto-reply/heartbeat-tool-response.js";
import {
  markReplyPayloadForSourceSuppressionDelivery,
  setReplyPayloadMetadata,
  type ReplyPayload,
  type ReplyPayloadMetadata,
} from "../../../auto-reply/reply-payload.js";
import { parseReplyDirectives } from "../../../auto-reply/reply/reply-directives.js";
import type { ReasoningLevel, ThinkLevel, VerboseLevel } from "../../../auto-reply/thinking.js";
import { isSilentReplyPayloadText, SILENT_REPLY_TOKEN } from "../../../auto-reply/tokens.js";
import { formatToolAggregate } from "../../../auto-reply/tool-meta.js";
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { hasReplyPayloadContent } from "../../../interactive/payload.js";
import type { AssistantMessage } from "../../../llm/types.js";
import { isCronSessionKey } from "../../../routing/session-key.js";
import { extractAssistantTextForPhase } from "../../../shared/chat-message-content.js";
import { parseInlineDirectives } from "../../../utils/directive-tags.js";
import {
  BILLING_ERROR_USER_MESSAGE,
  buildTokenExhaustedPresentation,
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
  formatUserFacingAssistantErrorText,
  getApiErrorPayloadFingerprint,
  isRawApiErrorPayload,
  normalizeTextForComparison,
} from "../../embedded-agent-helpers.js";
import type { MessagingToolSourceReplyPayload } from "../../embedded-agent-messaging.types.js";
import type { ToolResultFormat } from "../../embedded-agent-subscribe.shared-types.js";
import {
  extractAssistantThinking,
  extractAssistantVisibleText,
} from "../../embedded-agent-utils.js";
import {
  isExecLikeToolName,
  shouldSurfaceToolFailure,
  type ToolErrorSummary,
} from "../../tool-error-summary.js";
import {
  buildToolFailureDigest,
  type ToolFailureDigest,
  type ToolFailureDigestEntry,
} from "../../tool-failure-digest.js";

type ToolMetaEntry = { toolName: string; meta?: string; errored?: boolean };
type ToolErrorWarningPolicy = {
  showWarning: boolean;
  includeDetails: boolean;
};

const MUTATING_FAILURE_ACTION_PATTERN =
  "(?:write|edit|update|save|create|delete|remove|modify|change|apply|patch|move|rename|send|reply|message|run|execute|execution|command|script|shell|bash|exec|tool|action|operation)";

const MUTATING_FAILURE_INABILITY_PATTERN = new RegExp(
  `\\b(?:couldn't|could not|can't|cannot|unable to|am unable to|wasn't able to|was not able to|were unable to)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`,
  "u",
);
const MUTATING_FAILURE_ACTION_THEN_FAILURE_PATTERN = new RegExp(
  `\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b.{0,100}\\b(?:failed|failure|errored)\\b`,
  "u",
);
const MUTATING_FAILURE_FAILURE_THEN_ACTION_PATTERN = new RegExp(
  `\\b(?:failed|failure)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`,
  "u",
);
const MUTATING_FAILURE_ERROR_WHILE_ACTION_PATTERN = new RegExp(
  `\\b(?:hit|encountered|ran into)\\b.{0,60}\\berror\\b.{0,100}\\b(?:while|trying to|when)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`,
  "u",
);
const DID_NOT_FAIL_PATTERN = /\b(?:did not|didn't)\s+fail\b/u;
const NEGATED_FAILURE_PATTERN = /\b(?:no|not|without)\s+(?:failures?|errors?)\b/u;

function hasExplicitMutatingToolFailureAcknowledgement(text: string): boolean {
  const normalizedText = normalizeTextForComparison(text);
  if (!normalizedText) {
    return false;
  }
  if (DID_NOT_FAIL_PATTERN.test(normalizedText)) {
    return false;
  }
  if (MUTATING_FAILURE_INABILITY_PATTERN.test(normalizedText)) {
    return true;
  }
  if (NEGATED_FAILURE_PATTERN.test(normalizedText)) {
    return false;
  }
  return (
    MUTATING_FAILURE_ACTION_THEN_FAILURE_PATTERN.test(normalizedText) ||
    MUTATING_FAILURE_FAILURE_THEN_ACTION_PATTERN.test(normalizedText) ||
    MUTATING_FAILURE_ERROR_WHILE_ACTION_PATTERN.test(normalizedText)
  );
}

function isVerboseToolDetailEnabled(level?: VerboseLevel): boolean {
  return level === "full";
}

function resolveRawAssistantAnswerText(lastAssistant: AssistantMessage | undefined): string {
  if (!lastAssistant) {
    return "";
  }
  return (
    normalizeOptionalString(
      extractAssistantTextForPhase(lastAssistant, { phase: "final_answer" }) ??
        extractAssistantTextForPhase(lastAssistant),
    ) ?? ""
  );
}

function normalizeReplyTextForComparison(text: string): string {
  return normalizeTextForComparison(parseReplyDirectives(text).text ?? "");
}

function shouldIncludeToolErrorDetails(params: {
  lastToolError: ToolErrorSummary;
  isCronTrigger?: boolean;
  isHeartbeatTrigger?: boolean;
  sessionKey: string;
  verboseLevel?: VerboseLevel;
}): boolean {
  if (isVerboseToolDetailEnabled(params.verboseLevel)) {
    return true;
  }
  if (!isExecLikeToolName(params.lastToolError.toolName)) {
    return false;
  }
  // Heartbeat runs usually have no assistant reply to carry the command
  // output, so keep exec details in the warning instead of a generic label.
  if (params.isHeartbeatTrigger === true) {
    return true;
  }
  return (
    params.lastToolError.timedOut === true &&
    (params.isCronTrigger === true || isCronSessionKey(params.sessionKey))
  );
}

// Command-execution tools whose errors are recoverable sub-steps, not mutating
// deliverables. A non-zero exec/bash/process exit that the agent recovered from —
// the turn still produced a real reply — is non-terminal: the deliverable is the
// answer, not the command call. Write/edit/message stay strict (a failed write
// with a "done" reply is confabulation, #53), so they are NOT listed here. `tmux`
// is intentionally absent: it is neither in MUTATING_TOOL_NAMES nor exec-like, so
// `resolveToolErrorWarningPolicy` already sets showWarning=false (no badge at all)
// once a reply exists — it never reaches this helper, so listing it was dead.
const RECOVERABLE_EXEC_CLASS_TOOL_NAMES = new Set(["exec", "bash", "process"]);

function isRecoverableExecClassToolName(toolName: string): boolean {
  return RECOVERABLE_EXEC_CLASS_TOOL_NAMES.has(normalizeOptionalLowercaseString(toolName) ?? "");
}

/** Renders one digest entry as `tool — reason` (`tool` alone when unclassified), with a `×N` suffix for repeats. */
function formatToolFailureDigestEntry(entry: ToolFailureDigestEntry): string {
  const reason = entry.reasonText ? ` — ${entry.reasonText}` : "";
  const repeatSuffix = entry.count > 1 ? ` (×${entry.count})` : "";
  return `${entry.toolName}${reason}${repeatSuffix}`;
}

/**
 * Intermediate-status copy for NON-TERMINAL tool failures: recovered
 * command-execution errors on a turn that still produced a real reply. A
 * terminal "⚠️ <tool> failed" banner is the over-eager lie Mona flagged (#53):
 * it reads as a hard failure while work actually continued. Middleware
 * (post-processing) failures never reach this builder — they are suppressed
 * upstream in `resolveToolErrorWarningPolicy` because "output unavailable"
 * is not evidence the step itself failed.
 *
 * Names EVERY unrecovered failed step (ENG-18812 — previously only the most
 * recent failure's identity was tracked, so a turn with two distinct
 * failures could only ever describe one) with its classified reason, plus
 * what it means for the reply already delivered, so a user can tell whether
 * their output is trustworthy instead of only hearing "a step didn't
 * complete, but I kept going."
 */
function buildNonTerminalToolStatusText(params: {
  digest: ToolFailureDigest;
  /** Operator-only raw error text for the representative failure, appended when verbose (includeDetails). */
  detailSuffix?: string;
}): string {
  const { digest } = params;
  // At least one step didn't finish even when toolMetas has no other entries
  // to derive a count from (e.g. legacy callers with an empty toolMetas array).
  const didNotFinishCount = Math.max(1, digest.totalToolCount - digest.completedToolCount);
  const isMultiple = didNotFinishCount > 1;
  const header = isMultiple ? `${didNotFinishCount} steps didn't finish` : "One step didn't finish";
  // The digest can legitimately name fewer failures than `didNotFinishCount`
  // implies — a caller that doesn't track the full-turn `toolFailures` list
  // (the Codex path, or a test that hand-builds a single `lastToolError`)
  // still reports an accurate toolMetas-derived count. Treat that gap the
  // same as the cap-based omission below rather than silently implying the
  // named list is complete (the exact swallow this note exists to fix).
  const namedFailureCount =
    digest.failures.reduce((sum, entry) => sum + entry.count, 0) + digest.omittedCount;
  const unaccountedCount = Math.max(0, didNotFinishCount - namedFailureCount);
  const totalOmitted = digest.omittedCount + unaccountedCount;
  const stepLabel = digest.failures.length > 1 || totalOmitted > 0 ? "Steps" : "Step";
  const steps =
    digest.completedToolCount > 0
      ? ` (${digest.completedToolCount} of ${digest.totalToolCount} steps completed)`
      : "";
  const list = digest.failures.map(formatToolFailureDigestEntry).join("; ");
  const omitted = totalOmitted > 0 ? `; …and ${totalOmitted} more` : "";
  const detail = params.detailSuffix ? `: ${params.detailSuffix}` : "";
  const closing = isMultiple
    ? "The reply above may be missing what those steps produced. Ask me to redo them if something looks off."
    : "The reply above may be missing what that step produced. Ask me to redo that step if something looks off.";
  return `↻ ${header}${steps}.\n${stepLabel}: ${list}${omitted}${detail}\n` + closing;
}

/**
 * Chooses whether a tool failure needs a separate user-visible warning and
 * whether to include raw details. Mutating failures are stricter because a
 * silent failed write/send/delete can make the assistant look successful.
 */
function resolveToolErrorWarningPolicy(params: {
  lastToolError: ToolErrorSummary;
  hasUserFacingReply: boolean;
  hasUserFacingErrorReply: boolean;
  hasUserFacingFailureAcknowledgement: boolean;
  suppressToolErrors: boolean;
  suppressToolErrorWarnings?: boolean | (() => boolean | undefined);
  isCronTrigger?: boolean;
  isHeartbeatTrigger?: boolean;
  sessionKey: string;
  verboseLevel?: VerboseLevel;
}): ToolErrorWarningPolicy {
  let toolErrorWarningOverride: boolean | undefined;
  let dynamicToolErrorWarningsDisabled = false;
  if (typeof params.suppressToolErrorWarnings === "function") {
    toolErrorWarningOverride = params.suppressToolErrorWarnings();
    dynamicToolErrorWarningsDisabled = toolErrorWarningOverride === false;
  } else {
    toolErrorWarningOverride = params.suppressToolErrorWarnings;
  }
  const includeDetails = shouldIncludeToolErrorDetails({
    ...params,
    verboseLevel: dynamicToolErrorWarningsDisabled ? "off" : params.verboseLevel,
  });
  const suppressToolErrorWarnings = toolErrorWarningOverride === true;
  // These two are turn-wide overrides, not per-failure decisions — they must
  // win before any failure-shape check runs, and the digest builder applies
  // them the same way (as a single upfront gate) for the same reason.
  if (suppressToolErrorWarnings || params.suppressToolErrors) {
    return { showWarning: false, includeDetails };
  }
  return {
    showWarning: shouldSurfaceToolFailure(params.lastToolError, {
      hasUserFacingReply: params.hasUserFacingReply,
      hasUserFacingErrorReply: params.hasUserFacingErrorReply,
      hasUserFacingFailureAcknowledgement: params.hasUserFacingFailureAcknowledgement,
      includeDetails,
    }),
    includeDetails,
  };
}

/**
 * Converts a completed embedded attempt into reply payloads for channels. This
 * is the boundary that suppresses duplicate source replies, filters raw API
 * errors, preserves directive metadata, and decides when tool failures must be
 * surfaced to the user.
 */
export function buildEmbeddedRunPayloads(params: {
  assistantTexts: string[];
  assistantMessageIndex?: number;
  toolMetas: ToolMetaEntry[];
  lastAssistant: AssistantMessage | undefined;
  currentAssistant?: AssistantMessage | null;
  lastToolError?: ToolErrorSummary;
  /** Every errored call this turn, independent of lastToolError's single-slot lifecycle (ENG-18812). */
  toolFailures?: Array<ToolErrorSummary & { retried?: boolean }>;
  config?: OpenClawConfig;
  isCronTrigger?: boolean;
  isHeartbeatTrigger?: boolean;
  sessionKey: string;
  provider?: string;
  model?: string;
  /** Credential auth mode for billing copy (#80877). */
  authMode?: string;
  verboseLevel?: VerboseLevel;
  reasoningLevel?: ReasoningLevel;
  thinkingLevel?: ThinkLevel;
  toolResultFormat?: ToolResultFormat;
  suppressToolErrorWarnings?: boolean | (() => boolean | undefined);
  inlineToolResultsAllowed: boolean;
  didSendViaMessagingTool?: boolean;
  didDeliverSourceReplyViaMessageTool?: boolean;
  messagingToolSourceReplyPayloads?: MessagingToolSourceReplyPayload[];
  sourceReplyDeliveryMode?: SourceReplyDeliveryMode;
  agentId?: string;
  runId?: string;
  runAborted?: boolean;
  didSendDeterministicApprovalPrompt?: boolean;
  heartbeatToolResponse?: HeartbeatToolResponse;
}): ReplyPayload[] {
  if (params.heartbeatToolResponse) {
    return [createHeartbeatToolResponsePayload(params.heartbeatToolResponse)];
  }

  const replyItems: Array<{
    text: string;
    media?: string[];
    mediaUrl?: string;
    isError?: boolean;
    isReasoning?: boolean;
    audioAsVoice?: boolean;
    replyToId?: string;
    replyToTag?: boolean;
    replyToCurrent?: boolean;
    presentation?: ReplyPayload["presentation"];
    interactive?: ReplyPayload["interactive"];
    channelData?: Record<string, unknown>;
    nonTerminalToolErrorWarning?: boolean;
    /** Every unrecovered failed step behind a non-terminal note, for channels that render their own copy (ENG-18812). */
    toolFailureDigest?: ToolFailureDigest;
    /**
     * A run-level or tool-failure notice must reach the user even when
     * `message_tool_only` would otherwise suppress plain assistant prose —
     * that suppression exists to avoid double-sending a reply the message
     * tool already delivered, not to hide the one signal a failed delivery
     * has left.
     */
    deliverDespiteSourceSuppression?: boolean;
    sourceReplyMirror?: {
      idempotencyKey?: string;
    };
  }> = [];

  const sourceReplyPayloads =
    params.sourceReplyDeliveryMode === "message_tool_only"
      ? (params.messagingToolSourceReplyPayloads ?? [])
      : [];
  const sourceReplyStartIndex = replyItems.length;
  sourceReplyPayloads.forEach((payload, index) => {
    const text = normalizeOptionalString(payload.text) ?? "";
    const media = Array.from(
      new Set([...(payload.mediaUrl ? [payload.mediaUrl] : []), ...(payload.mediaUrls ?? [])]),
    ).filter((value) => value.trim().length > 0);
    if (
      !text &&
      media.length === 0 &&
      !payload.presentation &&
      !payload.interactive &&
      !payload.channelData
    ) {
      return;
    }
    // Message-tool-only replies were already sent by the tool. Mirror them into
    // the transcript while marking payloads so channel delivery suppresses a duplicate send.
    replyItems.push({
      text,
      ...(payload.mediaUrl ? { mediaUrl: payload.mediaUrl } : {}),
      ...(media.length ? { media } : {}),
      ...(payload.audioAsVoice ? { audioAsVoice: true } : {}),
      ...(payload.presentation ? { presentation: payload.presentation } : {}),
      ...(payload.interactive ? { interactive: payload.interactive } : {}),
      ...(payload.channelData ? { channelData: payload.channelData } : {}),
      sourceReplyMirror: {
        idempotencyKey:
          payload.idempotencyKey ??
          (params.runId ? `${params.runId}:internal-source-reply:${index}` : undefined),
      },
    });
  });
  const hasSourceReplyPayload = replyItems.length > sourceReplyStartIndex;
  const deliveredSourceReplyViaMessageTool =
    params.sourceReplyDeliveryMode === "message_tool_only" &&
    params.didDeliverSourceReplyViaMessageTool === true;

  const useMarkdown = params.toolResultFormat === "markdown";
  const suppressAssistantArtifacts =
    params.didSendDeterministicApprovalPrompt === true ||
    hasSourceReplyPayload ||
    deliveredSourceReplyViaMessageTool;
  const nonEmptyAssistantTexts = params.assistantTexts.filter((text) => text.trim().length > 0);
  const currentAssistant = params.currentAssistant ?? undefined;
  const assistantForPayload =
    currentAssistant ?? (nonEmptyAssistantTexts.length === 1 ? undefined : params.lastAssistant);
  const lastAssistantStopReason = assistantForPayload?.stopReason;
  const lastAssistantErrored = lastAssistantStopReason === "error";
  const lastAssistantAborted = lastAssistantStopReason === "aborted";
  const runAborted = params.runAborted === true || lastAssistantAborted;
  const lastAssistantNeedsErrorSurface = lastAssistantErrored || lastAssistantAborted;
  const rawErrorMessage = lastAssistantNeedsErrorSurface
    ? normalizeOptionalString(assistantForPayload?.errorMessage)
    : undefined;
  const errorText =
    assistantForPayload && lastAssistantNeedsErrorSurface
      ? suppressAssistantArtifacts
        ? undefined
        : lastAssistantErrored || rawErrorMessage
          ? formatUserFacingAssistantErrorText(assistantForPayload, {
              cfg: params.config,
              sessionKey: params.sessionKey,
              provider: params.provider,
              model: params.model,
              authMode: params.authMode,
            })
          : formatAssistantErrorText(assistantForPayload, {
              cfg: params.config,
              sessionKey: params.sessionKey,
              provider: params.provider,
              model: params.model,
              authMode: params.authMode,
            })
      : undefined;
  const rawErrorFingerprint = rawErrorMessage
    ? getApiErrorPayloadFingerprint(rawErrorMessage)
    : null;
  const formattedRawErrorMessage = rawErrorMessage
    ? formatRawAssistantErrorForUi(rawErrorMessage)
    : null;
  const normalizedFormattedRawErrorMessage = formattedRawErrorMessage
    ? normalizeTextForComparison(formattedRawErrorMessage)
    : null;
  const normalizedRawErrorText = rawErrorMessage
    ? normalizeTextForComparison(rawErrorMessage)
    : null;
  const normalizedErrorText = errorText ? normalizeTextForComparison(errorText) : null;
  const normalizedGenericBillingErrorText = normalizeTextForComparison(BILLING_ERROR_USER_MESSAGE);
  const genericErrorText = "The AI service returned an error. Please try again.";
  if (errorText) {
    // Token-exhaustion (402) errors get a portable card with a top-up/upgrade
    // button (URL parsed from the gateway's 402 body). Slack and Teams render
    // the button natively; text-only channels fall back to errorText. Attaching
    // the presentation here means neither channel needs exhaustion-specific code.
    const exhaustionPresentation = rawErrorMessage
      ? buildTokenExhaustedPresentation(rawErrorMessage, assistantForPayload?.errorBody)
      : undefined;
    replyItems.push({
      text: errorText,
      isError: true,
      deliverDespiteSourceSuppression: true,
      ...(exhaustionPresentation ? { presentation: exhaustionPresentation } : {}),
    });
  }

  const inlineToolResults =
    params.inlineToolResultsAllowed && params.verboseLevel !== "off" && params.toolMetas.length > 0;
  if (inlineToolResults) {
    for (const { toolName, meta } of params.toolMetas) {
      const agg = formatToolAggregate(toolName, meta ? [meta] : [], {
        markdown: useMarkdown,
      });
      const parsedAggregate = parseInlineDirectives(agg, {
        stripAudioTag: true,
        stripReplyTags: true,
      });
      const cleanedText = parsedAggregate.text;
      if (cleanedText) {
        replyItems.push({
          text: cleanedText,
          audioAsVoice: parsedAggregate.audioAsVoice,
          replyToId: parsedAggregate.replyToId,
          replyToTag: parsedAggregate.hasReplyTag,
          replyToCurrent: parsedAggregate.replyToCurrent,
        });
      }
    }
  }

  const reasoningText =
    suppressAssistantArtifacts || runAborted
      ? ""
      : assistantForPayload && params.reasoningLevel === "on" && params.thinkingLevel !== "off"
        ? extractAssistantThinking(assistantForPayload)
        : "";
  if (reasoningText) {
    replyItems.push({ text: reasoningText, isReasoning: true });
  }

  const fallbackAnswerText = assistantForPayload
    ? extractAssistantVisibleText(assistantForPayload)
    : "";
  const fallbackRawAnswerText = resolveRawAssistantAnswerText(assistantForPayload);
  const shouldSuppressRawErrorText = (text: string) => {
    if (!lastAssistantNeedsErrorSurface) {
      return false;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    if (errorText) {
      const normalized = normalizeTextForComparison(trimmed);
      if (normalized && normalizedErrorText && normalized === normalizedErrorText) {
        return true;
      }
      if (trimmed === genericErrorText) {
        return true;
      }
      if (
        normalized &&
        normalizedGenericBillingErrorText &&
        normalized === normalizedGenericBillingErrorText
      ) {
        return true;
      }
    }
    if (rawErrorMessage && trimmed === rawErrorMessage) {
      return true;
    }
    if (formattedRawErrorMessage && trimmed === formattedRawErrorMessage) {
      return true;
    }
    if (normalizedRawErrorText) {
      const normalized = normalizeTextForComparison(trimmed);
      if (normalized && normalized === normalizedRawErrorText) {
        return true;
      }
    }
    if (normalizedFormattedRawErrorMessage) {
      const normalized = normalizeTextForComparison(trimmed);
      if (normalized && normalized === normalizedFormattedRawErrorMessage) {
        return true;
      }
    }
    if (rawErrorFingerprint) {
      const fingerprint = getApiErrorPayloadFingerprint(trimmed);
      if (fingerprint && fingerprint === rawErrorFingerprint) {
        return true;
      }
    }
    return isRawApiErrorPayload(trimmed);
  };
  const rawAnswerDirectiveState = fallbackRawAnswerText
    ? parseReplyDirectives(fallbackRawAnswerText)
    : null;
  const rawAnswerHasMedia =
    (rawAnswerDirectiveState?.mediaUrls?.length ?? 0) > 0 || rawAnswerDirectiveState?.audioAsVoice;
  const assistantTextsHaveMedia = params.assistantTexts.some((text) => {
    const parsed = parseReplyDirectives(text);
    return (parsed.mediaUrls?.length ?? 0) > 0 || parsed.audioAsVoice;
  });
  const normalizedAssistantTexts = normalizeTextForComparison(nonEmptyAssistantTexts.join("\n\n"));
  const normalizedRawAnswerText = normalizeTextForComparison(rawAnswerDirectiveState?.text ?? "");
  const shouldPreferRawAnswerText =
    rawAnswerHasMedia &&
    (!nonEmptyAssistantTexts.length ||
      (!assistantTextsHaveMedia &&
        normalizedAssistantTexts.length > 0 &&
        normalizedAssistantTexts === normalizedRawAnswerText));
  // When streamed text lost media directives but the canonical assistant answer
  // still contains them, keep the raw answer so attachments are not dropped.
  const fallbackAnswerSourceText =
    shouldPreferRawAnswerText && fallbackRawAnswerText ? fallbackRawAnswerText : fallbackAnswerText;
  const normalizedFallbackAnswerSourceText = fallbackAnswerSourceText
    ? normalizeReplyTextForComparison(fallbackAnswerSourceText)
    : "";
  const shouldUseCanonicalFinalAnswer =
    !lastAssistantNeedsErrorSurface &&
    fallbackAnswerSourceText.length > 0 &&
    normalizedFallbackAnswerSourceText.length > 0;
  const hasAssistantTextPayload = nonEmptyAssistantTexts.length > 0;
  const answerTexts =
    suppressAssistantArtifacts || runAborted
      ? []
      : (shouldUseCanonicalFinalAnswer
          ? [fallbackAnswerSourceText]
          : shouldPreferRawAnswerText && fallbackRawAnswerText
            ? [fallbackRawAnswerText]
            : hasAssistantTextPayload
              ? nonEmptyAssistantTexts
              : fallbackAnswerText
                ? [fallbackAnswerText]
                : []
        ).filter((text) => !shouldSuppressRawErrorText(text));

  let hasUserFacingAssistantReply = hasSourceReplyPayload || deliveredSourceReplyViaMessageTool;
  const hasUserFacingErrorReply = replyItems.some((item) => item.isError === true);
  let hasUserFacingFailureAcknowledgement = false;
  // In message_tool_only, plain assistant prose is private by contract and is
  // dropped at dispatch (only payloads marked deliverDespiteSourceSuppression
  // survive). Text the user will never see cannot count as a delivered reply
  // or as an acknowledgement that a mutating tool failed — otherwise a model
  // that merely wrote "I couldn't send the file" silently disables the
  // failure badge for a delivery no one saw.
  const assistantProseReachesUser = params.sourceReplyDeliveryMode !== "message_tool_only";
  for (const text of answerTexts) {
    const {
      text: cleanedText,
      mediaUrls,
      audioAsVoice,
      replyToId,
      replyToTag,
      replyToCurrent,
    } = parseReplyDirectives(text);
    if (!cleanedText && (!mediaUrls || mediaUrls.length === 0) && !audioAsVoice) {
      continue;
    }
    replyItems.push({
      text: cleanedText,
      media: mediaUrls,
      audioAsVoice,
      replyToId,
      replyToTag,
      replyToCurrent,
    });
    if (assistantProseReachesUser) {
      hasUserFacingAssistantReply = true;
      if (cleanedText && hasExplicitMutatingToolFailureAcknowledgement(cleanedText)) {
        hasUserFacingFailureAcknowledgement = true;
      }
    }
  }

  // The most recent UNRESOLVED failure. `lastToolError` is the live single
  // slot when set; a later unrelated success can clear it while an earlier
  // DIFFERENT step's failure is still unresolved (ENG-18812's purest form —
  // tool #3 fails, tool #25 succeeds, and pre-fix nothing was ever surfaced
  // for tool #3's failure). Fall back to the newest non-retried entry in the
  // full-turn list in that case, so today's single-slot behavior stays a
  // strict subset of this one.
  const toolFailures = params.toolFailures ?? (params.lastToolError ? [params.lastToolError] : []);
  const representativeToolError =
    params.lastToolError ?? toolFailures.findLast((failure) => !failure.retried);

  if (representativeToolError) {
    const warningPolicy = resolveToolErrorWarningPolicy({
      lastToolError: representativeToolError,
      hasUserFacingReply: hasUserFacingAssistantReply,
      hasUserFacingErrorReply,
      hasUserFacingFailureAcknowledgement,
      suppressToolErrors: Boolean(params.config?.messages?.suppressToolErrors),
      suppressToolErrorWarnings: params.suppressToolErrorWarnings,
      isCronTrigger: params.isCronTrigger,
      isHeartbeatTrigger: params.isHeartbeatTrigger,
      sessionKey: params.sessionKey,
      verboseLevel: params.verboseLevel,
    });

    // Surface mutating failures unless the assistant explicitly acknowledged the failed action.
    // Otherwise, keep the previous behavior and only surface non-recoverable failures when no reply exists.
    if (warningPolicy.showWarning) {
      const toolSummary = formatToolAggregate(
        representativeToolError.toolName,
        representativeToolError.meta ? [representativeToolError.meta] : undefined,
        { markdown: useMarkdown },
      );
      // Every OTHER unrecovered failure this turn that the same policy would
      // also surface — `shouldSurfaceToolFailure` (shared with
      // `resolveToolErrorWarningPolicy` above) decides each entry under the
      // identical context, so this can never disagree with `showWarning`
      // about the representative failure itself (ENG-18812).
      const digest = buildToolFailureDigest({
        toolFailures,
        toolMetas: params.toolMetas,
        surfaceContext: {
          hasUserFacingReply: hasUserFacingAssistantReply,
          hasUserFacingErrorReply,
          hasUserFacingFailureAcknowledgement,
          includeDetails: warningPolicy.includeDetails,
        },
      });
      // The same non-terminal decision used for the payload metadata below —
      // computed up front so the visible text can be reframed too, not just the
      // metadata flag. Middleware failures never reach here as non-terminal:
      // `resolveToolErrorWarningPolicy` only lets one through when no reply was
      // delivered, so it stays a genuine terminal failure below. Requiring a
      // non-empty digest keeps this flag and the emitted text in lockstep —
      // the representative failure always yields a non-empty digest (it is
      // always a `toolFailures` member and always passes the same predicate
      // that just proved `showWarning`), so this is a defensive tie, not a
      // separate rule.
      const isNonTerminalWarning =
        hasUserFacingAssistantReply &&
        isRecoverableExecClassToolName(representativeToolError.toolName) &&
        digest !== undefined;
      // ENG-16318: when a real answer was delivered and the exec command that
      // errored was entirely benign housekeeping (e.g. `mkdir … && find /` that
      // hit permission-denied noise), append nothing — not even the "↻ kept
      // going" note. A correct triage should not carry a tangential failure
      // marker. Commands that also ran real work still keep the note (below).
      // Keyed on the representative failure only — a turn with an EARLIER
      // non-benign failure alongside a benign most-recent one still suppresses
      // today, matching pre-digest behavior; broadening this to the whole
      // digest is a follow-up, not part of this fix.
      const suppressBenignHousekeepingNote =
        isNonTerminalWarning && representativeToolError.benignHousekeepingError === true;
      const errorSuffix =
        warningPolicy.includeDetails && representativeToolError.error
          ? `: ${representativeToolError.error}`
          : "";
      const warningText =
        isNonTerminalWarning && digest
          ? buildNonTerminalToolStatusText({
              digest,
              // Operators (verbose) additionally keep the representative
              // failure's raw error text.
              detailSuffix: warningPolicy.includeDetails
                ? representativeToolError.error
                : undefined,
            })
          : `⚠️ ${toolSummary} failed${errorSuffix}`;
      const normalizedWarning = normalizeTextForComparison(warningText);
      const duplicateWarning = normalizedWarning
        ? replyItems.some((item) => {
            if (!item.text) {
              return false;
            }
            const normalizedExisting = normalizeTextForComparison(item.text);
            return normalizedExisting.length > 0 && normalizedExisting === normalizedWarning;
          })
        : false;
      if (!duplicateWarning && !suppressBenignHousekeepingNote) {
        replyItems.push({
          text: warningText,
          isError: true,
          nonTerminalToolErrorWarning: isNonTerminalWarning,
          ...(isNonTerminalWarning && digest ? { toolFailureDigest: digest } : {}),
          // Retry applies to both branches: the non-terminal reframe (a step
          // didn't finish but a reply landed) and the terminal badge (a
          // mutating send/write failed outright — e.g. the message tool
          // failing to deliver the user's deliverable). Re-running makes
          // sense either way; only a benign/suppressed warning has no Retry
          // because it never becomes a visible payload at all.
          presentation: {
            blocks: [
              {
                type: "buttons",
                buttons: [{ label: "Retry", action: { type: "command", command: "/retry" } }],
              },
            ],
          },
          // A terminal failure of a mutating send is exactly the state the
          // customer's deliverable can go missing in — it must reach the user
          // even under message_tool_only, where plain prose is suppressed to
          // avoid double-sending a reply the message tool already delivered.
          deliverDespiteSourceSuppression: true,
        });
      }
    }
  }

  const hasAudioAsVoiceTag = replyItems.some((item) => item.audioAsVoice);
  return replyItems
    .map((item) => {
      const payload: ReplyPayload = {
        text: normalizeOptionalString(item.text),
      };
      const mediaUrl = item.mediaUrl ?? item.media?.[0];
      if (mediaUrl) {
        payload.mediaUrl = mediaUrl;
      }
      if (item.media?.length) {
        payload.mediaUrls = item.media;
      }
      if (item.isError !== undefined) {
        payload.isError = item.isError;
      }
      if (item.nonTerminalToolErrorWarning) {
        setReplyPayloadMetadata(payload, {
          nonTerminalToolErrorWarning: true,
          ...(item.toolFailureDigest ? { toolFailureDigest: item.toolFailureDigest } : {}),
        });
      }
      if (item.deliverDespiteSourceSuppression) {
        markReplyPayloadForSourceSuppressionDelivery(payload);
      }
      if (!item.isError && !item.isReasoning && params.assistantMessageIndex !== undefined) {
        setReplyPayloadMetadata(payload, {
          assistantMessageIndex: params.assistantMessageIndex,
        });
      }
      if (item.replyToId) {
        payload.replyToId = item.replyToId;
      }
      if (item.replyToTag !== undefined) {
        payload.replyToTag = item.replyToTag;
      }
      if (item.replyToCurrent !== undefined) {
        payload.replyToCurrent = item.replyToCurrent;
      }
      if (item.audioAsVoice || Boolean(hasAudioAsVoiceTag && item.media?.length)) {
        payload.audioAsVoice = true;
      }
      if (item.presentation) {
        payload.presentation = item.presentation;
      }
      if (item.interactive) {
        payload.interactive = item.interactive;
      }
      if (item.channelData) {
        payload.channelData = item.channelData;
      }
      if (item.sourceReplyMirror) {
        // Source-reply mirrors are transcript artifacts, not channel sends.
        markReplyPayloadForSourceSuppressionDelivery(payload);
        if (params.sessionKey) {
          const sourceReplyTranscriptMirror: NonNullable<
            ReplyPayloadMetadata["sourceReplyTranscriptMirror"]
          > = {
            sessionKey: params.sessionKey,
          };
          if (params.agentId) {
            sourceReplyTranscriptMirror.agentId = params.agentId;
          }
          if (payload.text) {
            sourceReplyTranscriptMirror.text = payload.text;
          }
          if (payload.mediaUrls?.length) {
            sourceReplyTranscriptMirror.mediaUrls = payload.mediaUrls;
          }
          if (item.sourceReplyMirror.idempotencyKey) {
            sourceReplyTranscriptMirror.idempotencyKey = item.sourceReplyMirror.idempotencyKey;
          }
          setReplyPayloadMetadata(payload, {
            sourceReplyTranscriptMirror,
          });
        }
      }
      if (payload.text && isSilentReplyPayloadText(payload.text, SILENT_REPLY_TOKEN)) {
        const silentText = payload.text;
        payload.text = undefined;
        if (hasReplyPayloadContent(payload)) {
          return payload;
        }
        payload.text = silentText;
      }
      return payload;
    })
    .filter((p) => {
      if (!hasReplyPayloadContent(p)) {
        return false;
      }
      if (p.text && isSilentReplyPayloadText(p.text, SILENT_REPLY_TOKEN)) {
        return false;
      }
      return true;
    });
}
