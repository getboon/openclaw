import { C as resolveExpiresAtMsFromDurationMs, S as resolveDateTimestampMs } from "./number-coercion-Crk_c9KW.js";
import { i as formatErrorMessage } from "./errors-eFp0F5lL.js";
import { t as createSubsystemLogger } from "./subsystem-CYwCorYs.js";
import { t as getGlobalHookRunner, u as fireAndForgetHook } from "./hook-runner-global-B7_j-C9h.js";
import { a as generateSecureUuid } from "./secure-random-Ds4AFLgz.js";
import { a as updateDeliveryQueueEntry, i as moveDeliveryQueueEntryToFailed, n as loadDeliveryQueueEntries, o as upsertDeliveryQueueEntry, r as loadDeliveryQueueEntry, t as deleteDeliveryQueueEntry } from "./delivery-queue-sqlite-2zNmxlc6.js";
import { n as resolveOutboundChannelMessageAdapter } from "./channel-resolution-l3MY-I-Q.js";
import { t as sendCrashRecoveryNotice } from "./crash-recovery-notice-XUXnH9L8.js";
//#region src/infra/outbound/delivery-commit-hooks.ts
const log = createSubsystemLogger("outbound/deliver");
const outboundDeliveryCommitHooks = /* @__PURE__ */ new WeakMap();
/** Attaches an after-commit hook without changing the delivery result shape. */
function attachOutboundDeliveryCommitHook(result, hook) {
	if (!hook) return result;
	const hooks = outboundDeliveryCommitHooks.get(result) ?? [];
	hooks.push(hook);
	outboundDeliveryCommitHooks.set(result, hooks);
	return result;
}
/** Runs after-commit hooks for delivered results while isolating hook failures. */
async function runOutboundDeliveryCommitHooks(results) {
	for (const result of results) for (const hook of outboundDeliveryCommitHooks.get(result) ?? []) try {
		await hook();
	} catch (err) {
		log.warn("Plugin message adapter after-commit hook failed.", {
			channel: result.channel,
			messageId: result.messageId,
			error: formatErrorMessage(err)
		});
	}
}
/** Type guard for batched outbound delivery results crossing loose boundaries. */
function isOutboundDeliveryResultArray(value) {
	return Array.isArray(value);
}
//#endregion
//#region src/infra/outbound/delivery-queue-storage.ts
const QUEUE_NAME = "outbound";
function queuedDeliveryMetadata(entry) {
	return {
		entryKind: "outbound",
		sessionKey: entry.session?.key,
		channel: entry.channel,
		target: entry.to,
		accountId: entry.accountId
	};
}
/** Persist a delivery entry before attempting send. Returns the entry ID. */
async function enqueueDelivery(params, stateDir) {
	const id = generateSecureUuid();
	const entry = {
		id,
		enqueuedAt: Date.now(),
		channel: params.channel,
		to: params.to,
		accountId: params.accountId,
		payloads: params.payloads,
		renderedBatchPlan: params.renderedBatchPlan,
		threadId: params.threadId,
		threadSuppressed: params.threadSuppressed,
		replyToId: params.replyToId,
		replyToMode: params.replyToMode,
		formatting: params.formatting,
		identity: params.identity,
		bestEffort: params.bestEffort,
		gifPlayback: params.gifPlayback,
		forceDocument: params.forceDocument,
		replyPayloadSendingHook: params.replyPayloadSendingHook,
		silent: params.silent,
		mirror: params.mirror,
		session: params.session,
		gatewayClientScopes: params.gatewayClientScopes,
		retryCount: 0
	};
	upsertDeliveryQueueEntry({
		queueName: QUEUE_NAME,
		entry,
		metadata: queuedDeliveryMetadata(entry),
		stateDir
	});
	return id;
}
/** Remove a successfully delivered entry from the queue. */
async function ackDelivery(id, stateDir) {
	deleteDeliveryQueueEntry(QUEUE_NAME, id, stateDir);
}
/** Update a queue entry after a failed delivery attempt. */
async function failDelivery(id, error, stateDir) {
	updateQueuedDelivery(id, stateDir, (entry) => ({
		...entry,
		retryCount: entry.retryCount + 1,
		lastAttemptAt: Date.now(),
		lastError: error
	}));
}
function updateQueuedDelivery(id, stateDir, update) {
	updateDeliveryQueueEntry(QUEUE_NAME, id, stateDir, (entry) => update(entry));
}
async function markDeliveryPlatformSendAttemptStarted(id, stateDir) {
	updateQueuedDelivery(id, stateDir, (entry) => ({
		...entry,
		platformSendStartedAt: entry.platformSendStartedAt ?? Date.now(),
		recoveryState: "send_attempt_started"
	}));
}
async function markDeliveryPlatformOutcomeUnknown(id, stateDir) {
	updateQueuedDelivery(id, stateDir, (entry) => ({
		...entry,
		platformSendStartedAt: entry.platformSendStartedAt ?? Date.now(),
		recoveryState: "unknown_after_send"
	}));
}
/** Load a single pending delivery entry by ID from the queue directory. */
async function loadPendingDelivery(id, stateDir) {
	return loadDeliveryQueueEntry(QUEUE_NAME, id, stateDir);
}
/** Load all pending delivery entries from the queue. */
async function loadPendingDeliveries(stateDir) {
	return loadDeliveryQueueEntries(QUEUE_NAME, stateDir);
}
/** Move a queue entry out of the pending retry set. */
async function moveToFailed(id, stateDir) {
	moveDeliveryQueueEntryToFailed(QUEUE_NAME, id, stateDir);
}
//#endregion
//#region src/infra/delivery-recovery.shared.ts
const RECOVERY_BACKOFF_MS = [
	5e3,
	25e3,
	12e4,
	6e5
];
function computeBackoffMs(retryCount) {
	if (retryCount <= 0) return 0;
	return RECOVERY_BACKOFF_MS[Math.min(retryCount - 1, RECOVERY_BACKOFF_MS.length - 1)] ?? RECOVERY_BACKOFF_MS.at(-1) ?? 0;
}
function getErrnoCode(err) {
	return err && typeof err === "object" && "code" in err ? String(err.code) : null;
}
function claimRecoveryEntry(entriesInProgress, entryId) {
	if (entriesInProgress.has(entryId)) return false;
	entriesInProgress.add(entryId);
	return true;
}
function releaseRecoveryEntry(entriesInProgress, entryId) {
	entriesInProgress.delete(entryId);
}
const PERMANENT_ERROR_PATTERNS = [
	/no conversation reference found/i,
	/chat not found/i,
	/user not found/i,
	/bot.*not.*member/i,
	/bot was blocked by the user/i,
	/forbidden: bot was kicked/i,
	/chat_id is empty/i,
	/recipient is not a valid/i,
	/outbound not configured for channel/i,
	/ambiguous .* recipient/i,
	/User .* not in room/i
];
const drainInProgress = /* @__PURE__ */ new Map();
const entriesInProgress = /* @__PURE__ */ new Set();
function resolveRecoveryDeadlineMs(maxRecoveryMs) {
	const durationMs = typeof maxRecoveryMs === "number" && Number.isFinite(maxRecoveryMs) ? Math.max(0, Math.trunc(maxRecoveryMs)) : 6e4;
	if (durationMs <= 0) return resolveDateTimestampMs(Date.now());
	return resolveExpiresAtMsFromDurationMs(durationMs) ?? resolveDateTimestampMs(Date.now());
}
function createEmptyRecoverySummary() {
	return {
		recovered: 0,
		failed: 0,
		skippedMaxRetries: 0,
		deferredBackoff: 0
	};
}
async function withActiveDeliveryClaim(entryId, fn) {
	if (!claimRecoveryEntry(entriesInProgress, entryId)) return { status: "claimed-by-other-owner" };
	try {
		return {
			status: "claimed",
			value: await fn()
		};
	} finally {
		releaseRecoveryEntry(entriesInProgress, entryId);
	}
}
function buildRecoveryDeliverParams(entry, cfg, stateDir) {
	return {
		cfg,
		channel: entry.channel,
		to: entry.to,
		accountId: entry.accountId,
		payloads: entry.payloads,
		renderedBatchPlan: entry.renderedBatchPlan,
		threadId: entry.threadId,
		threadSuppressed: entry.threadSuppressed,
		replyToId: entry.replyToId,
		replyToMode: entry.replyToMode,
		formatting: entry.formatting,
		identity: entry.identity,
		bestEffort: entry.bestEffort,
		gifPlayback: entry.gifPlayback,
		forceDocument: entry.forceDocument,
		replyPayloadSendingHook: entry.replyPayloadSendingHook,
		silent: entry.silent,
		mirror: entry.mirror,
		session: entry.session,
		gatewayClientScopes: entry.gatewayClientScopes,
		deliveryQueueId: entry.id,
		deliveryQueueStateDir: stateDir,
		skipQueue: true,
		deferCommitHooks: true
	};
}
async function reconcileUnknownQueuedDelivery(opts) {
	const adapter = resolveOutboundChannelMessageAdapter({
		channel: opts.entry.channel,
		cfg: opts.cfg,
		allowBootstrap: true
	});
	if (adapter?.durableFinal?.capabilities?.reconcileUnknownSend !== true) return null;
	const reconcileUnknownSend = adapter?.durableFinal?.reconcileUnknownSend;
	if (!reconcileUnknownSend) return null;
	const { entry } = opts;
	try {
		return await reconcileUnknownSend({
			cfg: opts.cfg,
			queueId: entry.id,
			channel: entry.channel,
			to: entry.to,
			...entry.accountId !== void 0 ? { accountId: entry.accountId } : {},
			enqueuedAt: entry.enqueuedAt,
			retryCount: entry.retryCount,
			...entry.platformSendStartedAt !== void 0 ? { platformSendStartedAt: entry.platformSendStartedAt } : {},
			payloads: entry.payloads,
			...entry.renderedBatchPlan ? { renderedBatchPlan: entry.renderedBatchPlan } : {},
			...entry.replyToId !== void 0 ? { replyToId: entry.replyToId } : {},
			...entry.replyToMode !== void 0 ? { replyToMode: entry.replyToMode } : {},
			...entry.threadId !== void 0 ? { threadId: entry.threadId } : {},
			...entry.silent !== void 0 ? { silent: entry.silent } : {}
		});
	} catch (err) {
		const error = formatErrorMessage(err);
		opts.log.warn(`Delivery entry ${opts.entry.id} unknown-send reconciliation failed: ${error}`);
		return {
			status: "unresolved",
			error,
			retryable: true
		};
	}
}
function buildReconciledSentResult(entry, reconciliation) {
	return {
		channel: entry.channel,
		messageId: reconciliation.messageId ?? reconciliation.receipt.primaryPlatformMessageId ?? reconciliation.receipt.platformMessageIds[0] ?? "",
		receipt: reconciliation.receipt
	};
}
function buildReconciledCommitContext(params) {
	const payload = params.entry.payloads[0] ?? {};
	const result = {
		messageId: params.result.messageId,
		receipt: params.result.receipt ?? {
			platformMessageIds: [params.result.messageId].filter(Boolean),
			parts: [],
			sentAt: Date.now()
		}
	};
	const base = {
		cfg: params.cfg,
		to: params.entry.to,
		accountId: params.entry.accountId,
		replyToId: params.entry.replyToId,
		replyToMode: params.entry.replyToMode,
		threadId: params.entry.threadId,
		silent: params.entry.silent,
		result
	};
	if (payload.presentation !== void 0 || payload.delivery !== void 0 || payload.interactive !== void 0 || payload.channelData !== void 0 && Object.keys(payload.channelData).length > 0) return {
		...base,
		kind: "payload",
		text: payload.text ?? "",
		mediaUrl: payload.mediaUrl,
		payload
	};
	const mediaUrl = payload.mediaUrl ?? payload.mediaUrls?.find((url) => url);
	if (mediaUrl) return {
		...base,
		kind: "media",
		text: payload.text ?? "",
		mediaUrl,
		audioAsVoice: payload.audioAsVoice,
		gifPlayback: params.entry.gifPlayback,
		forceDocument: params.entry.forceDocument
	};
	return {
		...base,
		kind: "text",
		text: payload.text ?? ""
	};
}
async function runReconciledSentCommitHooks(params) {
	const afterCommit = resolveOutboundChannelMessageAdapter({
		channel: params.entry.channel,
		cfg: params.cfg,
		allowBootstrap: true
	})?.send?.lifecycle?.afterCommit;
	if (!afterCommit) return;
	const result = buildReconciledSentResult(params.entry, params.reconciliation);
	try {
		await afterCommit(buildReconciledCommitContext({
			entry: params.entry,
			cfg: params.cfg,
			result
		}));
	} catch (err) {
		params.log.warn(`Delivery entry ${params.entry.id} reconciled sent afterCommit hook failed: ${formatErrorMessage(err)}`);
	}
}
async function moveEntryToFailedWithLogging(entryId, log, stateDir) {
	try {
		await moveToFailed(entryId, stateDir);
	} catch (err) {
		log.error(`Failed to move entry ${entryId} to failed/: ${String(err)}`);
	}
}
function isEntryEligibleForRecoveryRetry(entry, now) {
	const backoff = computeBackoffMs(entry.retryCount + 1);
	if (backoff <= 0) return { eligible: true };
	if (entry.retryCount === 0 && entry.lastAttemptAt === void 0) return { eligible: true };
	const nextEligibleAt = (typeof entry.lastAttemptAt === "number" && Number.isFinite(entry.lastAttemptAt) && entry.lastAttemptAt > 0 ? entry.lastAttemptAt ?? entry.enqueuedAt : entry.enqueuedAt) + backoff;
	if (now >= nextEligibleAt) return { eligible: true };
	return {
		eligible: false,
		remainingBackoffMs: nextEligibleAt - now
	};
}
function isPermanentDeliveryError(error) {
	return PERMANENT_ERROR_PATTERNS.some((re) => re.test(error));
}
async function notifyDeliveryRecoveryExhausted(params) {
	const { entry } = params;
	if (!await sendCrashRecoveryNotice({
		cfg: params.cfg,
		text: "My last reply to you may not have gone through — please let me know if you didn't receive it.",
		target: {
			channel: entry.channel,
			to: entry.to,
			accountId: entry.accountId,
			threadId: entry.threadId ?? void 0,
			sessionKey: entry.session?.key
		}
	})) params.log.warn(`Delivery entry ${entry.id}: could not send crash-recovery notice`);
	const hookRunner = getGlobalHookRunner();
	if (hookRunner?.hasHooks("delivery_recovery_exhausted")) fireAndForgetHook(hookRunner.runDeliveryRecoveryExhausted({
		queueName: "outbound",
		deliveryId: entry.id,
		channel: entry.channel,
		to: entry.to,
		accountId: entry.accountId,
		sessionKey: entry.session?.key,
		retryCount: entry.retryCount,
		recoveryState: entry.recoveryState,
		error: params.errMsg
	}, { config: params.cfg }), "delivery-queue-recovery: delivery_recovery_exhausted hook failed", (message) => params.log.warn(message));
}
async function drainQueuedEntry(opts) {
	const { entry } = opts;
	if (entry.recoveryState === "send_attempt_started" || entry.recoveryState === "unknown_after_send") {
		const reconciliation = await reconcileUnknownQueuedDelivery({
			entry,
			cfg: opts.cfg,
			log: opts.log
		});
		if (reconciliation?.status === "sent") try {
			await ackDelivery(entry.id, opts.stateDir);
			await runReconciledSentCommitHooks({
				entry,
				cfg: opts.cfg,
				reconciliation,
				log: opts.log
			});
			opts.onRecovered?.(entry);
			opts.log.info(`Delivery entry ${entry.id} reconciled unknown_after_send as already sent`);
			return "recovered";
		} catch (ackErr) {
			if (getErrnoCode(ackErr) === "ENOENT") return "already-gone";
			const errMsg = `failed to ack reconciled sent delivery: ${formatErrorMessage(ackErr)}`;
			opts.log.warn(`Delivery entry ${entry.id} ${errMsg}`);
			opts.onFailed?.(entry, errMsg);
			try {
				await failDelivery(entry.id, errMsg, opts.stateDir);
				return "failed";
			} catch (failErr) {
				if (getErrnoCode(failErr) === "ENOENT") return "already-gone";
			}
			return "failed";
		}
		if (reconciliation?.status === "not_sent") opts.log.info(`Delivery entry ${entry.id} reconciled ${entry.recoveryState} as not sent; replaying`);
		else {
			const errMsg = reconciliation?.status === "unresolved" && reconciliation.error ? `delivery state is ${entry.recoveryState} and reconciliation is unresolved: ${reconciliation.error}` : `delivery state is ${entry.recoveryState}; refusing blind replay without adapter reconciliation`;
			opts.log.warn(`Delivery entry ${entry.id} ${errMsg}`);
			opts.onFailed?.(entry, errMsg);
			if (reconciliation?.status === "unresolved" && reconciliation.retryable === true) {
				try {
					await failDelivery(entry.id, errMsg, opts.stateDir);
					return "failed";
				} catch (failErr) {
					if (getErrnoCode(failErr) === "ENOENT") return "already-gone";
				}
				return "failed";
			}
			try {
				await moveToFailed(entry.id, opts.stateDir);
				await notifyDeliveryRecoveryExhausted({
					entry,
					cfg: opts.cfg,
					errMsg,
					log: opts.log
				});
				return "moved-to-failed";
			} catch (moveErr) {
				if (getErrnoCode(moveErr) === "ENOENT") return "already-gone";
			}
			return "failed";
		}
	}
	try {
		const result = await opts.deliver(buildRecoveryDeliverParams(entry, opts.cfg, opts.stateDir));
		await ackDelivery(entry.id, opts.stateDir);
		if (isOutboundDeliveryResultArray(result)) await runOutboundDeliveryCommitHooks(result);
		opts.onRecovered?.(entry);
		return "recovered";
	} catch (err) {
		const errMsg = formatErrorMessage(err);
		opts.onFailed?.(entry, errMsg);
		if (isPermanentDeliveryError(errMsg)) try {
			await moveToFailed(entry.id, opts.stateDir);
			return "moved-to-failed";
		} catch (moveErr) {
			if (getErrnoCode(moveErr) === "ENOENT") return "already-gone";
		}
		else try {
			await failDelivery(entry.id, errMsg, opts.stateDir);
			return "failed";
		} catch (failErr) {
			if (getErrnoCode(failErr) === "ENOENT") return "already-gone";
		}
		return "failed";
	}
}
async function drainPendingDeliveries(opts) {
	if (drainInProgress.get(opts.drainKey)) {
		opts.log.info(`${opts.logLabel}: already in progress for ${opts.drainKey}, skipping`);
		return;
	}
	drainInProgress.set(opts.drainKey, true);
	try {
		const now = Date.now();
		const deliver = opts.deliver;
		const matchingEntries = (await loadPendingDeliveries(opts.stateDir)).filter((entry) => opts.selectEntry(entry, now).match).toSorted((a, b) => a.enqueuedAt - b.enqueuedAt);
		if (matchingEntries.length === 0) return;
		opts.log.info(`${opts.logLabel}: ${matchingEntries.length} pending message(s) matched ${opts.drainKey}`);
		for (const entry of matchingEntries) {
			if (!claimRecoveryEntry(entriesInProgress, entry.id)) {
				opts.log.info(`${opts.logLabel}: entry ${entry.id} is already being recovered`);
				continue;
			}
			try {
				const currentEntry = await loadPendingDelivery(entry.id, opts.stateDir);
				if (!currentEntry) {
					opts.log.info(`${opts.logLabel}: entry ${entry.id} already gone, skipping`);
					continue;
				}
				const currentDecision = opts.selectEntry(currentEntry, Date.now());
				if (!currentDecision.match) {
					opts.log.info(`${opts.logLabel}: entry ${currentEntry.id} no longer matches, skipping`);
					continue;
				}
				if (currentEntry.retryCount >= 5) {
					try {
						await moveToFailed(currentEntry.id, opts.stateDir);
					} catch (err) {
						if (getErrnoCode(err) === "ENOENT") {
							opts.log.info(`${opts.logLabel}: entry ${currentEntry.id} already gone, skipping`);
							continue;
						}
						throw err;
					}
					opts.log.warn(`${opts.logLabel}: entry ${currentEntry.id} exceeded max retries and was moved to failed/`);
					continue;
				}
				if (!currentDecision.bypassBackoff) {
					const retryEligibility = isEntryEligibleForRecoveryRetry(currentEntry, Date.now());
					if (!retryEligibility.eligible) {
						opts.log.info(`${opts.logLabel}: entry ${currentEntry.id} not ready for retry yet — backoff ${retryEligibility.remainingBackoffMs}ms remaining`);
						continue;
					}
				}
				if (await drainQueuedEntry({
					entry: currentEntry,
					cfg: opts.cfg,
					deliver,
					log: opts.log,
					stateDir: opts.stateDir,
					onFailed: (failedEntry, errMsg) => {
						if (isPermanentDeliveryError(errMsg)) {
							opts.log.warn(`${opts.logLabel}: entry ${failedEntry.id} hit permanent error — moving to failed/: ${errMsg}`);
							return;
						}
						opts.log.warn(`${opts.logLabel}: retry failed for entry ${failedEntry.id}: ${errMsg}`);
					}
				}) === "recovered") opts.log.info(`${opts.logLabel}: drained delivery ${currentEntry.id} on ${currentEntry.channel}`);
			} finally {
				releaseRecoveryEntry(entriesInProgress, entry.id);
			}
		}
	} finally {
		drainInProgress.delete(opts.drainKey);
	}
}
/**
* On gateway startup, scan the delivery queue and retry any pending entries.
* Uses exponential backoff and moves entries that exceed MAX_RETRIES to failed/.
*/
async function recoverPendingDeliveries(opts) {
	const pending = await loadPendingDeliveries(opts.stateDir);
	if (pending.length === 0) return createEmptyRecoverySummary();
	pending.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
	opts.log.info(`Found ${pending.length} pending delivery entries — starting recovery`);
	const deadline = resolveRecoveryDeadlineMs(opts.maxRecoveryMs);
	const summary = createEmptyRecoverySummary();
	for (const entry of pending) {
		if (Date.now() >= deadline) {
			opts.log.warn(`Recovery time budget exceeded — remaining entries deferred to next startup`);
			break;
		}
		if (!claimRecoveryEntry(entriesInProgress, entry.id)) {
			opts.log.info(`Recovery skipped for delivery ${entry.id}: already being processed`);
			continue;
		}
		try {
			const currentEntry = await loadPendingDelivery(entry.id, opts.stateDir);
			if (!currentEntry) {
				opts.log.info(`Recovery skipped for delivery ${entry.id}: already gone`);
				continue;
			}
			if (currentEntry.retryCount >= 5) {
				opts.log.warn(`Delivery ${currentEntry.id} exceeded max retries (${currentEntry.retryCount}/5) — moving to failed/`);
				await moveEntryToFailedWithLogging(currentEntry.id, opts.log, opts.stateDir);
				summary.skippedMaxRetries += 1;
				continue;
			}
			const currentRetryEligibility = isEntryEligibleForRecoveryRetry(currentEntry, Date.now());
			if (!currentRetryEligibility.eligible) {
				summary.deferredBackoff += 1;
				opts.log.info(`Delivery ${currentEntry.id} not ready for retry yet — backoff ${currentRetryEligibility.remainingBackoffMs}ms remaining`);
				continue;
			}
			if (await drainQueuedEntry({
				entry: currentEntry,
				cfg: opts.cfg,
				deliver: opts.deliver,
				log: opts.log,
				stateDir: opts.stateDir,
				onRecovered: (recoveredEntry) => {
					summary.recovered += 1;
					opts.log.info(`Recovered delivery ${recoveredEntry.id} on ${recoveredEntry.channel}`);
				},
				onFailed: (failedEntry, errMsg) => {
					summary.failed += 1;
					if (isPermanentDeliveryError(errMsg)) {
						opts.log.warn(`Delivery ${failedEntry.id} hit permanent error — moving to failed/: ${errMsg}`);
						return;
					}
					opts.log.warn(`Retry failed for delivery ${failedEntry.id}: ${errMsg}`);
				}
			}) === "moved-to-failed") continue;
		} finally {
			releaseRecoveryEntry(entriesInProgress, entry.id);
		}
	}
	opts.log.info(`Delivery recovery complete: ${summary.recovered} recovered, ${summary.failed} failed, ${summary.skippedMaxRetries} skipped (max retries), ${summary.deferredBackoff} deferred (backoff)`);
	return summary;
}
//#endregion
export { moveToFailed as _, withActiveDeliveryClaim as a, getErrnoCode as c, enqueueDelivery as d, failDelivery as f, markDeliveryPlatformSendAttemptStarted as g, markDeliveryPlatformOutcomeUnknown as h, recoverPendingDeliveries as i, releaseRecoveryEntry as l, loadPendingDelivery as m, isEntryEligibleForRecoveryRetry as n, claimRecoveryEntry as o, loadPendingDeliveries as p, isPermanentDeliveryError as r, computeBackoffMs as s, drainPendingDeliveries as t, ackDelivery as u, attachOutboundDeliveryCommitHook as v, runOutboundDeliveryCommitHooks as y };
