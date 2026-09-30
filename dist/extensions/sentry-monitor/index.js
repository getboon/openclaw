import { t as definePluginEntry } from "../../plugin-entry-BZpzqykQ.js";
import * as os$1 from "node:os";
import * as Sentry from "@sentry/node";
//#region extensions/sentry-monitor/src/format.ts
function safe(logger, pluginId, hook, fn) {
	try {
		fn();
	} catch (err) {
		logger.error(`${pluginId}: handler for ${hook} threw — ${stringifyErr(err)}`);
	}
}
function describeModelCallError(event) {
	const parts = [
		event.errorClass,
		event.httpStatus ? `http_status=${event.httpStatus}` : void 0,
		event.errorCategory,
		event.failureKind ? `failure_kind=${event.failureKind}` : void 0
	].filter(Boolean);
	return parts.length > 0 ? `model_call_ended: ${parts.join(", ")}` : "model_call_ended outcome=error";
}
function runContext(runId, sessionId, callId) {
	if (!runId && !sessionId && !callId) return;
	return {
		run_id: runId,
		session_id: sessionId,
		call_id: callId
	};
}
function pruneTags(tags) {
	const out = {};
	for (const [k, v] of Object.entries(tags)) if (v !== void 0 && v !== null && v !== "") out[k] = v;
	return out;
}
function fingerprintOf(...parts) {
	return parts.filter((part) => part !== void 0 && part !== null && part !== "").map(String);
}
const FINGERPRINT_UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FINGERPRINT_ISO_TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?\b/g;
const FINGERPRINT_SHORT_DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{1,2}:\d{2}\b/g;
const FINGERPRINT_DIMENSIONS_RE = /\b\d+\s*x\s*\d+\b/gi;
const FINGERPRINT_PATH_RE = /(?:[~.]{0,2}\/[\w.-]+){2,}/g;
const FINGERPRINT_FILENAME_RE = /\b[\w-]+\.[A-Za-z0-9]{1,6}\b/g;
const FINGERPRINT_NUMBER_RE = /\b\d[\d,]*\b/g;
/**
* Scrubs volatile tokens from free-form error text before it enters a Sentry
* fingerprint, so the *same kind* of failure recurring with a different path,
* id, timestamp, or byte count still lands in one issue. The raw text is
* untouched everywhere else (exception message, `extra`) — only the
* fingerprint input is normalized, so issue titles stay readable.
*/
function normalizeFingerprintText(text) {
	return text.replaceAll(FINGERPRINT_UUID_RE, "<uuid>").replaceAll(FINGERPRINT_ISO_TIMESTAMP_RE, "<ts>").replaceAll(FINGERPRINT_SHORT_DATE_RE, "<ts>").replaceAll(FINGERPRINT_DIMENSIONS_RE, "<dim>").replaceAll(FINGERPRINT_PATH_RE, "<path>").replaceAll(FINGERPRINT_FILENAME_RE, "<file>").replaceAll(FINGERPRINT_NUMBER_RE, "<n>");
}
function stringifyErr(err) {
	if (err instanceof Error) return err.message;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}
