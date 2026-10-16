import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import type { AssistantMessage } from "../../../llm/types.js";
import { isReplayUnsafeAssistantError } from "../../../llm/utils/retry.js";
import { projectAgentRunAttemptTerminal } from "../../agent-run-terminal-outcome.js";
import type { AuthProfileFailureReason, AuthProfileStore } from "../../auth-profiles.js";
import {
  classifyAssistantFailoverReason,
  type FailoverReason,
  isAuthAssistantError,
  isBillingAssistantError,
  isFailoverAssistantError,
  isGenericUnknownStreamErrorMessage,
  isRateLimitAssistantError,
  parseImageDimensionError,
  pickFallbackThinkingLevel,
} from "../../embedded-agent-helpers.js";
import type { PreparedProviderFailoverOwner } from "../../failover/provider-patterns.js";
import { hasOnlyAssistantReasoningContent } from "../../replay-turn-classification.js";
import {
  resolveSessionSuspensionReason,
  type SessionSuspensionParams,
} from "../../session-suspension.js";
import { log } from "../logger.js";
import type { TraceAttempt } from "../types.js";
import { handleAssistantFailover, isShortWindowRateLimitMessage } from "./assistant-failover.js";
import {
  hasAttemptTerminalState,
  isCurrentAttemptReplaySafe,
} from "./attempt-terminal-evidence.js";
import { createFailoverDecisionLogger } from "./failover-observation.js";
import { resolveRunFailoverDecision } from "./failover-policy.js";
import { shouldRetrySilentErrorAssistantTurn } from "./incomplete-turn-recovery.js";
import type { RunEmbeddedAgentParams } from "./params.js";
import type { createEmbeddedRunSessionPromptState } from "./session-prompt-state.js";
import {
  isEmbeddedRunTerminalInterrupted,
  type EmbeddedRunTerminalState,
} from "./terminal-outcome.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

const MAX_EMPTY_ERROR_RETRIES = 3;
const MAX_SAME_MODEL_IDLE_TIMEOUT_RETRIES = 1;
// Autonomous retries of a generation cut off mid-stream, per run. One retry, then the existing
// failure handling (and the sub-agent backstop) takes over so the user is asked before more work.
const MAX_STREAM_DROP_RESUMES = 1;
// A cut-off generation cannot be continued: a half-written tool call is unusable, and the
// failed partial is not replayed to the provider. Very long single generations are the ones
// providers drop, so ask for the same step again in smaller pieces rather than re-sending the
// same giant call.
const STREAM_DROP_RETRY_INSTRUCTION =
  "Your previous step was cut off before it finished, most likely because it was very long. Nothing from that step was applied; everything before it is still in place. Redo that step, but split large output into several smaller tool calls (for example create a file, then add the rest in sections, or build a workbook part by part) so each call finishes quickly. If you were writing a long reply, put the bulk into a file and reply with a short summary.";

// Generations cut off after the request was accepted but before the model finished: the
// Anthropic SDK's missing message_stop, Bedrock's missing messageStop, the LLM gateway's
// upstream stream failure, and a stream that closed in the middle of a tool call.
const MID_STREAM_DROP_PATTERN =
  /stream ended before message_?stop|upstream error during stream|completed stream with an incomplete tool call/i;

// Failure classes a cut-off retry may cover. A gateway "upstream error during stream" can wrap a
// rate limit, overload, or auth failure; those keep their own handling.
const STREAM_DROP_RETRYABLE_REASONS: ReadonlySet<FailoverReason | null> = new Set([
  null,
  "timeout",
  "server_error",
  "empty_response",
  "no_error_details",
  "unclassified",
  "unknown",
]);

// The run's trace records every cut-off retry, so it doubles as the per-run retry count.
function countStreamDropRetries(traceAttempts: readonly TraceAttempt[]): number {
  return traceAttempts.filter((trace) => trace.result === "stream_drop_resume").length;
}

/**
 * True when the assistant turn failed because its generation was cut off mid-stream. The
 * cut-off turn never completed, so none of its tool calls ran; the transcript still holds the
 * completed work before it. Retrying on the same model therefore redoes only the cut-off step.
 */
function isMidStreamDropAssistantError(
  message: Pick<AssistantMessage, "stopReason" | "errorMessage"> | null | undefined,
): boolean {
  return (
    message?.stopReason === "error" &&
    typeof message.errorMessage === "string" &&
    MID_STREAM_DROP_PATTERN.test(message.errorMessage)
  );
}

