import { c as normalizeOptionalString, s as normalizeOptionalLowercaseString } from "./string-coerce-DW4mBlAt.js";
import { i as isCronSessionKey } from "./session-key-utils-C7uT9A4s.js";
import { g as setReplyPayloadMetadata, h as markReplyPayloadForSourceSuppressionDelivery } from "./reply-payload-hqKWLGrD.js";
import { r as formatRawAssistantErrorForUi } from "./assistant-error-format-KEs9e_xZ.js";
import { s as getApiErrorPayloadFingerprint, t as BILLING_ERROR_USER_MESSAGE, u as isRawApiErrorPayload } from "./sanitize-user-facing-text-CD2Sz7YJ.js";
import { i as isSilentReplyPayloadText } from "./tokens-Dfa_QHjq.js";
import { t as extractAssistantTextForPhase } from "./chat-message-content-DjYNz8gU.js";
import { t as parseInlineDirectives } from "./directive-tags-B64FytPi.js";
import { d as formatUserFacingAssistantErrorText, r as buildTokenExhaustedPresentation, u as formatAssistantErrorText } from "./errors-CgY1_Cdq.js";
import { a as hasReplyPayloadContent } from "./payload-BCsfdv86.js";
import { i as createHeartbeatToolResponsePayload } from "./heartbeat-tool-response-DXAvsFKQ.js";
import { s as normalizeTextForComparison } from "./embedded-agent-helpers-B98zvjU2.js";
import { M as formatToolAggregate } from "./streaming-BairmMVu.js";
import { f as parseReplyDirectives } from "./payloads-mOdQS7Tn.js";
import { i as extractAssistantVisibleText, r as extractAssistantThinking } from "./embedded-agent-utils-C12Zgk4b.js";
import { n as isLikelyMutatingToolName } from "./tool-mutation-BioMabQh.js";
import "./tool-loop-detection-B8NA77Cf.js";
//#region src/agents/tool-error-summary.ts
/**
* Compact tool error summary types.
*
* Stores failure metadata used by transcripts, retry behavior, and mutation recovery logic.
*/
const EXEC_LIKE_TOOL_NAMES = new Set(["exec", "bash"]);
/** Detects shell-execution tools that share retry and mutation semantics. */
function isExecLikeToolName(toolName) {
	return EXEC_LIKE_TOOL_NAMES.has(normalizeOptionalLowercaseString(toolName) ?? "");
}
const TIMED_OUT_ERROR_CODES = new Set(["ETIMEDOUT"]);
const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const NOT_FOUND_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);
const NETWORK_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EPIPE"
]);
const PERMISSION_DENIED_PATTERN = /permission denied|not permitted|access denied/iu;
const NOT_FOUND_PATTERN = /not found|no such file|could not find/iu;
const TIMED_OUT_PATTERN = /timed out|timeout/iu;
const NETWORK_PATTERN = /network|connection|unreachable|dns/iu;
const EXIT_ERROR_PATTERN = /exit(?:ed)?\s+(?:with\s+)?(?:code|status)\s*\d+|non-zero exit/iu;
const REASON_TEXT = {
	timed_out: "timed out",
	permission_denied: "permission denied",
	not_found: "not found",
	network: "couldn't reach the network",
	exit_error: "exited with an error"
};
/**
* Classifies a tool failure into a short, fixed, user-safe reason — never the
* raw error text (which may contain shell output, file paths, or provider
* error bodies). Returns `undefined` when nothing classifies; callers should
* omit the reason clause rather than print an "unknown" placeholder.
*/
function classifyToolFailureReason(summary) {
	const code = resolveToolFailureReasonCode(summary);
	return code ? {
		code,
		text: REASON_TEXT[code]
	} : void 0;
}
function resolveToolFailureReasonCode(summary) {
	if (summary.timedOut === true) return "timed_out";
	const errorCode = summary.errorCode?.toUpperCase();
	if (errorCode) {
		if (TIMED_OUT_ERROR_CODES.has(errorCode)) return "timed_out";
		if (PERMISSION_ERROR_CODES.has(errorCode)) return "permission_denied";
		if (NOT_FOUND_ERROR_CODES.has(errorCode)) return "not_found";
		if (NETWORK_ERROR_CODES.has(errorCode)) return "network";
	}
	const error = summary.error;
	if (!error) return;
	if (TIMED_OUT_PATTERN.test(error)) return "timed_out";
	if (PERMISSION_DENIED_PATTERN.test(error)) return "permission_denied";
	if (NOT_FOUND_PATTERN.test(error)) return "not_found";
	if (NETWORK_PATTERN.test(error)) return "network";
	if (EXIT_ERROR_PATTERN.test(error)) return "exit_error";
}
const RECOVERABLE_TOOL_ERROR_KEYWORDS = [
	"required",
	"missing",
	"invalid",
	"must be",
	"must have",
	"needs",
	"requires"
];
/** Best-effort signal that a non-mutating tool error was a caller-input mistake
*  the model can self-correct, not evidence of a broken step. */
function isRecoverableToolError(error) {
	const errorLower = normalizeOptionalLowercaseString(error) ?? "";
	return RECOVERABLE_TOOL_ERROR_KEYWORDS.some((keyword) => errorLower.includes(keyword));
}
/**
* Single source of truth for whether one tool failure should be user-visible
* at all. Shared by `resolveToolErrorWarningPolicy` (the turn's single
* representative failure) and the tool-failure digest (every OTHER
* unrecovered failure that joins it in the step-failure note), so the two
* can never disagree about which failures are shown (ENG-18812). Global
* turn-wide overrides (`suppressToolErrorWarnings`, `config.suppressToolErrors`)
* are NOT part of this predicate — callers apply those once, before touching
* any per-failure decision.
*/
function shouldSurfaceToolFailure(toolError, ctx) {
	const normalizedToolName = normalizeOptionalLowercaseString(toolError.toolName) ?? "";
	if (normalizedToolName === "sessions_send") return false;
	if (normalizedToolName === "sessions_spawn") return !ctx.hasUserFacingReply && !ctx.hasUserFacingErrorReply;
	if (toolError.middlewareError === true) return !ctx.hasUserFacingReply;
	if (toolError.mutatingAction ?? isLikelyMutatingToolName(toolError.toolName)) return !ctx.hasUserFacingErrorReply && !ctx.hasUserFacingFailureAcknowledgement;
	if (isExecLikeToolName(toolError.toolName) && !ctx.includeDetails) return false;
	return !ctx.hasUserFacingReply && !isRecoverableToolError(toolError.error);
}
//#endregion
//#region src/agents/tool-failure-digest.ts
/**
* Builds a leak-safe, deduped summary of EVERY unrecovered tool failure in a
* turn, for the step-failure note (ENG-18812). `lastToolError` is a
* single-slot "most recent failure" record - a turn with two distinct
* failures, or one whose last call happened to succeed, could previously
* describe only one failure or none at all. This module turns the full
* `toolFailures` list collected during the turn into the smallest safe shape
* a reply builder needs: which tools failed, why (a closed, user-safe reason
* code, never raw error text), and how many steps completed either way.
*/
/** Caps the note's failure list so a pathological turn can't produce a wall of text. */
const MAX_DIGEST_ENTRIES = 8;
/** Derives an honest total/completed pair from explicit outcomes when present,
* or from the surfaced failure records when a legacy producer omits outcomes. */
function resolveToolCounts(toolMetas, surfacedFailureCount) {
	if (toolMetas.some((meta) => meta.errored !== void 0)) return {
		totalToolCount: toolMetas.length,
		completedToolCount: toolMetas.filter((meta) => !meta.errored && meta.status !== "blocked" && meta.status !== "partial").length
	};
	const totalToolCount = Math.max(toolMetas.length, surfacedFailureCount);
	return {
		totalToolCount,
		completedToolCount: totalToolCount - surfacedFailureCount
	};
}
/**
* Builds the digest, or `undefined` when nothing survives (every failure was
* retried, or turn-wide suppression already applies - callers pass
* `surfaceContext` reflecting that). Per-entry visibility reuses
* `shouldSurfaceToolFailure`, the same predicate `resolveToolErrorWarningPolicy`
* uses for the turn's single representative failure, so the digest and the
* show/suppress decision can never disagree about which failures are visible.
*/
function buildToolFailureDigest(params) {
	const surfaced = params.toolFailures.filter((failure) => !failure.retried && shouldSurfaceToolFailure(failure, params.surfaceContext));
	if (surfaced.length === 0) return;
	const grouped = /* @__PURE__ */ new Map();
	const order = [];
	for (const failure of surfaced) {
		const reason = classifyToolFailureReason(failure);
		const key = `${failure.toolName}:${reason?.code ?? "unclassified"}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.count += 1;
			continue;
		}
		grouped.set(key, {
			toolName: failure.toolName,
			reasonCode: reason?.code,
			reasonText: reason?.text,
			count: 1
		});
		order.push(key);
	}
	const allEntries = order.map((key) => grouped.get(key));
	const failures = allEntries.slice(0, MAX_DIGEST_ENTRIES);
	const omittedCount = allEntries.length - failures.length;
	return {
		...resolveToolCounts(params.toolMetas, surfaced.length),
		failures,
		omittedCount
	};
}
//#endregion
//#region src/agents/embedded-agent-runner/run/payloads.ts
/**
* Builds embedded-agent payload objects from attempt inputs and outcomes.
*/
const MUTATING_FAILURE_ACTION_PATTERN = "(?:write|edit|update|save|create|delete|remove|modify|change|apply|patch|move|rename|send|reply|message|run|execute|execution|command|script|shell|bash|exec|tool|action|operation)";
const MUTATING_FAILURE_INABILITY_PATTERN = new RegExp(`\\b(?:couldn't|could not|can't|cannot|unable to|am unable to|wasn't able to|was not able to|were unable to)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`, "u");
const MUTATING_FAILURE_ACTION_THEN_FAILURE_PATTERN = new RegExp(`\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b.{0,100}\\b(?:failed|failure|errored)\\b`, "u");
const MUTATING_FAILURE_FAILURE_THEN_ACTION_PATTERN = new RegExp(`\\b(?:failed|failure)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`, "u");
const MUTATING_FAILURE_ERROR_WHILE_ACTION_PATTERN = new RegExp(`\\b(?:hit|encountered|ran into)\\b.{0,60}\\berror\\b.{0,100}\\b(?:while|trying to|when)\\b.{0,100}\\b${MUTATING_FAILURE_ACTION_PATTERN}\\b`, "u");
const DID_NOT_FAIL_PATTERN = /\b(?:did not|didn't)\s+fail\b/u;
const NEGATED_FAILURE_PATTERN = /\b(?:no|not|without)\s+(?:failures?|errors?)\b/u;
function hasExplicitMutatingToolFailureAcknowledgement(text) {
	const normalizedText = normalizeTextForComparison(text);
	if (!normalizedText) return false;
	if (DID_NOT_FAIL_PATTERN.test(normalizedText)) return false;
	if (MUTATING_FAILURE_INABILITY_PATTERN.test(normalizedText)) return true;
	if (NEGATED_FAILURE_PATTERN.test(normalizedText)) return false;
	return MUTATING_FAILURE_ACTION_THEN_FAILURE_PATTERN.test(normalizedText) || MUTATING_FAILURE_FAILURE_THEN_ACTION_PATTERN.test(normalizedText) || MUTATING_FAILURE_ERROR_WHILE_ACTION_PATTERN.test(normalizedText);
}
function isVerboseToolDetailEnabled(level) {
	return level === "full";
}
function resolveRawAssistantAnswerText(lastAssistant) {
	if (!lastAssistant) return "";
	return normalizeOptionalString(extractAssistantTextForPhase(lastAssistant, { phase: "final_answer" }) ?? extractAssistantTextForPhase(lastAssistant)) ?? "";
}
function normalizeReplyTextForComparison(text) {
	return normalizeTextForComparison(parseReplyDirectives(text).text ?? "");
}
function shouldIncludeToolErrorDetails(params) {
	if (isVerboseToolDetailEnabled(params.verboseLevel)) return true;
	if (params.lastToolError.errorCode === "tool_loop_run_ended") return true;
	if (!isExecLikeToolName(params.lastToolError.toolName)) return false;
	if (params.isHeartbeatTrigger === true) return true;
	return params.lastToolError.timedOut === true && (params.isCronTrigger === true || isCronSessionKey(params.sessionKey));
}
const RECOVERABLE_EXEC_CLASS_TOOL_NAMES = new Set([
	"exec",
	"bash",
	"process"
]);
function isRecoverableExecClassToolName(toolName) {
	return RECOVERABLE_EXEC_CLASS_TOOL_NAMES.has(normalizeOptionalLowercaseString(toolName) ?? "");
}
/** Renders one digest entry as `tool — reason` (`tool` alone when unclassified), with a `×N` suffix for repeats. */
function formatToolFailureDigestEntry(entry) {
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
function buildNonTerminalToolStatusText(params) {
	const { digest } = params;
	const didNotFinishCount = Math.max(1, digest.totalToolCount - digest.completedToolCount);
	const isMultiple = didNotFinishCount > 1;
	const header = isMultiple ? `${didNotFinishCount} steps didn't finish` : "One step didn't finish";
	const namedFailureCount = digest.failures.reduce((sum, entry) => sum + entry.count, 0) + digest.omittedCount;
	const unaccountedCount = Math.max(0, didNotFinishCount - namedFailureCount);
	const totalOmitted = digest.omittedCount + unaccountedCount;
	const stepLabel = digest.failures.length > 1 || totalOmitted > 0 ? "Steps" : "Step";
	const steps = digest.completedToolCount > 0 ? ` (${digest.completedToolCount} of ${digest.totalToolCount} steps completed)` : "";
	const list = digest.failures.map(formatToolFailureDigestEntry).join("; ");
	const omitted = totalOmitted > 0 ? `; …and ${totalOmitted} more` : "";
	const detail = params.detailSuffix ? `: ${params.detailSuffix}` : "";
	const closing = isMultiple ? "The reply above may be missing what those steps produced. Ask me to redo them if something looks off." : "The reply above may be missing what that step produced. Ask me to redo that step if something looks off.";
	return `↻ ${header}${steps}.\n${stepLabel}: ${list}${omitted}${detail}\n` + closing;
}
/**
* Chooses whether a tool failure needs a separate user-visible warning and
* whether to include raw details. Mutating failures are stricter because a
* silent failed write/send/delete can make the assistant look successful.
*/
function resolveToolErrorWarningPolicy(params) {
	let toolErrorWarningOverride;
	let dynamicToolErrorWarningsDisabled = false;
	if (typeof params.suppressToolErrorWarnings === "function") {
		toolErrorWarningOverride = params.suppressToolErrorWarnings();
		dynamicToolErrorWarningsDisabled = toolErrorWarningOverride === false;
	} else toolErrorWarningOverride = params.suppressToolErrorWarnings;
	const includeDetails = shouldIncludeToolErrorDetails({
		...params,
		verboseLevel: dynamicToolErrorWarningsDisabled ? "off" : params.verboseLevel
	});
	if (toolErrorWarningOverride === true || params.suppressToolErrors || params.yieldHandoff) return {
		showWarning: false,
		includeDetails
	};
	return {
		showWarning: shouldSurfaceToolFailure(params.lastToolError, {
			hasUserFacingReply: params.hasUserFacingReply,
			hasUserFacingErrorReply: params.hasUserFacingErrorReply,
			hasUserFacingFailureAcknowledgement: params.hasUserFacingFailureAcknowledgement,
			includeDetails
		}),
		includeDetails
	};
}
/**
* Converts a completed embedded attempt into reply payloads for channels. This
* is the boundary that suppresses duplicate source replies, filters raw API
* errors, preserves directive metadata, and decides when tool failures must be
* surfaced to the user.
*/
function buildEmbeddedRunPayloads(params) {
	if (params.heartbeatToolResponse) return [createHeartbeatToolResponsePayload(params.heartbeatToolResponse)];
	const replyItems = [];
	const sourceReplyPayloads = params.sourceReplyDeliveryMode === "message_tool_only" ? params.messagingToolSourceReplyPayloads ?? [] : [];
	const sourceReplyStartIndex = replyItems.length;
	sourceReplyPayloads.forEach((payload, index) => {
		const text = normalizeOptionalString(payload.text) ?? "";
		const media = Array.from(new Set([...payload.mediaUrl ? [payload.mediaUrl] : [], ...payload.mediaUrls ?? []])).filter((value) => value.trim().length > 0);
		if (!text && media.length === 0 && !payload.presentation && !payload.interactive && !payload.channelData) return;
		replyItems.push({
			text,
			...payload.mediaUrl ? { mediaUrl: payload.mediaUrl } : {},
			...media.length ? { media } : {},
			...payload.audioAsVoice ? { audioAsVoice: true } : {},
			...payload.presentation ? { presentation: payload.presentation } : {},
			...payload.interactive ? { interactive: payload.interactive } : {},
			...payload.channelData ? { channelData: payload.channelData } : {},
			sourceReplyMirror: { idempotencyKey: payload.idempotencyKey ?? (params.runId ? `${params.runId}:internal-source-reply:${index}` : void 0) }
		});
	});
	const hasSourceReplyPayload = replyItems.length > sourceReplyStartIndex;
	const deliveredSourceReplyViaMessageTool = params.sourceReplyDeliveryMode === "message_tool_only" && params.didDeliverSourceReplyViaMessageTool === true;
	const useMarkdown = params.toolResultFormat === "markdown";
	const suppressAssistantArtifacts = params.didSendDeterministicApprovalPrompt === true || hasSourceReplyPayload || deliveredSourceReplyViaMessageTool;
	const nonEmptyAssistantTexts = params.assistantTexts.filter((text) => text.trim().length > 0);
	const assistantForPayload = params.currentAssistant ?? void 0 ?? (nonEmptyAssistantTexts.length === 1 ? void 0 : params.lastAssistant);
	const lastAssistantStopReason = assistantForPayload?.stopReason;
	const lastAssistantErrored = lastAssistantStopReason === "error";
	const lastAssistantAborted = lastAssistantStopReason === "aborted";
	const runAborted = params.runAborted === true || lastAssistantAborted;
	const lastAssistantNeedsErrorSurface = lastAssistantErrored || lastAssistantAborted;
	const rawErrorMessage = lastAssistantNeedsErrorSurface ? normalizeOptionalString(assistantForPayload?.errorMessage) : void 0;
	const errorText = assistantForPayload && lastAssistantNeedsErrorSurface ? suppressAssistantArtifacts ? void 0 : lastAssistantErrored || rawErrorMessage ? formatUserFacingAssistantErrorText(assistantForPayload, {
		cfg: params.config,
		sessionKey: params.sessionKey,
		provider: params.provider,
		model: params.model,
		authMode: params.authMode
	}) : formatAssistantErrorText(assistantForPayload, {
		cfg: params.config,
		sessionKey: params.sessionKey,
		provider: params.provider,
		model: params.model,
		authMode: params.authMode
	}) : void 0;
	const rawErrorFingerprint = rawErrorMessage ? getApiErrorPayloadFingerprint(rawErrorMessage) : null;
	const formattedRawErrorMessage = rawErrorMessage ? formatRawAssistantErrorForUi(rawErrorMessage) : null;
	const normalizedFormattedRawErrorMessage = formattedRawErrorMessage ? normalizeTextForComparison(formattedRawErrorMessage) : null;
	const normalizedRawErrorText = rawErrorMessage ? normalizeTextForComparison(rawErrorMessage) : null;
	const normalizedErrorText = errorText ? normalizeTextForComparison(errorText) : null;
	const normalizedGenericBillingErrorText = normalizeTextForComparison(BILLING_ERROR_USER_MESSAGE);
	const genericErrorText = "The AI service returned an error. Please try again.";
	if (errorText) {
		const exhaustionPresentation = rawErrorMessage ? buildTokenExhaustedPresentation(rawErrorMessage, assistantForPayload?.errorBody) : void 0;
		replyItems.push({
			text: errorText,
			isError: true,
			deliverDespiteSourceSuppression: true,
			...exhaustionPresentation ? { presentation: exhaustionPresentation } : {}
		});
	}
	if (params.inlineToolResultsAllowed && params.verboseLevel !== "off" && params.toolMetas.length > 0) for (const { toolName, meta } of params.toolMetas) {
		const parsedAggregate = parseInlineDirectives(formatToolAggregate(toolName, meta ? [meta] : [], { markdown: useMarkdown }), {
			stripAudioTag: true,
			stripReplyTags: true
		});
		const cleanedText = parsedAggregate.text;
		if (cleanedText) replyItems.push({
			text: cleanedText,
			audioAsVoice: parsedAggregate.audioAsVoice,
			replyToId: parsedAggregate.replyToId,
			replyToTag: parsedAggregate.hasReplyTag,
			replyToCurrent: parsedAggregate.replyToCurrent
		});
	}
	const reasoningText = suppressAssistantArtifacts || runAborted ? "" : assistantForPayload && params.reasoningLevel === "on" && params.thinkingLevel !== "off" ? extractAssistantThinking(assistantForPayload) : "";
	if (reasoningText) replyItems.push({
		text: reasoningText,
		isReasoning: true
	});
	const fallbackAnswerText = assistantForPayload ? extractAssistantVisibleText(assistantForPayload) : "";
	const fallbackRawAnswerText = resolveRawAssistantAnswerText(assistantForPayload);
	const shouldSuppressRawErrorText = (text) => {
		if (!lastAssistantNeedsErrorSurface) return false;
		const trimmed = text.trim();
		if (!trimmed) return false;
		if (errorText) {
			const normalized = normalizeTextForComparison(trimmed);
			if (normalized && normalizedErrorText && normalized === normalizedErrorText) return true;
			if (trimmed === genericErrorText) return true;
			if (normalized && normalizedGenericBillingErrorText && normalized === normalizedGenericBillingErrorText) return true;
		}
		if (rawErrorMessage && trimmed === rawErrorMessage) return true;
		if (formattedRawErrorMessage && trimmed === formattedRawErrorMessage) return true;
		if (normalizedRawErrorText) {
			const normalized = normalizeTextForComparison(trimmed);
			if (normalized && normalized === normalizedRawErrorText) return true;
		}
		if (normalizedFormattedRawErrorMessage) {
			const normalized = normalizeTextForComparison(trimmed);
			if (normalized && normalized === normalizedFormattedRawErrorMessage) return true;
		}
		if (rawErrorFingerprint) {
			const fingerprint = getApiErrorPayloadFingerprint(trimmed);
			if (fingerprint && fingerprint === rawErrorFingerprint) return true;
		}
		return isRawApiErrorPayload(trimmed);
	};
	const rawAnswerDirectiveState = fallbackRawAnswerText ? parseReplyDirectives(fallbackRawAnswerText) : null;
	const rawAnswerHasMedia = (rawAnswerDirectiveState?.mediaUrls?.length ?? 0) > 0 || rawAnswerDirectiveState?.audioAsVoice;
	const assistantTextsHaveMedia = params.assistantTexts.some((text) => {
		const parsed = parseReplyDirectives(text);
		return (parsed.mediaUrls?.length ?? 0) > 0 || parsed.audioAsVoice;
	});
	const normalizedAssistantTexts = normalizeTextForComparison(nonEmptyAssistantTexts.join("\n\n"));
	const normalizedRawAnswerText = normalizeTextForComparison(rawAnswerDirectiveState?.text ?? "");
	const shouldPreferRawAnswerText = rawAnswerHasMedia && (!nonEmptyAssistantTexts.length || !assistantTextsHaveMedia && normalizedAssistantTexts.length > 0 && normalizedAssistantTexts === normalizedRawAnswerText);
	const fallbackAnswerSourceText = shouldPreferRawAnswerText && fallbackRawAnswerText ? fallbackRawAnswerText : fallbackAnswerText;
	const normalizedFallbackAnswerSourceText = fallbackAnswerSourceText ? normalizeReplyTextForComparison(fallbackAnswerSourceText) : "";
	const shouldUseCanonicalFinalAnswer = !lastAssistantNeedsErrorSurface && fallbackAnswerSourceText.length > 0 && normalizedFallbackAnswerSourceText.length > 0;
	const hasAssistantTextPayload = nonEmptyAssistantTexts.length > 0;
	const answerTexts = suppressAssistantArtifacts || runAborted ? [] : (shouldUseCanonicalFinalAnswer ? [fallbackAnswerSourceText] : shouldPreferRawAnswerText && fallbackRawAnswerText ? [fallbackRawAnswerText] : hasAssistantTextPayload ? nonEmptyAssistantTexts : fallbackAnswerText ? [fallbackAnswerText] : []).filter((text) => !shouldSuppressRawErrorText(text));
	let hasUserFacingAssistantReply = hasSourceReplyPayload || deliveredSourceReplyViaMessageTool;
	const hasUserFacingErrorReply = replyItems.some((item) => item.isError === true);
	let hasUserFacingFailureAcknowledgement = false;
	const assistantProseReachesUser = params.sourceReplyDeliveryMode !== "message_tool_only";
	for (const text of answerTexts) {
		const { text: cleanedText, mediaUrls, audioAsVoice, replyToId, replyToTag, replyToCurrent } = parseReplyDirectives(text);
		if (!cleanedText && (!mediaUrls || mediaUrls.length === 0) && !audioAsVoice) continue;
		replyItems.push({
			text: cleanedText,
			media: mediaUrls,
			audioAsVoice,
			replyToId,
			replyToTag,
			replyToCurrent
		});
		if (assistantProseReachesUser) {
			hasUserFacingAssistantReply = true;
			if (cleanedText && hasExplicitMutatingToolFailureAcknowledgement(cleanedText)) hasUserFacingFailureAcknowledgement = true;
		}
	}
	const toolFailures = params.toolFailures ?? (params.lastToolError ? [params.lastToolError] : []);
	const representativeToolError = params.lastToolError ?? toolFailures.findLast((failure) => !failure.retried);
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
			yieldHandoff: params.yieldDetected === true && params.hasAcceptedSessionSpawn === true
		});
		if (warningPolicy.showWarning) {
			const toolSummary = formatToolAggregate(representativeToolError.toolName, representativeToolError.meta ? [representativeToolError.meta] : void 0, { markdown: useMarkdown });
			const digest = buildToolFailureDigest({
				toolFailures,
				toolMetas: params.toolMetas,
				surfaceContext: {
					hasUserFacingReply: hasUserFacingAssistantReply,
					hasUserFacingErrorReply,
					hasUserFacingFailureAcknowledgement,
					includeDetails: warningPolicy.includeDetails
				}
			});
			const isNonTerminalWarning = hasUserFacingAssistantReply && isRecoverableExecClassToolName(representativeToolError.toolName) && digest !== void 0;
			const suppressBenignHousekeepingNote = isNonTerminalWarning && representativeToolError.benignHousekeepingError === true;
			const errorSuffix = warningPolicy.includeDetails && representativeToolError.error ? `: ${representativeToolError.error}` : "";
			const warningText = isNonTerminalWarning && digest ? buildNonTerminalToolStatusText({
				digest,
				detailSuffix: warningPolicy.includeDetails ? representativeToolError.error : void 0
			}) : `⚠️ ${toolSummary} failed${errorSuffix}`;
			const normalizedWarning = normalizeTextForComparison(warningText);
			if (!(normalizedWarning ? replyItems.some((item) => {
				if (!item.text) return false;
				const normalizedExisting = normalizeTextForComparison(item.text);
				return normalizedExisting.length > 0 && normalizedExisting === normalizedWarning;
			}) : false) && !suppressBenignHousekeepingNote) replyItems.push({
				text: warningText,
				isError: true,
				nonTerminalToolErrorWarning: isNonTerminalWarning,
				...isNonTerminalWarning && digest ? { toolFailureDigest: digest } : {},
				presentation: { blocks: [{
					type: "buttons",
					buttons: [{
						label: "Retry",
						action: {
							type: "command",
							command: "/retry"
						}
					}]
				}] },
				deliverDespiteSourceSuppression: true
			});
		}
	}
	const hasAudioAsVoiceTag = replyItems.some((item) => item.audioAsVoice);
	return replyItems.map((item) => {
		const payload = { text: normalizeOptionalString(item.text) };
		const mediaUrl = item.mediaUrl ?? item.media?.[0];
		if (mediaUrl) payload.mediaUrl = mediaUrl;
		if (item.media?.length) payload.mediaUrls = item.media;
		if (item.isError !== void 0) payload.isError = item.isError;
		if (item.nonTerminalToolErrorWarning) setReplyPayloadMetadata(payload, {
			nonTerminalToolErrorWarning: true,
			...item.toolFailureDigest ? { toolFailureDigest: item.toolFailureDigest } : {}
		});
		if (item.deliverDespiteSourceSuppression) markReplyPayloadForSourceSuppressionDelivery(payload);
		if (!item.isError && !item.isReasoning && params.assistantMessageIndex !== void 0) setReplyPayloadMetadata(payload, { assistantMessageIndex: params.assistantMessageIndex });
		if (item.replyToId) payload.replyToId = item.replyToId;
		if (item.replyToTag !== void 0) payload.replyToTag = item.replyToTag;
		if (item.replyToCurrent !== void 0) payload.replyToCurrent = item.replyToCurrent;
		if (item.audioAsVoice || Boolean(hasAudioAsVoiceTag && item.media?.length)) payload.audioAsVoice = true;
		if (item.presentation) payload.presentation = item.presentation;
		if (item.interactive) payload.interactive = item.interactive;
		if (item.channelData) payload.channelData = item.channelData;
		if (item.sourceReplyMirror) {
			markReplyPayloadForSourceSuppressionDelivery(payload);
			if (params.sessionKey) {
				const sourceReplyTranscriptMirror = { sessionKey: params.sessionKey };
				if (params.agentId) sourceReplyTranscriptMirror.agentId = params.agentId;
				if (payload.text) sourceReplyTranscriptMirror.text = payload.text;
				if (payload.mediaUrls?.length) sourceReplyTranscriptMirror.mediaUrls = payload.mediaUrls;
				if (item.sourceReplyMirror.idempotencyKey) sourceReplyTranscriptMirror.idempotencyKey = item.sourceReplyMirror.idempotencyKey;
				setReplyPayloadMetadata(payload, { sourceReplyTranscriptMirror });
			}
		}
		if (payload.text && isSilentReplyPayloadText(payload.text, "NO_REPLY")) {
			const silentText = payload.text;
			payload.text = void 0;
			if (hasReplyPayloadContent(payload)) return payload;
			payload.text = silentText;
		}
		return payload;
	}).filter((p) => {
		if (!hasReplyPayloadContent(p)) return false;
		if (p.text && isSilentReplyPayloadText(p.text, "NO_REPLY")) return false;
		return true;
	});
}
//#endregion
export { classifyToolFailureReason as n, isExecLikeToolName as r, buildEmbeddedRunPayloads as t };
