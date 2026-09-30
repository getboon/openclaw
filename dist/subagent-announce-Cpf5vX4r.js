import { c as normalizeOptionalString } from "./string-coerce-DW4mBlAt.js";
import { t as createLazyImportLoader } from "./lazy-promise-BONnzNfb.js";
import { n as defaultRuntime } from "./runtime-B4lgFmsS.js";
import { i as isCronSessionKey } from "./session-key-utils-C7uT9A4s.js";
import { i as getRuntimeConfig } from "./io-T6HZMVrs.js";
import { c as callGateway } from "./call-oNc0Bdrb.js";
import { o as normalizeDeliveryContext } from "./delivery-context.shared-CDnjdU34.js";
import { t as INTERNAL_MESSAGE_CHANNEL } from "./message-channel-constants-Z0pS5ykd.js";
import { i as normalizeMessageChannel } from "./message-channel-normalize-CADqpu1-.js";
import "./message-channel-BmnltGSU.js";
import { S as waitForEmbeddedAgentRunEnd, s as isEmbeddedAgentRunActive } from "./runs-Cgr6on-W.js";
import { c as stripLeadingSilentToken, l as stripSilentToken, n as SILENT_REPLY_TOKEN, o as isSilentReplyText, s as startsWithSilentToken } from "./tokens-Dfa_QHjq.js";
import { s as getSubagentDepthFromSessionStore } from "./subagent-capabilities-DqdcqEIS.js";
import "./delivery-context-CAr7BQGF.js";
import { a as loadSessionEntryByKey, c as runAnnounceDeliveryWithRetry, i as loadRequesterSessionEntry, l as resolveRequesterStoreKey, n as deliverSubagentAnnouncement, o as resolveSubagentAnnounceTimeoutMs, s as resolveSubagentCompletionOrigin, t as resolveAnnounceOrigin, v as formatAgentInternalEventsForPlainPrompt, y as formatAgentInternalEventsForPrompt } from "./subagent-announce-origin-D94Euj8s.js";
import { l as getSubagentCompletionOwner, r as dispatchGatewayMethodInProcess } from "./server-plugins-B3tpAjby.js";
import { a as buildCompactAnnounceStatsLine, c as filterCurrentDirectChildCompletionRows, d as readSubagentOutput, f as waitForSubagentRunOutcome, g as isAnnounceSkip, i as buildChildCompletionFindings, n as buildAnnounceIdempotencyKey, o as captureSubagentCompletionReply, r as applySubagentWaitOutcome, s as dedupeLatestChildCompletionRows, t as buildAnnounceIdFromChildRun, u as readLatestSubagentOutputWithRetry } from "./announce-idempotency-DfRcCceF.js";
import { t as deleteSubagentSessionForCleanup } from "./subagent-session-cleanup-C2-JunWb.js";
import { t as buildSubagentSystemPrompt } from "./subagent-system-prompt-Bs91RWap.js";
//#region src/agents/subagent-announce.ts
/**
* Subagent completion announcement coordinator.
*
* Captures child output, applies wait outcomes, routes announcements, and performs cleanup decisions.
*/
const defaultSubagentAnnounceDeps = {
	callGateway,
	dispatchGatewayMethodInProcess,
	getRuntimeConfig,
	loadSubagentRegistryRuntime
};
let subagentAnnounceDeps = defaultSubagentAnnounceDeps;
const subagentRegistryRuntimeLoader = createLazyImportLoader(() => import("./subagent-announce.registry.runtime.js"));
function loadSubagentRegistryRuntime() {
	return subagentRegistryRuntimeLoader.load();
}
function buildAnnounceReplyInstruction(params) {
	if (params.requesterIsSubagent) return `Convert this completion into a concise internal orchestration update for your parent agent in your own words. Keep this internal context private (don't mention system/log/stats/session details or announce type). If this result is duplicate or no update is needed, reply ONLY: ${SILENT_REPLY_TOKEN}.`;
	if (params.expectsCompletionMessage) return `A completed ${params.announceType} is ready for parent review. Review/verify the result above before deciding whether the original task is done. If additional action is required, continue the task or record a follow-up; otherwise send a truthful user-facing update. Keep this internal context private (don't mention system/log/stats/session details or announce type). Reply ONLY: ${SILENT_REPLY_TOKEN} only when this exact result is already visible to the user in this same turn.`;
	return `A completed ${params.announceType} is ready for parent review. Review/verify the result above before deciding whether the original task is done. If additional action is required, continue the task or record a follow-up; otherwise send a truthful user-facing update. Keep this internal context private (don't mention system/log/stats/session details or announce type), and do not copy the internal event text verbatim. Reply ONLY: ${SILENT_REPLY_TOKEN} if this exact result was already delivered to the user in this same turn.`;
}
function buildAnnounceSteerMessage(events) {
	return formatAgentInternalEventsForPrompt(events) || "A background task finished. Process the completion update now.";
}
function hasUsableSessionEntry(entry) {
	if (!entry || typeof entry !== "object") return false;
	const sessionId = entry.sessionId;
	return typeof sessionId !== "string" || sessionId.trim() !== "";
}
function buildDescendantWakeMessage(params) {
	return [
		"[Subagent Context] Your prior run ended while waiting for descendant subagent completions.",
		"[Subagent Context] All pending descendants for that run have now settled.",
		"[Subagent Context] Continue your workflow using these results. Spawn more subagents if needed, otherwise send your final answer.",
		"",
		`Task: ${params.taskLabel}`,
		"",
		params.findings
	].join("\n");
}
const WAKE_RUN_SUFFIX = ":wake";
function stripWakeRunSuffixes(runId) {
	let next = runId.trim();
	while (next.endsWith(WAKE_RUN_SUFFIX)) next = next.slice(0, -5);
	return next || runId.trim();
}
function isWakeContinuationRun(runId) {
	const trimmed = runId.trim();
	if (!trimmed) return false;
	return stripWakeRunSuffixes(trimmed) !== trimmed;
}
function stripAndClassifyReply(text) {
	let result = text;
	let didStrip = false;
	const hasLeadingSilentToken = startsWithSilentToken(result, SILENT_REPLY_TOKEN);
	if (hasLeadingSilentToken) {
		result = stripLeadingSilentToken(result, SILENT_REPLY_TOKEN);
		didStrip = true;
	}
	if (hasLeadingSilentToken || result.toLowerCase().includes("NO_REPLY".toLowerCase())) {
		result = stripSilentToken(result, SILENT_REPLY_TOKEN);
		didStrip = true;
	}
	if (didStrip && (!result.trim() || isSilentReplyText(result, "NO_REPLY") || isAnnounceSkip(result))) return null;
	return result;
}
async function wakeSubagentRunAfterDescendants(params) {
	if (params.signal?.aborted) return false;
	if (!hasUsableSessionEntry(loadSessionEntryByKey(params.childSessionKey))) return false;
	const announceTimeoutMs = resolveSubagentAnnounceTimeoutMs(subagentAnnounceDeps.getRuntimeConfig());
	const wakeMessage = buildDescendantWakeMessage({
		findings: params.findings,
		taskLabel: params.taskLabel
	});
	let wakeRunId;
	try {
		wakeRunId = normalizeOptionalString((await runAnnounceDeliveryWithRetry({
			operation: "descendant wake agent call",
			signal: params.signal,
			run: async () => await subagentAnnounceDeps.dispatchGatewayMethodInProcess("agent", {
				sessionKey: params.childSessionKey,
				message: wakeMessage,
				deliver: false,
				inputProvenance: {
					kind: "inter_session",
					sourceSessionKey: params.childSessionKey,
					sourceChannel: "webchat",
					sourceTool: "subagent_announce"
				},
				idempotencyKey: buildAnnounceIdempotencyKey(`${params.announceId}:wake`)
			}, { timeoutMs: announceTimeoutMs })
		}))?.runId) ?? "";
	} catch {
		return false;
	}
	if (!wakeRunId) return false;
	const { replaceSubagentRunAfterSteer } = await loadSubagentRegistryRuntime();
	return replaceSubagentRunAfterSteer({
		previousRunId: params.runId,
		nextRunId: wakeRunId,
		preserveFrozenResultFallback: true
	});
}
async function runSubagentAnnounceFlow(params) {
	let didAnnounce = false;
	const expectsCompletionMessage = params.expectsCompletionMessage === true;
	const announceType = params.announceType ?? "subagent task";
	let shouldDeleteChildSession = params.cleanup === "delete";
	try {
		let targetRequesterSessionKey = params.requesterSessionKey;
		let targetRequesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
		const childSessionId = (() => {
			const entry = loadSessionEntryByKey(params.childSessionKey);
			return typeof entry?.sessionId === "string" && entry.sessionId.trim() ? entry.sessionId.trim() : void 0;
		})();
		const settleTimeoutMs = Math.min(Math.max(params.timeoutMs, 1), 12e4);
		let reply = params.roundOneReply;
		let outcome = params.outcome;
		if (childSessionId && isEmbeddedAgentRunActive(childSessionId)) {
			if (!await waitForEmbeddedAgentRunEnd(childSessionId, settleTimeoutMs) && isEmbeddedAgentRunActive(childSessionId)) {
				shouldDeleteChildSession = false;
				if (outcome?.status !== "timeout" || params.cleanup === "delete") return false;
			}
		}
		if (!reply && params.waitForCompletion !== false) {
			const applied = applySubagentWaitOutcome({
				wait: await waitForSubagentRunOutcome(params.childRunId, settleTimeoutMs),
				outcome,
				startedAt: params.startedAt,
				endedAt: params.endedAt
			});
			outcome = applied.outcome;
			params.startedAt = applied.startedAt;
			params.endedAt = applied.endedAt;
		}
		if (!outcome) outcome = { status: "unknown" };
		const failedTerminalOutcome = outcome.status === "error";
		const allowFailedOutputCapture = !failedTerminalOutcome || !params.roundOneReply && !params.fallbackReply;
		if (failedTerminalOutcome) reply = void 0;
		let requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
		const requesterIsInternalSession = () => requesterDepth >= 1 || isCronSessionKey(targetRequesterSessionKey);
		let childCompletionFindings;
		let subagentRegistryRuntime;
		try {
			subagentRegistryRuntime = await subagentAnnounceDeps.loadSubagentRegistryRuntime();
			if (requesterDepth >= 1 && subagentRegistryRuntime.shouldIgnorePostCompletionAnnounceForSession(targetRequesterSessionKey)) return true;
			if (Math.max(0, subagentRegistryRuntime.countPendingDescendantRuns(params.childSessionKey)) > 0 && announceType !== "cron job") {
				shouldDeleteChildSession = false;
				return false;
			}
			if (typeof subagentRegistryRuntime.listSubagentRunsForRequester === "function") {
				const directChildren = subagentRegistryRuntime.listSubagentRunsForRequester(params.childSessionKey, { requesterRunId: params.childRunId });
				if (Array.isArray(directChildren) && directChildren.length > 0) childCompletionFindings = buildChildCompletionFindings(dedupeLatestChildCompletionRows(filterCurrentDirectChildCompletionRows(directChildren, {
					requesterSessionKey: params.childSessionKey,
					getLatestSubagentRunByChildSessionKey: subagentRegistryRuntime.getLatestSubagentRunByChildSessionKey
				})));
			}
		} catch {}
		const announceId = buildAnnounceIdFromChildRun({
			childSessionKey: params.childSessionKey,
			childRunId: params.childRunId
		});
		const childRunAlreadyWoken = isWakeContinuationRun(params.childRunId);
		if (params.wakeOnDescendantSettle === true && childCompletionFindings?.trim() && !childRunAlreadyWoken) {
			const wakeAnnounceId = buildAnnounceIdFromChildRun({
				childSessionKey: params.childSessionKey,
				childRunId: stripWakeRunSuffixes(params.childRunId)
			});
			if (await wakeSubagentRunAfterDescendants({
				runId: params.childRunId,
				childSessionKey: params.childSessionKey,
				taskLabel: params.label || params.task || "task",
				findings: childCompletionFindings,
				announceId: wakeAnnounceId,
				signal: params.signal
			})) {
				shouldDeleteChildSession = false;
				return true;
			}
		}
		if (!childCompletionFindings) {
			const fallbackReply = failedTerminalOutcome ? void 0 : normalizeOptionalString(params.fallbackReply);
			const fallbackIsSilent = Boolean(fallbackReply) && (isAnnounceSkip(fallbackReply) || isSilentReplyText(fallbackReply, "NO_REPLY"));
			if (!reply && allowFailedOutputCapture) reply = await readSubagentOutput(params.childSessionKey, outcome);
			if (!reply?.trim() && allowFailedOutputCapture) reply = await readLatestSubagentOutputWithRetry({
				sessionKey: params.childSessionKey,
				maxWaitMs: params.timeoutMs,
				outcome
			});
			if (!reply?.trim() && fallbackReply && !fallbackIsSilent) reply = fallbackReply;
			if (outcome?.status === "timeout" && reply?.trim() && params.waitForCompletion !== false) try {
				const applied = applySubagentWaitOutcome({
					wait: await waitForSubagentRunOutcome(params.childRunId, 0),
					outcome,
					startedAt: params.startedAt,
					endedAt: params.endedAt
				});
				outcome = applied.outcome;
				params.startedAt = applied.startedAt;
				params.endedAt = applied.endedAt;
			} catch {}
			if (isAnnounceSkip(reply) || isSilentReplyText(reply, "NO_REPLY")) if (fallbackReply && !fallbackIsSilent) {
				const cleaned = stripAndClassifyReply(fallbackReply);
				if (cleaned === null) return true;
				reply = cleaned;
			} else return true;
			else if (reply) {
				const cleaned = stripAndClassifyReply(reply);
				if (cleaned === null) if (fallbackReply && !fallbackIsSilent) {
					const cleanedFallback = stripAndClassifyReply(fallbackReply);
					if (cleanedFallback === null) return true;
					reply = cleanedFallback;
				} else return true;
				else reply = cleaned;
			}
		}
		if (!outcome) outcome = { status: "unknown" };
		const statusLabel = outcome.status === "ok" ? "completed; ready for parent review" : outcome.status === "timeout" ? "timed out" : outcome.status === "error" ? `failed: ${outcome.error || "unknown error"}` : "finished with unknown status";
		const taskLabel = params.label || params.task || "task";
		const announceSessionId = childSessionId || "unknown";
		const findings = childCompletionFindings || reply || "(no output)";
		let requesterIsSubagent = requesterIsInternalSession();
		if (requesterIsSubagent) {
			const { isSubagentSessionRunActive, resolveRequesterForChildSession, shouldIgnorePostCompletionAnnounceForSession } = subagentRegistryRuntime ?? await loadSubagentRegistryRuntime();
			if (!isSubagentSessionRunActive(targetRequesterSessionKey)) {
				if (shouldIgnorePostCompletionAnnounceForSession(targetRequesterSessionKey)) return true;
				if (!hasUsableSessionEntry(loadSessionEntryByKey(targetRequesterSessionKey))) {
					const fallback = resolveRequesterForChildSession(targetRequesterSessionKey);
					if (!fallback?.requesterSessionKey) {
						shouldDeleteChildSession = false;
						return false;
					}
					targetRequesterSessionKey = fallback.requesterSessionKey;
					targetRequesterOrigin = normalizeDeliveryContext(fallback.requesterOrigin) ?? targetRequesterOrigin;
					requesterDepth = getSubagentDepthFromSessionStore(targetRequesterSessionKey);
					requesterIsSubagent = requesterIsInternalSession();
				}
			}
		}
		const replyInstruction = buildAnnounceReplyInstruction({
			requesterIsSubagent,
			announceType,
			expectsCompletionMessage
		});
		const statsLine = await buildCompactAnnounceStatsLine({
			sessionKey: params.childSessionKey,
			startedAt: params.startedAt,
			endedAt: params.endedAt
		});
		const completionEvent = {
			type: "task_completion",
			source: announceType === "cron job" ? "cron" : "subagent",
			childSessionKey: params.childSessionKey,
			childSessionId: announceSessionId,
			announceType,
			taskLabel,
			status: outcome.status,
			statusLabel,
			result: findings,
			statsLine,
			replyInstruction
		};
		const internalEvents = [completionEvent];
		const triggerMessage = buildAnnounceSteerMessage(internalEvents);
		let directOrigin = targetRequesterOrigin;
		if (!requesterIsSubagent) {
			const { entry } = loadRequesterSessionEntry(targetRequesterSessionKey);
			directOrigin = resolveAnnounceOrigin(entry, targetRequesterOrigin);
		}
		const completionDirectOrigin = expectsCompletionMessage && !requesterIsSubagent ? await resolveSubagentCompletionOrigin({
			childSessionKey: params.childSessionKey,
			requesterSessionKey: targetRequesterSessionKey,
			requesterOrigin: directOrigin,
			childRunId: params.childRunId,
			spawnMode: params.spawnMode,
			expectsCompletionMessage
		}) : targetRequesterOrigin;
		const directIdempotencyKey = buildAnnounceIdempotencyKey(announceId);
		const ownerOrigin = completionDirectOrigin ?? directOrigin;
		const ownerChannel = normalizeMessageChannel(completionDirectOrigin?.channel ?? directOrigin?.channel);
		const selectedOwnerChannel = normalizeMessageChannel(params.claimedOwnerChannel) ?? ownerChannel;
		const completionOwner = getSubagentCompletionOwner(selectedOwnerChannel);
		let delivery;
		if (expectsCompletionMessage && !requesterIsSubagent && params.signal?.aborted !== true) {
			const routeTo = ownerOrigin?.to?.trim();
			if (selectedOwnerChannel && params.claimedOwnerChannel && !completionOwner) delivery = {
				delivered: false,
				path: "owner",
				ownerChannel: selectedOwnerChannel,
				error: `completion owner unavailable: ${selectedOwnerChannel}`
			};
			else if (completionOwner && routeTo) {
				const ownerRequest = {
					completionId: announceId,
					childSessionKey: params.childSessionKey,
					childRunId: params.childRunId,
					requesterSessionKey: resolveRequesterStoreKey(subagentAnnounceDeps.getRuntimeConfig(), targetRequesterSessionKey),
					route: {
						channel: selectedOwnerChannel ?? completionOwner.channel,
						accountId: ownerOrigin?.accountId,
						to: routeTo,
						threadId: ownerOrigin?.threadId
					},
					event: completionEvent,
					promptText: formatAgentInternalEventsForPlainPrompt(internalEvents),
					outcome,
					startedAt: params.startedAt,
					endedAt: params.endedAt,
					label: params.label,
					signal: params.signal,
					finalAttempt: params.finalAttempt
				};
				let ownerResult;
				try {
					if (await completionOwner.accepts(ownerRequest)) ownerResult = await completionOwner.deliver(ownerRequest);
				} catch (error) {
					ownerResult = {
						status: "failed",
						retryable: true,
						error: String(error)
					};
				}
				if (ownerResult && ownerResult.status !== "not_handled") delivery = ownerResult.status === "delivered" ? {
					delivered: true,
					path: "owner",
					ownerChannel: selectedOwnerChannel ?? completionOwner.channel,
					deliveredAt: ownerResult.deliveredAt
				} : ownerResult.status === "pending" ? {
					delivered: false,
					path: "owner",
					ownerChannel: selectedOwnerChannel ?? completionOwner.channel,
					error: ownerResult.error ?? "completion owner pending"
				} : {
					delivered: false,
					path: "owner",
					ownerChannel: selectedOwnerChannel ?? completionOwner.channel,
					terminal: !ownerResult.retryable,
					error: ownerResult.error,
					reason: ownerResult.retryable ? void 0 : "visible_reply_missing"
				};
			}
		}
		if (!delivery) delivery = await deliverSubagentAnnouncement({
			requesterSessionKey: targetRequesterSessionKey,
			announceId,
			triggerMessage,
			steerMessage: triggerMessage,
			internalEvents,
			summaryLine: taskLabel,
			requesterSessionOrigin: targetRequesterOrigin,
			requesterOrigin: expectsCompletionMessage && !requesterIsSubagent ? completionDirectOrigin : targetRequesterOrigin,
			completionDirectOrigin,
			directOrigin,
			sourceSessionKey: params.childSessionKey,
			sourceChannel: INTERNAL_MESSAGE_CHANNEL,
			sourceTool: "subagent_announce",
			targetRequesterSessionKey,
			requesterIsSubagent,
			expectsCompletionMessage,
			bestEffortDeliver: params.bestEffortDeliver,
			directIdempotencyKey,
			signal: params.signal
		});
		params.onDeliveryResult?.(delivery);
		didAnnounce = delivery.delivered;
		if (!delivery.delivered && delivery.error && (delivery.path === "direct" || delivery.path === "owner")) defaultRuntime.log(`[warn] Subagent completion direct announce failed for run ${params.childRunId}: ${delivery.error}`);
	} catch (err) {
		defaultRuntime.error?.(`Subagent announce failed: ${String(err)}`);
	} finally {
		if (params.label) try {
			await subagentAnnounceDeps.callGateway({
				method: "sessions.patch",
				params: {
					key: params.childSessionKey,
					label: params.label
				},
				timeoutMs: 1e4
			});
		} catch {}
		if (shouldDeleteChildSession) await deleteSubagentSessionForCleanup({
			callGateway: subagentAnnounceDeps.callGateway,
			childSessionKey: params.childSessionKey,
			spawnMode: params.spawnMode
		});
	}
	return didAnnounce;
}
const testing = { setDepsForTest(overrides) {
	const callGatewayOverride = overrides?.callGateway;
	const dispatchGatewayMethodInProcessOverride = overrides?.dispatchGatewayMethodInProcess ?? (callGatewayOverride ? (async (method, agentParams, options) => await callGatewayOverride({
		method,
		params: agentParams,
		expectFinal: options?.expectFinal,
		timeoutMs: options?.timeoutMs
	})) : void 0);
	subagentAnnounceDeps = overrides ? {
		...defaultSubagentAnnounceDeps,
		...overrides,
		...dispatchGatewayMethodInProcessOverride ? { dispatchGatewayMethodInProcess: dispatchGatewayMethodInProcessOverride } : {}
	} : defaultSubagentAnnounceDeps;
} };
//#endregion
export { testing as __testing, testing, buildSubagentSystemPrompt, captureSubagentCompletionReply, runSubagentAnnounceFlow };