type EmbeddedRunAssistantFailureOutcome = {
  action: "retry" | "proceed";
  thinkLevel: ThinkLevel;
  authRetryPending: boolean;
  emptyErrorRetries: number;
  overloadProfileRotations: number;
  sameModelIdleTimeoutRetries: number;
  lastRetryFailoverReason: FailoverReason | null;
  preserveSameModelRateLimitRetryCount: boolean;
  assistantProfileFailureReason: AuthProfileFailureReason | null;
};

export async function handleEmbeddedAssistantFailure(input: {
  runParams: RunEmbeddedAgentParams;
  attempt: EmbeddedRunAttemptResult;
  attemptAssistant?: AssistantMessage;
  currentAttemptAssistant?: AssistantMessage;
  terminalState: EmbeddedRunTerminalState;
  activeErrorContext: { provider: string; model: string };
  provider: string;
  providerOwner: PreparedProviderFailoverOwner | undefined;
  modelId: string;
  model: string;
  thinkLevel: ThinkLevel;
  // Profile rotation resets thinking inside the runtime; read it after advancing.
  getThinkLevel: () => ThinkLevel;
  attemptedThinking: Set<ThinkLevel>;
  fallbackConfigured: boolean;
  pluginHarnessOwnsTransport: boolean;
  canRestartForLiveSwitch: boolean;
  authProfileId?: string;
  authProfileStore: AuthProfileStore;
  runtimeAuthRetry: boolean;
  maybeRefreshRuntimeAuthForAuthError: (errorText: string, retry: boolean) => Promise<boolean>;
  resolveAuthProfileFailureReason: (
    reason: FailoverReason | null,
    options?: { providerStarted?: boolean; transientRateLimit?: boolean },
  ) => AuthProfileFailureReason | null;
  emptyErrorRetries: number;
  overloadProfileRotations: number;
  overloadProfileRotationLimit: number;
  sameModelIdleTimeoutRetries: number;
  previousRetryFailoverReason: FailoverReason | null;
  maybeMarkAuthProfileFailure: (failure: {
    profileId?: string;
    reason?: AuthProfileFailureReason | null;
    modelId?: string;
  }) => Promise<void>;
  maybeRetrySameModelRateLimit: (retry?: { retryAfterSeconds?: number }) => Promise<boolean>;
  maybeBackoffBeforeOverloadFailover: (reason: FailoverReason | null) => Promise<void>;
  advanceAuthProfile: Parameters<typeof handleAssistantFailover>[0]["advanceAuthProfile"];
  advanceRateLimitAuthProfile: Parameters<
    typeof handleAssistantFailover
  >[0]["advanceRateLimitAuthProfile"];
  traceAttempts: TraceAttempt[];
  suspendForFailure: (params: SessionSuspensionParams) => void;
  // Current session identity (for suspension) and the hook to set the next attempt's prompt.
  sessionPromptState: Pick<
    ReturnType<typeof createEmbeddedRunSessionPromptState>,
    "sessionId" | "activateInternalPrompt"
  >;
  agentDir: string;
  isProbeSession: boolean;
}): Promise<EmbeddedRunAssistantFailureOutcome> {
  const { aborted, idleTimedOut, promptError, timedOut, timedOutDuringCompaction } =
    projectAgentRunAttemptTerminal(input.attempt.terminal);
  const terminalInterrupted = isEmbeddedRunTerminalInterrupted(input.terminalState.outcome);
  const { signalOwnedInterruption } = input.terminalState;
  const fallbackThinking = pickFallbackThinkingLevel({
    message: input.attemptAssistant?.errorMessage,
    attempted: input.attemptedThinking,
  });
  const authFailure = isAuthAssistantError(input.attemptAssistant);
  const rateLimitFailure = isRateLimitAssistantError(input.attemptAssistant);
  const billingFailure = isBillingAssistantError(input.attemptAssistant);
  const failoverFailure = isFailoverAssistantError(input.attemptAssistant);
  const assistantFailoverReason = classifyAssistantFailoverReason(input.attemptAssistant, {
    provider: input.providerOwner?.id,
  });
  const assistantProviderStarted =
    Boolean(input.currentAttemptAssistant?.provider) ||
    input.terminalState.outcome.providerStarted === true;
  const assistantProfileFailoverReason =
    assistantFailoverReason ??
    (assistantProviderStarted && (timedOut || idleTimedOut) ? "timeout" : null);
  const assistantProfileFailureReason = input.resolveAuthProfileFailureReason(
    assistantProfileFailoverReason,
    {
      providerStarted: assistantProviderStarted,
      transientRateLimit:
        assistantProfileFailoverReason === "rate_limit" &&
        isShortWindowRateLimitMessage(input.attemptAssistant?.errorMessage),
    },
  );
  const replayUnsafeAssistantError = isReplayUnsafeAssistantError(input.attemptAssistant);
  // A generation cut off mid-stream used to fall through to "proceed" whenever the attempt had
  // run tools (not replay-safe), so the run failed and an outer fallback / parent re-spawn
  // restarted the whole job — re-sending the same giant call, which kept dropping. Retry on the
  // same model instead, from the existing transcript (completed tool results are kept; the
  // original prompt is not replayed), asking for the cut-off step in smaller pieces. Skipped
  // when the attempt left delivery/media/async evidence a fresh attempt would not carry over
  // (hasAttemptTerminalState), and for rate-limit / overload / auth failures.
  if (
    !replayUnsafeAssistantError &&
    !authFailure &&
    !rateLimitFailure &&
    !billingFailure &&
    STREAM_DROP_RETRYABLE_REASONS.has(assistantFailoverReason) &&
    !hasAttemptTerminalState(input.attempt) &&
    !terminalInterrupted &&
    !signalOwnedInterruption &&
    !aborted &&
    !timedOut &&
    !idleTimedOut &&
    !promptError &&
    isMidStreamDropAssistantError(input.attemptAssistant) &&
    countStreamDropRetries(input.traceAttempts) < MAX_STREAM_DROP_RESUMES
  ) {
    const streamDropRetry = countStreamDropRetries(input.traceAttempts) + 1;
    input.sessionPromptState.activateInternalPrompt(STREAM_DROP_RETRY_INSTRUCTION);
    log.warn(
      `[stream-drop-retry] generation cut off mid-stream; retrying same model in smaller steps ` +
        `attempt=${streamDropRetry}/${MAX_STREAM_DROP_RESUMES} ` +
        `provider=${input.attemptAssistant?.provider ?? input.provider} ` +
        `model=${input.attemptAssistant?.model ?? input.model} ` +
        `sessionKey=${input.runParams.sessionKey ?? input.runParams.sessionId}`,
    );
    input.traceAttempts.push({
      provider: input.activeErrorContext.provider,
      model: input.activeErrorContext.model,
      result: "stream_drop_resume",
      stage: "assistant",
    });
    return buildOutcome(input, {
      action: "retry",
      preserveSameModelRateLimitRetryCount: true,
      assistantProfileFailureReason: null,
    });
  }
  if (replayUnsafeAssistantError || !isCurrentAttemptReplaySafe(input.attempt)) {
    return buildOutcome(input, {
      action: "proceed",
      assistantProfileFailureReason: replayUnsafeAssistantError
        ? null
        : assistantProfileFailureReason,
    });
  }
  if (fallbackThinking && !terminalInterrupted) {
    log.warn(
      `unsupported thinking level for ${input.provider}/${input.modelId}; retrying with ${fallbackThinking}`,
    );
    return buildOutcome(input, {
      action: "retry",
      thinkLevel: fallbackThinking,
      preserveSameModelRateLimitRetryCount: true,
      assistantProfileFailureReason,
    });
  }
  const cloudCodeAssistFormatError = input.attempt.cloudCodeAssistFormatError;
  const imageDimensionError = parseImageDimensionError(input.attemptAssistant?.errorMessage ?? "");
  const genericUnknownReasoningError =
    assistantFailoverReason === "timeout" &&
    isGenericUnknownStreamErrorMessage(input.attemptAssistant?.errorMessage ?? "") &&
    Boolean(input.attemptAssistant && hasOnlyAssistantReasoningContent(input.attemptAssistant));
  const silentErrorRetryReason =
    assistantFailoverReason === null ||
    genericUnknownReasoningError ||
    assistantFailoverReason === "no_error_details" ||
    assistantFailoverReason === "unclassified" ||
    assistantFailoverReason === "unknown" ||
    assistantFailoverReason === "server_error";
  const replaySafeSilentErrorFailure =
    !authFailure &&
    !rateLimitFailure &&
    !billingFailure &&
    !cloudCodeAssistFormatError &&
    !imageDimensionError &&
    !terminalInterrupted &&
    !promptError &&
    silentErrorRetryReason &&
    shouldRetrySilentErrorAssistantTurn({
      attempt: input.attempt,
      assistant: input.attemptAssistant,
    });
  if (replaySafeSilentErrorFailure && input.emptyErrorRetries < MAX_EMPTY_ERROR_RETRIES) {
    const emptyErrorRetries = input.emptyErrorRetries + 1;
    log.warn(
      `[empty-error-retry] stopReason=error non-visible-output; resubmitting ` +
        `attempt=${emptyErrorRetries}/${MAX_EMPTY_ERROR_RETRIES} ` +
        `provider=${input.attemptAssistant?.provider ?? input.provider} ` +
        `model=${input.attemptAssistant?.model ?? input.model} ` +
        `sessionKey=${input.runParams.sessionKey ?? input.runParams.sessionId}`,
    );
    return buildOutcome(input, {
      action: "retry",
      emptyErrorRetries,
      preserveSameModelRateLimitRetryCount: true,
      assistantProfileFailureReason,
    });
  }

  // The bounded same-model retry already proved this attempt had no visible output
  // or replay-unsafe effects. Once those retries are exhausted, skip profile
  // rotation and let the configured model fallback recover the invisible failure.
  const exhaustedUnclassifiedSilentError =
    input.fallbackConfigured &&
    assistantFailoverReason === null &&
    replaySafeSilentErrorFailure &&
    input.emptyErrorRetries >= MAX_EMPTY_ERROR_RETRIES;
  const effectiveFailoverReason = exhaustedUnclassifiedSilentError
    ? ("unknown" as const)
    : assistantFailoverReason;

  const failedProfileId = input.authProfileId;
  const logFailoverDecision = createFailoverDecisionLogger({
    stage: "assistant",
    runId: input.runParams.runId,
    rawError: input.attemptAssistant?.errorMessage?.trim(),
    failoverReason: effectiveFailoverReason,
    profileFailureReason: assistantProfileFailureReason,
    provider: input.activeErrorContext.provider,
    model: input.activeErrorContext.model,
    sourceProvider: input.attemptAssistant?.provider ?? input.provider,
    sourceModel: input.attemptAssistant?.model ?? input.modelId,
    profileId: failedProfileId,
    fallbackConfigured: input.fallbackConfigured,
    timedOut,
    aborted,
  });
  if (
    !signalOwnedInterruption &&
    authFailure &&
    (await input.maybeRefreshRuntimeAuthForAuthError(
      input.attemptAssistant?.errorMessage ?? "",
      input.runtimeAuthRetry,
    ))
  ) {
    return buildOutcome(input, {
      action: "retry",
      authRetryPending: true,
      preserveSameModelRateLimitRetryCount: true,
      assistantProfileFailureReason,
    });
  }
  if (imageDimensionError && input.authProfileId) {
    const details = [
      imageDimensionError.messageIndex !== undefined
        ? `message=${imageDimensionError.messageIndex}`
        : null,
      imageDimensionError.contentIndex !== undefined
        ? `content=${imageDimensionError.contentIndex}`
        : null,
      imageDimensionError.maxDimensionPx !== undefined
        ? `limit=${imageDimensionError.maxDimensionPx}px`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    log.warn(
      `Profile ${input.authProfileId} rejected image payload${details ? ` (${details})` : ""}.`,
    );
  }

  const initialDecision = exhaustedUnclassifiedSilentError
    ? ({ action: "fallback_model", reason: "unknown" } as const)
    : resolveRunFailoverDecision({
        stage: "assistant",
        allowFormatRetry: cloudCodeAssistFormatError,
        terminal: input.attempt.terminal,
        signalOwnedInterruption,
        fallbackConfigured: input.fallbackConfigured,
        failoverFailure,
        failoverReason: assistantFailoverReason,
        harnessOwnsTransport: input.pluginHarnessOwnsTransport,
        profileRotated: false,
      });
  const outcome = await handleAssistantFailover({
    initialDecision,
    terminal: input.attempt.terminal,
    signalOwnedInterruption,
    fallbackConfigured: input.fallbackConfigured,
    failoverFailure,
    failoverReason: assistantFailoverReason,
    harnessOwnsTransport: input.pluginHarnessOwnsTransport,
    allowSameModelIdleTimeoutRetry:
      timedOut &&
      idleTimedOut &&
      !timedOutDuringCompaction &&
      !input.fallbackConfigured &&
      input.canRestartForLiveSwitch &&
      input.sameModelIdleTimeoutRetries < MAX_SAME_MODEL_IDLE_TIMEOUT_RETRIES,
    assistantProfileFailureReason,
    lastProfileId: input.authProfileId,
    modelId: input.modelId,
    provider: input.provider,
    providerOwner: input.providerOwner,
    activeErrorContext: input.activeErrorContext,
    lastAssistant: input.attemptAssistant,
    config: input.runParams.config,
    sessionKey: input.runParams.sessionKey ?? input.runParams.sessionId,
    authFailure,
    rateLimitFailure,
    billingFailure,
    authMode: input.authProfileId
      ? input.authProfileStore.profiles?.[input.authProfileId]?.type
      : undefined,
    cloudCodeAssistFormatError,
    isProbeSession: input.isProbeSession,
    overloadProfileRotations: input.overloadProfileRotations,
    overloadProfileRotationLimit: input.overloadProfileRotationLimit,
    previousRetryFailoverReason: input.previousRetryFailoverReason,
    logAssistantFailoverDecision: logFailoverDecision,
    warn: (message) => log.warn(message),
    maybeMarkAuthProfileFailure: input.maybeMarkAuthProfileFailure,
    maybeRetrySameModelRateLimit: input.maybeRetrySameModelRateLimit,
    maybeBackoffBeforeOverloadFailover: input.maybeBackoffBeforeOverloadFailover,
    advanceAuthProfile: input.advanceAuthProfile,
    advanceRateLimitAuthProfile: input.advanceRateLimitAuthProfile,
  });
  if (outcome.action === "retry") {
    const retryTraceResult =
      outcome.retryKind === "same_model_rate_limit"
        ? "same_model_rate_limit"
        : outcome.retryKind === "same_model_idle_timeout" || effectiveFailoverReason === "timeout"
          ? "timeout"
          : "rotate_profile";
    input.traceAttempts.push({
      provider: input.activeErrorContext.provider,
      model: input.activeErrorContext.model,
      result: retryTraceResult,
      ...(effectiveFailoverReason ? { reason: effectiveFailoverReason } : {}),
      stage: "assistant",
    });
    return buildOutcome(input, {
      action: "retry",
      thinkLevel:
        outcome.retryKind === "profile_rotation" ? input.getThinkLevel() : input.thinkLevel,
      overloadProfileRotations: outcome.overloadProfileRotations,
      sameModelIdleTimeoutRetries:
        input.sameModelIdleTimeoutRetries +
        (outcome.retryKind === "same_model_idle_timeout" ? 1 : 0),
      lastRetryFailoverReason: outcome.lastRetryFailoverReason,
      preserveSameModelRateLimitRetryCount: outcome.retryKind === "same_model_rate_limit",
      assistantProfileFailureReason,
    });
  }
  if (outcome.action === "throw") {
    input.traceAttempts.push({
      provider: input.activeErrorContext.provider,
      model: input.activeErrorContext.model,
      result:
        effectiveFailoverReason === "timeout"
          ? "timeout"
          : initialDecision.action === "fallback_model"
            ? "fallback_model"
            : "error",
      ...(effectiveFailoverReason ? { reason: effectiveFailoverReason } : {}),
      stage: "assistant",
      ...(typeof outcome.error.status === "number" ? { status: outcome.error.status } : {}),
    });
    if (outcome.error.suspend) {
      input.suspendForFailure({
        cfg: input.runParams.config,
        agentDir: input.agentDir,
        sessionId: input.sessionPromptState.sessionId ?? input.runParams.sessionId,
        reason: resolveSessionSuspensionReason(outcome.error.reason),
        failedProvider: outcome.error.provider ?? input.provider,
        failedModel: outcome.error.model ?? input.modelId,
      });
    }
    throw outcome.error;
  }
  return buildOutcome(input, {
    action: "proceed",
    overloadProfileRotations: outcome.overloadProfileRotations,
    assistantProfileFailureReason,
  });
}

function buildOutcome(
  input: Parameters<typeof handleEmbeddedAssistantFailure>[0],
  override: Partial<EmbeddedRunAssistantFailureOutcome> &
    Pick<EmbeddedRunAssistantFailureOutcome, "action" | "assistantProfileFailureReason">,
): EmbeddedRunAssistantFailureOutcome {
  return {
    action: override.action,
    thinkLevel: override.thinkLevel ?? input.thinkLevel,
    authRetryPending: override.authRetryPending ?? false,
    emptyErrorRetries: override.emptyErrorRetries ?? input.emptyErrorRetries,
    overloadProfileRotations: override.overloadProfileRotations ?? input.overloadProfileRotations,
    sameModelIdleTimeoutRetries:
      override.sameModelIdleTimeoutRetries ?? input.sameModelIdleTimeoutRetries,
    lastRetryFailoverReason: override.lastRetryFailoverReason ?? input.previousRetryFailoverReason,
    preserveSameModelRateLimitRetryCount: override.preserveSameModelRateLimitRetryCount ?? false,
    assistantProfileFailureReason: override.assistantProfileFailureReason,
  };
}