//#endregion
//#region extensions/sentry-monitor/src/captures.ts
function buildModelCallEndedCapture(event, host) {
	if (event.outcome !== "error") return null;
	return {
		kind: "exception",
		message: describeModelCallError(event),
		tags: pruneTags({
			hook: "model_call_ended",
			host,
			provider: event.provider,
			model: event.model,
			api: event.api,
			transport: event.transport,
			failure_kind: event.failureKind,
			error_category: event.errorCategory,
			error_class: event.errorClass
		}),
		fingerprint: fingerprintOf("model_call_ended", event.provider, event.model, event.errorClass, event.httpStatus, event.failureKind, event.errorCategory),
		contexts: { run: runContext(event.runId, event.sessionId, event.callId) },
		extra: {
			duration_ms: event.durationMs,
			ttfb_ms: event.timeToFirstByteMs,
			request_payload_bytes: event.requestPayloadBytes,
			response_stream_bytes: event.responseStreamBytes,
			http_status: event.httpStatus,
			upstream_request_id_hash: event.upstreamRequestIdHash
		}
	};
}
function buildAgentEndCapture(event, host, ctx) {
	if (event.success) return null;
	return {
		kind: "exception",
		message: event.error ?? "agent_end success=false",
		tags: pruneTags({
			hook: "agent_end",
			host,
			run_id: event.runId,
			session_id: ctx?.sessionId,
			agent_id: ctx?.agentId
		}),
		fingerprint: fingerprintOf("agent_end", event.error ? normalizeFingerprintText(event.error) : "success=false"),
		contexts: { run: runContext(event.runId, ctx?.sessionId) },
		extra: {
			duration_ms: event.durationMs,
			message_count: Array.isArray(event.messages) ? event.messages.length : void 0
		}
	};
}
function buildAfterToolCallCapture(event, host) {
	if (!event.error) return null;
	if (event.errorKind === "denied") return null;
	const tags = pruneTags({
		hook: "after_tool_call",
		host,
		tool: event.toolName,
		error_kind: event.errorKind,
		error_code: event.errorCode,
		exit_code: typeof event.exitCode === "number" ? String(event.exitCode) : void 0
	});
	const fingerprint = fingerprintOf("after_tool_call", event.toolName, event.errorKind, event.errorCode ?? event.exitCode ?? normalizeFingerprintText(event.error));
	const contexts = { run: runContext(event.runId) };
	const extra = {
		tool_call_id: event.toolCallId,
		duration_ms: event.durationMs
	};
	if (event.errorKind === "invalid-input") return {
		kind: "message",
		level: "warning",
		message: event.error,
		tags,
		fingerprint,
		contexts,
		extra
	};
	return {
		kind: "exception",
		message: event.error,
		tags,
		fingerprint,
		contexts,
		extra
	};
}
/**
* A `before_tool_call` hook threw. Unlike `after_tool_call`, this hook is fired
* by the host ONLY on the `kind: "failure"` path — never for a deliberate policy
* veto — so there is deliberately no `denied`-style suppression branch here:
* every event that reaches this builder is a real, actionable defect. Never
* returns null.
*/
function buildBeforeToolCallHookFailedCapture(event, host) {
	return {
		kind: "exception",
		message: event.error,
		tags: pruneTags({
			hook: "before_tool_call_hook_failed",
			host,
			tool: event.toolName
		}),
		fingerprint: fingerprintOf("before_tool_call_hook_failed", event.toolName, normalizeFingerprintText(event.error)),
		contexts: { run: runContext(event.runId, event.sessionId) },
		extra: {
			tool_call_id: event.toolCallId,
			session_key: event.sessionKey
		}
	};
}
function buildMessageSentCapture(event, host) {
	if (event.success) return null;
	return {
		kind: "exception",
		message: event.error ?? "message_sent success=false",
		tags: pruneTags({
			hook: "message_sent",
			host
		}),
		fingerprint: fingerprintOf("message_sent", event.error ? normalizeFingerprintText(event.error) : "success=false"),
		contexts: { run: runContext(event.runId, event.sessionKey) },
		extra: {
			message_id: event.messageId,
			trace_id: event.traceId,
			span_id: event.spanId
		}
	};
}
function buildSubagentEndedCapture(event, host) {
	if (event.outcome === "ok" || event.outcome === void 0) return null;
	return {
		kind: "exception",
		message: event.error ?? `subagent_ended outcome=${event.outcome}`,
		tags: pruneTags({
			hook: "subagent_ended",
			host,
			outcome: event.outcome,
			target_kind: event.targetKind
		}),
		fingerprint: fingerprintOf("subagent_ended", event.outcome, event.targetKind, event.error ? normalizeFingerprintText(event.error) : `outcome=${event.outcome}`),
		contexts: { run: runContext(event.runId) },
		extra: {
			target_session_key: event.targetSessionKey,
			reason: event.reason,
			ended_at: event.endedAt
		}
	};
}
function buildCronChangedCapture(event, host) {
	const hasRunError = event.status === "error";
	const hasDeliveryFailure = event.deliveryStatus === "not-delivered" || Boolean(event.deliveryError);
	if (!hasRunError && !hasDeliveryFailure) return null;
	const message = event.error || event.deliveryError || `cron_changed status=${event.status ?? "unknown"} delivery=${event.deliveryStatus ?? "unknown"}`;
	return {
		kind: "exception",
		message,
		tags: pruneTags({
			hook: "cron_changed",
			host,
			action: event.action,
			status: event.status,
			delivery_status: event.deliveryStatus
		}),
		fingerprint: fingerprintOf("cron_changed", event.action, event.status, event.deliveryStatus, normalizeFingerprintText(message)),
		contexts: { run: runContext(event.runId, event.sessionId) },
		extra: {
			job_id: event.jobId,
			agent_id: event.agentId,
			duration_ms: event.durationMs,
			delivery_error: event.deliveryError,
			model: event.model,
			provider: event.provider
		}
	};
}
function buildDeliveryRecoveryExhaustedCapture(event, host) {
	return {
		kind: "exception",
		message: event.error,
		tags: pruneTags({
			hook: "delivery_recovery_exhausted",
			host,
			queue: event.queueName,
			channel: event.channel,
			recovery_state: event.recoveryState
		}),
		fingerprint: fingerprintOf("delivery_recovery_exhausted", event.queueName, event.channel, event.recoveryState),
		extra: {
			delivery_id: event.deliveryId,
			to: event.to,
			account_id: event.accountId,
			session_key: event.sessionKey,
			retry_count: event.retryCount
		}
	};
}
function buildSessionEndCapture(event, host) {
	const reason = event.reason ?? "unknown";
	if (reason !== "unknown") return null;
	return {
		kind: "message",
		message: "session_end reason=unknown",
		level: "warning",
		tags: pruneTags({
			hook: "session_end",
			host,
			reason
		}),
		fingerprint: fingerprintOf("session_end", reason),
		extra: {
			session_id: event.sessionId,
			message_count: event.messageCount,
			duration_ms: event.durationMs,
			transcript_archived: event.transcriptArchived
		}
	};
}
//#endregion
//#region extensions/sentry-monitor/src/dispatch.ts
/** Send a capture descriptor to the client. No-op for null (ignored events). */
function dispatchCapture(client, capture) {
	if (!capture) return;
	const scope = {
		tags: capture.tags,
		contexts: capture.contexts,
		extra: capture.extra,
		fingerprint: capture.fingerprint
	};
	if (capture.kind === "exception") {
		client.captureException(new Error(capture.message), scope);
		return;
	}
	client.captureMessage(capture.message, {
		...scope,
		level: capture.level
	});
}
//#endregion
//#region extensions/sentry-monitor/src/register.ts
const PLUGIN_ID = "sentry-monitor";
function registerSentryMonitor(api) {
	const cfg = api.pluginConfig ?? {};
	const dsn = cfg.dsn || process.env.BOON_SENTRY_DSN;
	if (!dsn) {
		api.logger.warn(`${PLUGIN_ID}: BOON_SENTRY_DSN unset and no plugin-config dsn; plugin inactive`);
		return;
	}
	const hostname = os$1.hostname();
	const environment = cfg.environment || hostname;
	const deployTags = {};
	const boonSkillsRef = process.env.BOON_SKILLS_REF;
	if (boonSkillsRef) deployTags.boon_skills_ref = boonSkillsRef;
	const deployWave = process.env.DEPLOY_WAVE || process.env.WAVE;
	if (deployWave) deployTags.wave = deployWave;
	const tenantAccountId = process.env.BOON_TENANT_ACCOUNT_ID;
	if (tenantAccountId) deployTags.trial_account_id = tenantAccountId;
	Sentry.init({
		dsn,
		environment,
		release: typeof api.hostVersion === "string" ? api.hostVersion : void 0,
		tracesSampleRate: typeof cfg.tracesSampleRate === "number" && Number.isFinite(cfg.tracesSampleRate) ? cfg.tracesSampleRate : 0,
		defaultIntegrations: false,
		integrations: [
			Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
			Sentry.onUnhandledRejectionIntegration({ mode: "warn" }),
			Sentry.linkedErrorsIntegration({
				key: "cause",
				limit: 5
			}),
			Sentry.contextLinesIntegration()
		]
	});
	if (Object.keys(deployTags).length > 0) Sentry.setTags(deployTags);
	api.logger.info(`${PLUGIN_ID}: Sentry initialized (environment=${environment}${api.hostVersion ? `, release=${api.hostVersion}` : ""})`);
	const allowedHooks = Array.isArray(cfg.hooks) ? new Set(cfg.hooks) : null;
	const hookEnabled = (name) => allowedHooks === null || allowedHooks.has(name);
	if (hookEnabled("model_call_ended")) api.on("model_call_ended", (event) => {
		safe(api.logger, PLUGIN_ID, "model_call_ended", () => {
			dispatchCapture(Sentry, buildModelCallEndedCapture(event, hostname));
		});
	});
	if (hookEnabled("agent_end")) api.on("agent_end", (event, ctx) => {
		safe(api.logger, PLUGIN_ID, "agent_end", () => {
			dispatchCapture(Sentry, buildAgentEndCapture(event, hostname, ctx));
		});
	});
	if (hookEnabled("after_tool_call")) api.on("after_tool_call", (event) => {
		safe(api.logger, PLUGIN_ID, "after_tool_call", () => {
			dispatchCapture(Sentry, buildAfterToolCallCapture(event, hostname));
		});
	});
	if (hookEnabled("before_tool_call_hook_failed")) api.on("before_tool_call_hook_failed", (event) => {
		safe(api.logger, PLUGIN_ID, "before_tool_call_hook_failed", () => {
			dispatchCapture(Sentry, buildBeforeToolCallHookFailedCapture(event, hostname));
		});
	});
	if (hookEnabled("message_sent")) api.on("message_sent", (event) => {
		safe(api.logger, PLUGIN_ID, "message_sent", () => {
			dispatchCapture(Sentry, buildMessageSentCapture(event, hostname));
		});
	});
	if (hookEnabled("delivery_recovery_exhausted")) api.on("delivery_recovery_exhausted", (event) => {
		safe(api.logger, PLUGIN_ID, "delivery_recovery_exhausted", () => {
			dispatchCapture(Sentry, buildDeliveryRecoveryExhaustedCapture(event, hostname));
		});
	});
	if (hookEnabled("subagent_ended")) api.on("subagent_ended", (event) => {
		safe(api.logger, PLUGIN_ID, "subagent_ended", () => {
			dispatchCapture(Sentry, buildSubagentEndedCapture(event, hostname));
		});
	});
	if (hookEnabled("cron_changed")) api.on("cron_changed", (event) => {
		safe(api.logger, PLUGIN_ID, "cron_changed", () => {
			dispatchCapture(Sentry, buildCronChangedCapture(event, hostname));
		});
	});
	if (hookEnabled("session_end")) api.on("session_end", (event) => {
		safe(api.logger, PLUGIN_ID, "session_end", () => {
			dispatchCapture(Sentry, buildSessionEndCapture(event, hostname));
		});
	});
	api.lifecycle.registerRuntimeLifecycle({
		id: `${PLUGIN_ID}/sentry-flush`,
		description: "Flush Sentry buffer on plugin / gateway shutdown",
		cleanup: async () => {
			await Sentry.close(2e3);
		}
	});
}
//#endregion
//#region extensions/sentry-monitor/index.ts
var sentry_monitor_default = definePluginEntry({
	id: PLUGIN_ID,
	name: "Sentry Monitor",
	description: "Forwards every error-bearing OpenClaw lifecycle event to Sentry: model calls, agent turns, tool calls, message deliveries, subagents, cron runs, and abnormal session terminations. Also captures node-level uncaught exceptions / unhandled rejections.",
	register: (api) => registerSentryMonitor(api)
});
//#endregion
export { sentry_monitor_default as default };
