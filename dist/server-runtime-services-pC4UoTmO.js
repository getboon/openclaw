import { r as isVitestRuntimeEnv } from "./env-CyfweASw.js";
import { n as defaultRuntime } from "./runtime-B4lgFmsS.js";
import { t as createSubsystemLogger } from "./subsystem-CYwCorYs.js";
import "./agent-scope-XIomFVd1.js";
import { p as resolveAgentIdFromSessionKey } from "./session-key-pTKRJb0m.js";
import { c as resolveDefaultAgentId } from "./agent-scope-config-DrIvffiJ.js";
import { i as getRuntimeConfig } from "./io-T6HZMVrs.js";
import "./config-Dft2iRNk.js";
import { o as resolveSafeTimeoutDelayMs, t as MAX_SAFE_TIMEOUT_DELAY_MS } from "./timeouts-DdTImbzl.js";
import { d as getAgentRunContext, p as onAgentEvent } from "./agent-events-DSEN7fVL.js";
import { S as loadSessionStore } from "./store-Duo8PvDp.js";
import { d as resolveStorePath } from "./paths-DfUJ_nbS.js";
import { i as resolveSessionStoreTargets } from "./targets-rRa4VFHz.js";
import { A as resolveActiveReplyRunThreadId, D as replyRunRegistry, T as onReplyRunTerminal, k as resolveActiveReplyRunStartedAt, w as listActiveReplyRunSessionKeys } from "./run-state-BVCBobi1.js";
import { r as runSessionsCleanup } from "./sessions-CVRGkIiy.js";
import { t as isGatewayModelPricingEnabled } from "./model-pricing-config-pKJPI_G6.js";
import { t as channelDeclaresMessageAction } from "./message-action-discovery-BCvpeg_5.js";
import { t as buildOutboundSessionContext } from "./session-context-B5BRwDjy.js";
import { s as BOON_EXEC_BINARIES } from "./tool-display-common-CLZOko7v.js";
import { t as sendDurableMessageBatch } from "./send-DtvJDSRd.js";
import "./runtime-DQ6cYeLC.js";
import { n as resolveHeartbeatDeliveryTargetWithSessionRoute } from "./targets-CLnhQXBL.js";
import { t as dispatchChannelMessageAction } from "./message-action-dispatch-DWHF21eh.js";
import { r as replaceGenericExternalRunFailureText } from "./agent-runner-failure-copy-D7KZsRTJ.js";
import { i as isWithinActiveHours, r as startHeartbeatRunner } from "./heartbeat-runner-gJ8PqGWY.js";
import { r as createNoopHeartbeatRunner } from "./server-runtime-startup-services-CYINICcF.js";
//#region src/infra/progress-nudge-runner.ts
const log$1 = createSubsystemLogger("gateway/progress-nudge");
function resolveProgressNudgeConfig(cfg) {
	const raw = cfg.agents?.defaults?.progressNudge;
	const thresholdSeconds = raw?.thresholdSeconds ?? 45;
	const intervalSeconds = raw?.intervalSeconds ?? 30;
	const maxNudges = raw?.maxNudges ?? 3;
	return {
		enabled: raw?.enabled === true,
		thresholdMs: thresholdSeconds * 1e3,
		intervalMs: intervalSeconds * 1e3,
		maxNudges,
		target: raw?.target ?? "last",
		activeHours: raw?.activeHours
	};
}
/**
* Poll cadence. We poll finer than the threshold/interval gates so a nudge
* lands close to when it's actually due (a coarse poll equal to the interval
* would round the first nudge up to a full interval past the threshold).
* Capped at 15s for responsiveness, floored at 5s to avoid busy-spinning, and
* never coarser than the smaller of threshold/interval for tight configs.
*/
const PROGRESS_NUDGE_MAX_TICK_MS = 15e3;
const PROGRESS_NUDGE_MIN_TICK_MS = 5e3;
const PROGRESS_NUDGE_ANCHOR_RETENTION_MS = 10 * 6e4;
const NUDGE_PROGRESS_BANNED_SUBSTRINGS = [
	"|",
	"2>&1",
	"`",
	"~/",
	"/home/",
	"$(",
	"&&",
	";",
	" > ",
	">>",
	"<(",
	...BOON_EXEC_BINARIES,
	"openclaw",
	".boon-agent"
];
const NUDGE_PROGRESS_GENERIC_PHRASES = new Set([
	"run command",
	"bash command",
	"exec command",
	"command run command"
]);
function sanitizeNudgeProgressText(text) {
	const trimmed = text?.trim();
	if (!trimmed || trimmed.includes("\n") || trimmed.length > 140) return;
	const normalized = trimmed.toLowerCase();
	if (NUDGE_PROGRESS_BANNED_SUBSTRINGS.some((substring) => normalized.includes(substring)) || NUDGE_PROGRESS_GENERIC_PHRASES.has(normalized)) return;
	if (!/^[A-Za-z0-9][A-Za-z0-9 .,:'()&_!?-]*$/.test(trimmed)) return;
	return trimmed;
}
function resolveTickMs(resolved) {
	const bound = Math.min(resolved.thresholdMs, resolved.intervalMs, PROGRESS_NUDGE_MAX_TICK_MS);
	return Math.max(PROGRESS_NUDGE_MIN_TICK_MS, bound);
}
function renderProgressText(progressText) {
	const sanitized = sanitizeNudgeProgressText(progressText);
	if (sanitized) return `Still working on ${sanitized}…`;
	return "Still working on your request…";
}
function renderErrorText() {
	const { text } = replaceGenericExternalRunFailureText("The run hit an error before it could finish.");
	return `${text}\n\nYou can send the request again, or narrow it into a smaller batch.`;
}
function loadSessionEntryForKey(cfg, agentId, sessionKey) {
	try {
		return loadSessionStore(resolveStorePath(cfg.session?.store, { agentId }))[sessionKey];
	} catch {
		return;
	}
}
function startProgressNudgeRunner(opts) {
	const deps = opts.deps ?? {};
	const now = deps.now ?? (() => Date.now());
	const listActiveSessionKeys = deps.listActiveSessionKeys ?? listActiveReplyRunSessionKeys;
	const resolveStartedAt = deps.resolveStartedAt ?? resolveActiveReplyRunStartedAt;
	const resolveThreadId = deps.resolveThreadId ?? resolveActiveReplyRunThreadId;
	const getRunPhase = deps.getRunPhase ?? ((sessionKey) => replyRunRegistry.get(sessionKey)?.phase);
	const resolveActiveSessionId = deps.resolveActiveSessionId ?? ((sessionKey) => replyRunRegistry.resolveSessionId(sessionKey));
	const resolveRunSessionId = deps.resolveRunSessionId ?? ((runId) => getAgentRunContext(runId)?.sessionId);
	const subscribeAgentEvents = deps.subscribeAgentEvents ?? onAgentEvent;
	const subscribeTerminal = deps.subscribeTerminal ?? onReplyRunTerminal;
	const resolveDeliveryTarget = deps.resolveDeliveryTarget ?? resolveHeartbeatDeliveryTargetWithSessionRoute;
	const channelSupportsEdit = deps.channelSupportsEdit ?? ((params) => channelDeclaresMessageAction({
		cfg: params.cfg,
		channel: params.channel,
		action: "edit"
	}));
	const sendMessage = deps.sendMessage ?? sendDurableMessageBatch;
	const editMessage = deps.editMessage ?? (async (params) => {
		return await dispatchChannelMessageAction({
			cfg: params.cfg,
			channel: params.channel,
			action: "edit",
			params: {
				channelId: params.to,
				to: params.to,
				threadId: params.threadId,
				messageId: params.messageId,
				content: params.text,
				text: params.text,
				message: params.text
			},
			accountId: params.accountId,
			sessionKey: params.sessionKey,
			agentId: params.agentId
		}) !== null;
	});
	const state = {
		cfg: opts.cfg ?? getRuntimeConfig(),
		runtime: opts.runtime ?? defaultRuntime,
		resolved: resolveProgressNudgeConfig(opts.cfg ?? getRuntimeConfig()),
		nudges: /* @__PURE__ */ new Map(),
		timer: null,
		stopped: false,
		noEditChannelsLogged: /* @__PURE__ */ new Set()
	};
	let overflowWarned = false;
	const getOrCreateNudgeState = (sessionKey, runStartedAtMs, nowMs = now()) => {
		let entry = state.nudges.get(sessionKey);
		if (!entry) {
			entry = {
				nudgeCount: 0,
				errorNudgeSent: false,
				runStartedAtMs
			};
			state.nudges.set(sessionKey, entry);
			return entry;
		}
		if (entry.anchorRetainUntilMs !== void 0 && nowMs >= entry.anchorRetainUntilMs) {
			entry.anchorMessageId = void 0;
			entry.anchorRetainUntilMs = void 0;
		}
		if (runStartedAtMs !== void 0) {
			if (entry.runStartedAtMs !== void 0 && entry.runStartedAtMs !== runStartedAtMs) {
				entry.lastNudgeSentAtMs = void 0;
				entry.nudgeCount = 0;
				entry.errorNudgeSent = false;
				entry.progressText = void 0;
			}
			entry.runStartedAtMs = runStartedAtMs;
		}
		return entry;
	};
	const deliverNudge = async (params) => {
		const { sessionKey, kind, text, threadIdOverride, nudgeState } = params;
		const agentId = resolveAgentIdFromSessionKey(sessionKey) || resolveDefaultAgentId(state.cfg);
		const entry = loadSessionEntryForKey(state.cfg, agentId, sessionKey);
		const delivery = await resolveDeliveryTarget({
			cfg: state.cfg,
			agentId,
			entry,
			heartbeat: { target: "last" },
			currentSessionKey: sessionKey
		});
		if (delivery.channel === "none" || !delivery.to) {
			log$1.info("progress-nudge: no deliverable target", {
				sessionKey,
				reason: delivery.reason
			});
			return;
		}
		if (kind === "progress" && !channelSupportsEdit({
			cfg: state.cfg,
			channel: delivery.channel
		})) {
			if (!state.noEditChannelsLogged.has(delivery.channel)) {
				state.noEditChannelsLogged.add(delivery.channel);
				log$1.info("progress-nudge: channel cannot edit messages; suppressing in-turn nudges", {
					sessionKey,
					channel: delivery.channel
				});
			}
			return;
		}
		const threadId = threadIdOverride ?? resolveThreadId(sessionKey) ?? delivery.threadId;
		if (nudgeState?.anchorMessageId) {
			try {
				if (await editMessage({
					cfg: state.cfg,
					channel: delivery.channel,
					to: delivery.to,
					accountId: delivery.accountId,
					threadId,
					messageId: nudgeState.anchorMessageId,
					text,
					sessionKey,
					agentId
				})) {
					log$1.info("progress-nudge: delivered", {
						sessionKey,
						mode: "edit",
						channel: delivery.channel,
						threadId,
						messageId: nudgeState.anchorMessageId,
						nudgeCount: nudgeState.nudgeCount
					});
					return;
				}
			} catch (err) {
				log$1.debug("progress-nudge: anchor edit failed; sending a replacement", {
					sessionKey,
					error: err instanceof Error ? err.message : String(err)
				});
			}
			nudgeState.anchorMessageId = void 0;
		}
		const outboundSession = buildOutboundSessionContext({
			cfg: state.cfg,
			agentId,
			sessionKey
		});
		const result = await sendMessage({
			cfg: state.cfg,
			channel: delivery.channel,
			to: delivery.to,
			accountId: delivery.accountId,
			threadId,
			payloads: [{
				text,
				...kind === "progress" ? { isStatusNotice: true } : {}
			}],
			session: outboundSession
		});
		if (result.status === "failed" || result.status === "partial_failed") {
			log$1.warn("progress-nudge: delivery failed", {
				sessionKey,
				channel: delivery.channel
			});
			return;
		}
		const messageId = result.receipt?.primaryPlatformMessageId ?? result.results.find((item) => typeof item.messageId === "string")?.messageId;
		if (messageId && nudgeState) nudgeState.anchorMessageId = messageId;
		if (result.status === "sent") log$1.info("progress-nudge: delivered", {
			sessionKey,
			mode: "send",
			channel: delivery.channel,
			threadId,
			messageId,
			nudgeCount: nudgeState?.nudgeCount
		});
	};
	const maybeNudgeSession = async (sessionKey, nowMs) => {
		const startedAt = resolveStartedAt(sessionKey);
		if (startedAt === void 0) return;
		if (nowMs - startedAt < state.resolved.thresholdMs) return;
		const entry = getOrCreateNudgeState(sessionKey, startedAt, nowMs);
		if (entry.nudgeCount >= state.resolved.maxNudges) return;
		if (entry.lastNudgeSentAtMs !== void 0 && nowMs - entry.lastNudgeSentAtMs < state.resolved.intervalMs) return;
		if (!isWithinActiveHours(state.cfg, { activeHours: state.resolved.activeHours }, nowMs)) return;
		const phase = getRunPhase(sessionKey);
		if (phase === "completed" || phase === "failed" || phase === "aborted") return;
		entry.lastNudgeSentAtMs = nowMs;
		entry.nudgeCount += 1;
		await deliverNudge({
			sessionKey,
			kind: "progress",
			text: renderProgressText(entry.progressText),
			nudgeState: entry
		});
	};
	const tick = async () => {
		if (state.stopped || !state.resolved.enabled || state.resolved.target === "none") return;
		const nowMs = now();
		const activeKeys = new Set(listActiveSessionKeys());
		for (const [key, entry] of state.nudges) if (!activeKeys.has(key) && (!entry.anchorMessageId || entry.anchorRetainUntilMs === void 0 || nowMs >= entry.anchorRetainUntilMs)) state.nudges.delete(key);
		for (const sessionKey of activeKeys) try {
			await maybeNudgeSession(sessionKey, nowMs);
		} catch (err) {
			log$1.error("progress-nudge: tick failed", {
				sessionKey,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	};
	const scheduleNext = () => {
		if (state.stopped) return;
		if (state.timer) {
			clearTimeout(state.timer);
			state.timer = null;
		}
		if (!state.resolved.enabled || state.resolved.target === "none") return;
		const rawDelay = resolveTickMs(state.resolved);
		if (rawDelay > 2147483647 && !overflowWarned) {
			overflowWarned = true;
			log$1.warn("progress-nudge: tick delay exceeds Node setTimeout cap; clamping", {
				rawDelayMs: rawDelay,
				clampedMs: MAX_SAFE_TIMEOUT_DELAY_MS
			});
		}
		const delay = resolveSafeTimeoutDelayMs(rawDelay, { minMs: 1e3 });
		state.timer = setTimeout(() => {
			state.timer = null;
			tick().finally(() => scheduleNext());
		}, delay);
		state.timer.unref?.();
	};
	const handleTerminal = (evt) => {
		const entry = getOrCreateNudgeState(evt.sessionKey, Number.isFinite(evt.startedAt) ? evt.startedAt : void 0);
		if (evt.result?.kind === "completed") {
			entry.anchorMessageId = void 0;
			entry.anchorRetainUntilMs = void 0;
		} else entry.anchorRetainUntilMs = now() + PROGRESS_NUDGE_ANCHOR_RETENTION_MS;
		const wentLong = (Number.isFinite(evt.startedAt) ? now() - evt.startedAt : 0) >= state.resolved.thresholdMs || entry.nudgeCount > 0;
		const isFailure = evt.result?.kind === "failed" && evt.result.code !== "aborted_by_user";
		const alreadySent = entry.errorNudgeSent;
		const deliveryOn = state.resolved.enabled && state.resolved.target !== "none";
		if (isFailure && wentLong && !alreadySent && deliveryOn) {
			entry.errorNudgeSent = true;
			deliverNudge({
				sessionKey: evt.sessionKey,
				kind: "failure",
				text: renderErrorText(),
				threadIdOverride: evt.routeThreadId,
				nudgeState: entry
			}).catch((err) => {
				log$1.error("progress-nudge: error-nudge delivery failed", {
					sessionKey: evt.sessionKey,
					error: err instanceof Error ? err.message : String(err)
				});
			});
		}
	};
	const handleAgentEvent = (evt) => {
		if (!evt.sessionKey || evt.stream !== "item" && evt.stream !== "tool") return;
		const activeSessionId = resolveActiveSessionId(evt.sessionKey);
		const runSessionId = resolveRunSessionId(evt.runId);
		if (activeSessionId && runSessionId && activeSessionId !== runSessionId) return;
		const kind = evt.data?.kind;
		const progressText = typeof evt.data?.progressText === "string" ? evt.data.progressText : void 0;
		const meta = typeof evt.data?.meta === "string" ? evt.data.meta : void 0;
		const title = typeof evt.data?.title === "string" ? evt.data.title : void 0;
		const text = sanitizeNudgeProgressText(kind === "command" ? meta : progressText ?? meta ?? title);
		if (text === void 0) return;
		getOrCreateNudgeState(evt.sessionKey).progressText = text;
	};
	const updateConfig = (cfg) => {
		if (state.stopped) return;
		state.cfg = cfg;
		const wasEnabled = state.resolved.enabled;
		state.resolved = resolveProgressNudgeConfig(cfg);
		if (state.resolved.enabled !== wasEnabled) log$1.info(state.resolved.enabled ? "progress-nudge: enabled" : "progress-nudge: disabled", {
			thresholdMs: state.resolved.thresholdMs,
			intervalMs: state.resolved.intervalMs,
			maxNudges: state.resolved.maxNudges
		});
		scheduleNext();
	};
	const unsubscribeAgentEvents = subscribeAgentEvents(handleAgentEvent);
	const unsubscribeTerminal = subscribeTerminal(handleTerminal);
	const cleanup = () => {
		if (state.stopped) return;
		state.stopped = true;
		unsubscribeAgentEvents();
		unsubscribeTerminal();
		if (state.timer) clearTimeout(state.timer);
		state.timer = null;
		state.nudges.clear();
		state.noEditChannelsLogged.clear();
	};
	opts.abortSignal?.addEventListener("abort", cleanup, { once: true });
	scheduleNext();
	return {
		stop: cleanup,
		updateConfig
	};
}
//#endregion
//#region src/infra/session-maintenance-sweep-runner.ts
const log = createSubsystemLogger("gateway/session-maintenance-sweep");
function logSweepSummary(logger, summary) {
	logger.info("session maintenance sweep", {
		agentId: summary.agentId,
		storePath: summary.storePath,
		mode: summary.mode,
		dryRun: summary.dryRun,
		beforeCount: summary.beforeCount,
		afterCount: summary.afterCount,
		pruned: summary.pruned,
		capped: summary.capped,
		diskBudget: summary.diskBudget ? {
			totalBytesBefore: summary.diskBudget.totalBytesBefore,
			totalBytesAfter: summary.diskBudget.totalBytesAfter,
			maxBytes: summary.diskBudget.maxBytes,
			overBudget: summary.diskBudget.overBudget
		} : null,
		unreferencedArtifacts: {
			removedFiles: summary.unreferencedArtifacts.removedFiles,
			freedBytes: summary.unreferencedArtifacts.freedBytes
		},
		wouldMutate: summary.wouldMutate
	});
}
function startSessionMaintenanceSweepRunner(opts) {
	const runCleanup = opts.deps?.runCleanup ?? runSessionsCleanup;
	const resolveTargets = opts.deps?.resolveTargets ?? resolveSessionStoreTargets;
	const logger = opts.deps?.log ?? log;
	const intervalMs = opts.deps?.intervalMs ?? 36e5;
	const state = {
		cfg: opts.cfg,
		stopped: false
	};
	const getConfig = opts.deps?.getConfig ?? (() => state.cfg);
	let inFlight = null;
	const sweepTarget = async (cfg, target) => {
		try {
			const result = await runCleanup({
				cfg,
				opts: { dryRun: true },
				targets: [target]
			});
			for (const { summary } of result.previewResults) logSweepSummary(logger, summary);
		} catch (err) {
			logger.error("session maintenance sweep failed for store", {
				agentId: target.agentId,
				storePath: target.storePath,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	};
	const tick = () => {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			let cfg;
			let targets;
			try {
				cfg = getConfig();
				targets = resolveTargets(cfg, { allAgents: true });
			} catch (err) {
				logger.error("session maintenance sweep failed to resolve stores", { error: err instanceof Error ? err.message : String(err) });
				return;
			}
			for (const target of targets) await sweepTarget(cfg, target);
		})().finally(() => {
			inFlight = null;
		});
		return inFlight;
	};
	const interval = setInterval(() => {
		if (!state.stopped) tick();
	}, intervalMs);
	interval.unref?.();
	tick();
	return {
		stop: () => {
			state.stopped = true;
			clearInterval(interval);
		},
		updateConfig: (cfg) => {
			state.cfg = cfg;
		}
	};
}
//#endregion
//#region src/gateway/server-runtime-services.ts
/** Starts cron without making gateway startup wait for cron initialization. */
function startGatewayCronWithLogging(params) {
	params.cron.start().catch((err) => params.logCron.error(`failed to start: ${String(err)}`));
}
function clearGatewayMaintenanceHandles(maintenance) {
	if (!maintenance) return;
	clearInterval(maintenance.tickInterval);
	clearInterval(maintenance.healthInterval);
	clearInterval(maintenance.dedupeCleanup);
	if (maintenance.mediaCleanup) clearInterval(maintenance.mediaCleanup);
}
/** Runs maintenance that is intentionally delayed until after the gateway is ready. */
async function runGatewayPostReadyMaintenance(params) {
	try {
		const maintenance = await params.startMaintenance();
		if (maintenance) params.applyMaintenance(maintenance);
	} catch (err) {
		params.log.warn(`gateway post-ready maintenance startup failed: ${String(err)}`);
	}
	if (params.shouldStartCron()) {
		params.markCronStartHandled();
		startGatewayCronWithLogging({
			cron: params.cron,
			logCron: params.logCron
		});
	}
	params.recordPostReadyMemory();
}
/** Schedules post-ready maintenance and cancels/cleans handles if shutdown wins the race. */
function scheduleGatewayPostReadyMaintenance(params) {
	const timer = setTimeout(() => {
		params.onStarted?.();
		if (params.isClosing()) return;
		runGatewayPostReadyMaintenance({
			startMaintenance: async () => {
				if (params.isClosing()) return null;
				const maintenance = await params.startMaintenance();
				if (params.isClosing()) {
					clearGatewayMaintenanceHandles(maintenance);
					return null;
				}
				return maintenance;
			},
			applyMaintenance: (maintenance) => {
				if (params.isClosing()) {
					clearGatewayMaintenanceHandles(maintenance);
					return;
				}
				params.applyMaintenance(maintenance);
			},
			shouldStartCron: () => !params.isClosing() && params.shouldStartCron(),
			markCronStartHandled: params.markCronStartHandled,
			cron: params.cron,
			logCron: params.logCron,
			log: params.log,
			recordPostReadyMemory: () => {
				if (!params.isClosing()) params.recordPostReadyMemory();
			}
		});
	}, params.delayMs);
	timer.unref?.();
	return timer;
}
function recoverPendingOutboundDeliveries(params) {
	(async () => {
		const { recoverPendingDeliveries } = await import("./delivery-queue-BFYpFfo9.js");
		const { deliverOutboundPayloadsInternal } = await import("./deliver-CqcDcUOn.js");
		await recoverPendingDeliveries({
			deliver: deliverOutboundPayloadsInternal,
			log: params.log.child("delivery-recovery"),
			cfg: params.cfg
		});
	})().catch((err) => params.log.error(`Delivery recovery failed: ${String(err)}`));
}
function recoverPendingFollowupMessages(params) {
	(async () => {
		const { recoverPendingFollowupReplays } = await import("./followup-replay-recovery-Cp7Mh9jj.js");
		const logRecovery = params.log.child("followup-recovery");
		await recoverPendingFollowupReplays({
			cfg: params.cfg,
			log: logRecovery
		});
	})().catch((err) => params.log.error(`Followup recovery failed: ${String(err)}`));
}
function recoverPendingSessionDeliveries(params) {
	setTimeout(() => {
		(async () => {
			const { recoverPendingRestartContinuationDeliveries } = await import("./server-restart-sentinel-BIAu8T9s.js");
			const logRecovery = params.log.child("session-delivery-recovery");
			await recoverPendingRestartContinuationDeliveries({
				deps: params.deps,
				log: logRecovery,
				maxEnqueuedAt: params.maxEnqueuedAt
			});
		})().catch((err) => params.log.error(`Session delivery recovery failed: ${String(err)}`));
	}, 1250).unref?.();
}
function startGatewayModelPricingRefreshOnDemand(params) {
	if (!isGatewayModelPricingEnabled(params.config)) return () => {};
	let stopped = false;
	let stopRefresh;
	(async () => {
		const { startGatewayModelPricingRefresh } = await import("./model-pricing-cache-BVZIL-Oq.js");
		if (stopped) return;
		stopRefresh = startGatewayModelPricingRefresh({
			config: params.config,
			...params.pluginLookUpTable ? { pluginLookUpTable: params.pluginLookUpTable } : {}
		});
		if (stopped) {
			stopRefresh();
			stopRefresh = void 0;
		}
	})().catch((err) => params.log.error(`Model pricing refresh failed to start: ${String(err)}`));
	return () => {
		stopped = true;
		stopRefresh?.();
		stopRefresh = void 0;
	};
}
/** Activates background gateway services after core runtime startup is ready. */
function activateGatewayScheduledServices(params) {
	if (params.minimalTestGateway) return {
		heartbeatRunner: createNoopHeartbeatRunner(),
		stopModelPricingRefresh: () => {}
	};
	const heartbeatRunnerHandle = startHeartbeatRunner({ cfg: params.cfgAtStart });
	const progressNudgeRunner = startProgressNudgeRunner({ cfg: params.cfgAtStart });
	const sessionMaintenanceSweepRunner = !isVitestRuntimeEnv() ? startSessionMaintenanceSweepRunner({
		cfg: params.cfgAtStart,
		deps: { getConfig: () => getRuntimeConfig() }
	}) : {
		stop: () => {},
		updateConfig: () => {}
	};
	const heartbeatRunner = {
		stop: () => {
			heartbeatRunnerHandle.stop();
			progressNudgeRunner.stop();
			sessionMaintenanceSweepRunner.stop();
		},
		updateConfig: (cfg) => {
			heartbeatRunnerHandle.updateConfig(cfg);
			progressNudgeRunner.updateConfig(cfg);
			sessionMaintenanceSweepRunner.updateConfig(cfg);
		}
	};
	if (params.startCron !== false) startGatewayCronWithLogging({
		cron: params.cron,
		logCron: params.logCron
	});
	recoverPendingOutboundDeliveries({
		cfg: params.cfgAtStart,
		log: params.log
	});
	recoverPendingFollowupMessages({
		cfg: params.cfgAtStart,
		log: params.log
	});
	recoverPendingSessionDeliveries({
		deps: params.deps,
		log: params.log,
		maxEnqueuedAt: params.sessionDeliveryRecoveryMaxEnqueuedAt
	});
	return {
		heartbeatRunner,
		stopModelPricingRefresh: !isVitestRuntimeEnv() ? startGatewayModelPricingRefreshOnDemand({
			config: params.cfgAtStart,
			...params.pluginLookUpTable ? { pluginLookUpTable: params.pluginLookUpTable } : {},
			log: params.log
		}) : () => {}
	};
}
//#endregion
export { startGatewayCronWithLogging as i, runGatewayPostReadyMaintenance as n, scheduleGatewayPostReadyMaintenance as r, activateGatewayScheduledServices as t };
