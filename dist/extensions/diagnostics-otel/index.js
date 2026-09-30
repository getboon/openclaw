import { c as redactSensitiveText } from "../../redact-BFQyU94D.js";
import { d as registerUnhandledRejectionHandler } from "../../unhandled-rejections-B1liE-w-.js";
import { D as isValidDiagnosticTraceId, E as isValidDiagnosticTraceFlags, T as isValidDiagnosticSpanId, v as waitForDiagnosticEventsDrained } from "../../diagnostic-events-CLCyIzm6.js";
import "../../runtime-env-WTHb2hRn.js";
import { t as definePluginEntry } from "../../plugin-entry-BZpzqykQ.js";
import "../../diagnostic-runtime-BCe2Aywp.js";
import "../../api-DWGjzPRi.js";
import { SpanKind, SpanStatusCode, TraceFlags, context, metrics, trace } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { defaultResource, detectResources, envDetector, hostDetector, osDetector, processDetector, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ATTR_GEN_AI_INPUT_MESSAGES, ATTR_GEN_AI_OUTPUT_MESSAGES, ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, ATTR_GEN_AI_TOOL_DEFINITIONS } from "@opentelemetry/semantic-conventions/incubating";
//#region extensions/diagnostics-otel/src/service.ts
const DEFAULT_SERVICE_NAME = "openclaw";
const DROPPED_OTEL_ATTRIBUTE_KEYS = new Set([
	"openclaw.callId",
	"openclaw.call_id",
	"openclaw.chatId",
	"openclaw.chat_id",
	"openclaw.messageId",
	"openclaw.message_id",
	"openclaw.parentSpanId",
	"openclaw.parent_span_id",
	"openclaw.runId",
	"openclaw.run_id",
	"openclaw.sessionId",
	"openclaw.session_id",
	"openclaw.sessionKey",
	"openclaw.session_key",
	"openclaw.spanId",
	"openclaw.span_id",
	"openclaw.toolCallId",
	"openclaw.tool_call_id",
	"openclaw.traceId",
	"openclaw.trace_id"
]);
const LOW_CARDINALITY_VALUE_RE = /^[A-Za-z0-9_.:-]{1,120}$/u;
const SECURITY_TARGET_NAME_VALUE_RE = /^[A-Za-z0-9@/_.:-]{1,256}$/u;
const MAX_OTEL_CONTENT_ATTRIBUTE_CHARS = 128 * 1024;
const MAX_OTEL_CONTENT_ARRAY_ITEMS = 200;
const MAX_OTEL_LOG_BODY_CHARS = 4 * 1024;
const MAX_OTEL_LOG_ATTRIBUTE_COUNT = 64;
const MAX_OTEL_LOG_ATTRIBUTE_VALUE_CHARS = 4 * 1024;
const LOG_RECORD_EXPORT_FAILURE_REPORT_INTERVAL_MS = 6e4;
const OTEL_LOG_RAW_ATTRIBUTE_KEY_RE = /^[A-Za-z0-9_.:-]{1,64}$/u;
const OTEL_LOG_ATTRIBUTE_KEY_RE = /^[A-Za-z0-9_.:-]{1,96}$/u;
const BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS = new Set([
	"__proto__",
	"prototype",
	"constructor"
]);
const PRELOADED_OTEL_SDK_ENV = "OPENCLAW_OTEL_PRELOADED";
const OTEL_EXPORTER_OTLP_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT";
const OTEL_EXPORTER_OTLP_TRACES_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
const OTEL_EXPORTER_OTLP_METRICS_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT";
const OTEL_EXPORTER_OTLP_LOGS_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT";
const OTEL_SEMCONV_STABILITY_OPT_IN_ENV = "OTEL_SEMCONV_STABILITY_OPT_IN";
const GEN_AI_LATEST_EXPERIMENTAL_OPT_IN = "gen_ai_latest_experimental";
const GEN_AI_TOKEN_USAGE_BUCKETS = [
	1,
	4,
	16,
	64,
	256,
	1024,
	4096,
	16384,
	65536,
	262144,
	1048576,
	4194304,
	16777216,
	67108864
];
const GEN_AI_OPERATION_DURATION_BUCKETS = [
	.01,
	.02,
	.04,
	.08,
	.16,
	.32,
	.64,
	1.28,
	2.56,
	5.12,
	10.24,
	20.48,
	40.96,
	81.92
];
const MAX_RETAINED_TRUSTED_SPAN_CONTEXTS = 1024;
const RETAINED_TRUSTED_SPAN_CONTEXT_TIMEOUT_MS = 5e3;
const NO_CONTENT_CAPTURE = {
	inputMessages: false,
	outputMessages: false,
	toolInputs: false,
	toolOutputs: false,
	systemPrompt: false,
	toolDefinitions: false,
	logBodies: false
};
function normalizeEndpoint(endpoint) {
	const trimmed = endpoint?.trim();
	return trimmed ? trimmed.replace(/\/+$/, "") : void 0;
}
function resolveOtelUrl(endpoint, path) {
	if (!endpoint) return;
	const endpointWithoutQueryOrFragment = endpoint.split(/[?#]/, 1)[0] ?? endpoint;
	if (/\/v1\/(?:traces|metrics|logs)$/i.test(endpointWithoutQueryOrFragment)) return endpoint;
	if (/[?#]/u.test(endpoint)) try {
		const url = new URL(endpoint);
		url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${path}`;
		return url.toString();
	} catch {}
	return `${endpoint}/${path}`;
}
function resolveSignalOtelUrl(params) {
	return resolveOtelUrl(normalizeEndpoint(params.signalEndpoint ?? params.signalEnvEndpoint) ?? params.endpoint, params.path);
}
function resolveSampleRate(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return;
	if (value < 0 || value > 1) return;
	return value;
}
function formatError(err) {
	if (err instanceof Error) return err.stack ?? err.message;
	if (typeof err === "string") return err;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}
function errorCategory(err) {
	try {
		if (err instanceof Error && typeof err.name === "string" && err.name.trim()) return lowCardinalityAttr(err.name, "Error");
		return lowCardinalityAttr(typeof err, "unknown");
	} catch {
		return "unknown";
	}
}
function collectNestedErrorCandidates(err) {
	const queue = [err];
	const seen = /* @__PURE__ */ new Set();
	const candidates = [];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current == null || seen.has(current)) continue;
		seen.add(current);
		candidates.push(current);
		if (Array.isArray(current)) {
			for (const item of current) if (item != null && !seen.has(item)) queue.push(item);
			continue;
		}
		if (typeof current !== "object") continue;
		const record = current;
		for (const nested of [
			record.cause,
			record.reason,
			record.original,
			record.error
		]) if (nested != null && !seen.has(nested)) queue.push(nested);
		if (Array.isArray(record.errors)) {
			for (const nested of record.errors) if (nested != null && !seen.has(nested)) queue.push(nested);
		}
	}
	return candidates;
}
function readErrorName(err) {
	if (!err || typeof err !== "object") return;
	const name = err.name;
	return typeof name === "string" && name.trim() ? name : void 0;
}
function readErrorCode(err) {
	if (!err || typeof err !== "object") return;
	const code = err.code;
	return typeof code === "string" || typeof code === "number" ? code : void 0;
}
function findOtlpExporterError(reason) {
	for (const candidate of collectNestedErrorCandidates(reason)) if (readErrorName(candidate) === "OTLPExporterError" && candidate && typeof candidate === "object") return candidate;
}
function redactOtelAttributes(attributes) {
	const redactedAttributes = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (DROPPED_OTEL_ATTRIBUTE_KEYS.has(key)) continue;
		redactedAttributes[key] = typeof value === "string" ? redactSensitiveText(value) : value;
	}
	return redactedAttributes;
}
function lowCardinalityAttr(value, fallback = "unknown") {
	if (!value) return fallback;
	const redacted = redactSensitiveText(value.trim());
	const redactedLower = redacted.toLowerCase();
	if (redactedLower.startsWith("agent:") || redactedLower.includes(":agent:")) return fallback;
	return LOW_CARDINALITY_VALUE_RE.test(redacted) ? redacted : fallback;
}
function securityTargetNameAttr(value, fallback = "unknown") {
	if (!value) return fallback;
	const redacted = redactSensitiveText(value.trim());
	const redactedLower = redacted.toLowerCase();
	if (redactedLower.startsWith("agent:") || redactedLower.includes(":agent:")) return fallback;
	return SECURITY_TARGET_NAME_VALUE_RE.test(redacted) ? redacted : fallback;
}
function lowCardinalityQueueLaneAttr(value, fallback = "unknown") {
	if (!value) return fallback;
	const redacted = redactSensitiveText(value.trim());
	if (redacted.toLowerCase().startsWith("agent:")) return fallback;
	const scopedLaneIndex = redacted.indexOf(":");
	const lane = scopedLaneIndex >= 0 ? redacted.slice(0, scopedLaneIndex) : redacted;
	return LOW_CARDINALITY_VALUE_RE.test(lane) ? lane : fallback;
}
function shouldCaptureOtelLogBody(policy) {
	return policy.logBodies;
}
function otelLogTimestampIso(timestamp) {
	if (timestamp instanceof Date) return timestamp.toISOString();
	if (typeof timestamp === "number" && Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
	if (Array.isArray(timestamp)) {
		const [seconds, nanoseconds] = timestamp;
		if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) return new Date(seconds * 1e3 + Math.trunc(nanoseconds / 1e6)).toISOString();
	}
	return (/* @__PURE__ */ new Date()).toISOString();
}
function writeStdoutDiagnosticLogRecord(params) {
	const { logRecord, serviceName, traceContext } = params;
	const line = {
		ts: otelLogTimestampIso(logRecord.timestamp),
		signal: "openclaw.diagnostic.log",
		"service.name": serviceName,
		severityText: logRecord.severityText,
		severityNumber: logRecord.severityNumber,
		body: logRecord.body,
		attributes: logRecord.attributes ?? {},
		...traceContext?.traceId ? { trace_id: traceContext.traceId } : {},
		...traceContext?.spanId ? { span_id: traceContext.spanId } : {},
		...traceContext?.traceFlags ? { trace_flags: traceContext.traceFlags } : {}
	};
	process.stdout.write(`${JSON.stringify(line)}\n`);
}
function hasOtelSemconvOptIn(value, optIn) {
	return value?.split(",").map((part) => part.trim()).includes(optIn) ?? false;
}
function emitLatestGenAiSemconv() {
	return hasOtelSemconvOptIn(process.env[OTEL_SEMCONV_STABILITY_OPT_IN_ENV], GEN_AI_LATEST_EXPERIMENTAL_OPT_IN);
}
function genAiOperationName(api) {
	const normalized = api?.trim().toLowerCase();
	if (!normalized) return "chat";
	if (normalized === "completions" || normalized.endsWith("-completions")) return "text_completion";
	if (normalized === "generate_content" || normalized.includes("generative-ai")) return "generate_content";
	return "chat";
}
function positiveFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function assignPositiveNumberAttr(attrs, key, value) {
	const normalized = positiveFiniteNumber(value);
	if (normalized !== void 0) attrs[key] = normalized;
}
function assignModelCallSizeTimingAttrs(attrs, evt) {
	assignPositiveNumberAttr(attrs, "openclaw.model_call.request_bytes", evt.requestPayloadBytes);
	assignPositiveNumberAttr(attrs, "openclaw.model_call.response_bytes", evt.responseStreamBytes);
	assignPositiveNumberAttr(attrs, "openclaw.model_call.time_to_first_byte_ms", evt.timeToFirstByteMs);
}
function assignGenAiSpanIdentityAttrs(attrs, input) {
	if (emitLatestGenAiSemconv()) attrs["gen_ai.provider.name"] = lowCardinalityAttr(input.provider);
	else attrs["gen_ai.system"] = lowCardinalityAttr(input.provider);
	if (input.model) attrs["gen_ai.request.model"] = redactSensitiveText(input.model.trim());
	attrs["gen_ai.operation.name"] = genAiOperationName(input.api);
}
function assignGenAiModelCallAttrs(attrs, evt) {
	assignGenAiSpanIdentityAttrs(attrs, evt);
}
function modelCallSpanName(evt) {
	if (!emitLatestGenAiSemconv()) return "openclaw.model.call";
	return `${genAiOperationName(evt.api)} ${lowCardinalityAttr(evt.model)}`;
}
function modelCallSpanKind() {
	return emitLatestGenAiSemconv() ? SpanKind.CLIENT : void 0;
}
function addUpstreamRequestIdSpanEvent(span, upstreamRequestIdHash) {
	if (!upstreamRequestIdHash) return;
	const boundedHash = lowCardinalityAttr(upstreamRequestIdHash);
	if (boundedHash === "unknown") return;
	span.addEvent?.("openclaw.provider.request", { "openclaw.upstreamRequestIdHash": boundedHash });
}
function clampOtelLogText(value, maxChars) {
	return value.length > maxChars ? `${value.slice(0, maxChars)}...(truncated)` : value;
}
function normalizeOtelLogString(value, maxChars) {
	return clampOtelLogText(redactSensitiveText(value), maxChars);
}
function resolveContentCapturePolicy(value) {
	if (value === true) return {
		inputMessages: true,
		outputMessages: true,
		toolInputs: true,
		toolOutputs: true,
		systemPrompt: false,
		toolDefinitions: true,
		logBodies: true
	};
	if (!value || typeof value !== "object" || Array.isArray(value)) return NO_CONTENT_CAPTURE;
	const config = value;
	if (config.enabled !== true) return NO_CONTENT_CAPTURE;
	return {
		inputMessages: config.inputMessages === true,
		outputMessages: config.outputMessages === true,
		toolInputs: config.toolInputs === true,
		toolOutputs: config.toolOutputs === true,
		systemPrompt: config.systemPrompt === true,
		toolDefinitions: config.toolDefinitions === true,
		logBodies: false
	};
}
function hasPreloadedOtelSdk() {
	return process.env[PRELOADED_OTEL_SDK_ENV] === "1";
}
function normalizeOtelContentValue(value) {
	if (typeof value === "string") return normalizeOtelLogString(value, MAX_OTEL_CONTENT_ATTRIBUTE_CHARS);
	if (Array.isArray(value)) {
		const items = [];
		for (const item of value.slice(0, MAX_OTEL_CONTENT_ARRAY_ITEMS)) if (typeof item === "string") items.push(item);
		if (items.length > 0) return normalizeOtelLogString(items.join("\n"), MAX_OTEL_CONTENT_ATTRIBUTE_CHARS);
	}
	const json = safeJsonString(value, MAX_OTEL_CONTENT_ATTRIBUTE_CHARS);
	if (json) return json;
}
const TRUNCATED_JSON_TEXT_SUFFIX = "...(truncated)";
const JSON_TRUNCATION_STRING_BUDGETS = [
	8192,
	4096,
	2048,
	1024,
	512,
	256,
	128,
	64,
	32
];
const JSON_TRUNCATION_ARRAY_ITEM_BUDGETS = [
	MAX_OTEL_CONTENT_ARRAY_ITEMS,
	100,
	50,
	25,
	10,
	5,
	1
];
const JSON_TRUNCATION_MAX_OBJECT_FIELDS = 64;
const JSON_TRUNCATION_MAX_DEPTH = 8;
function safeJsonString(value, maxChars) {
	if (value === void 0 || typeof value === "function" || typeof value === "symbol") return;
	const exact = stringifyJsonForOtelAttribute(value);
	if (exact && exact.length <= maxChars) return exact;
	for (const maxArrayItems of JSON_TRUNCATION_ARRAY_ITEM_BUDGETS) for (const maxStringChars of JSON_TRUNCATION_STRING_BUDGETS) {
		const json = stringifyJsonForOtelAttribute(truncateJsonValueForOtelAttribute(value, {
			maxArrayItems,
			maxDepth: JSON_TRUNCATION_MAX_DEPTH,
			maxObjectFields: JSON_TRUNCATION_MAX_OBJECT_FIELDS,
			maxStringChars,
			seen: /* @__PURE__ */ new WeakSet()
		}));
		if (json && json.length <= maxChars) return json;
	}
	const summary = stringifyJsonForOtelAttribute({
		truncated: true,
		reason: exact ? "max_attribute_size" : "unserializable_value",
		type: describeJsonValue(value)
	});
	return summary && summary.length <= maxChars ? summary : void 0;
}
function stringifyJsonForOtelAttribute(value) {
	try {
		const json = JSON.stringify(value);
		if (!json) return;
		return redactSensitiveText(json);
	} catch {
		return;
	}
}
function truncateJsonValueForOtelAttribute(value, options) {
	if (typeof value === "string") return truncateJsonTextForOtelAttribute(value, options.maxStringChars);
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (typeof value === "bigint") return truncateJsonTextForOtelAttribute(String(value), options.maxStringChars);
	if (value === void 0 || typeof value === "function" || typeof value === "symbol") return;
	if (options.maxDepth <= 0) return {
		truncated: true,
		reason: "max_depth"
	};
	if (Array.isArray(value)) return truncateJsonArrayForOtelAttribute(value, options);
	if (typeof value === "object") return truncateJsonObjectForOtelAttribute(value, options);
}
function truncateJsonArrayForOtelAttribute(value, options) {
	if (options.seen.has(value)) return [{
		truncated: true,
		reason: "circular_reference"
	}];
	options.seen.add(value);
	const nextOptions = {
		...options,
		maxDepth: options.maxDepth - 1
	};
	const items = value.slice(0, options.maxArrayItems).map((item) => truncateJsonValueForOtelAttribute(item, nextOptions));
	if (value.length > items.length) items.push({
		truncated: true,
		omittedItems: value.length - items.length
	});
	options.seen.delete(value);
	return items;
}
function truncateJsonObjectForOtelAttribute(value, options) {
	if (options.seen.has(value)) return {
		truncated: true,
		reason: "circular_reference"
	};
	options.seen.add(value);
	const nextOptions = {
		...options,
		maxDepth: options.maxDepth - 1
	};
	const result = {};
	const entries = Object.entries(value).filter(([, field]) => field !== void 0 && typeof field !== "function" && typeof field !== "symbol");
	for (const [key, field] of entries.slice(0, options.maxObjectFields)) result[key] = truncateJsonValueForOtelAttribute(field, nextOptions);
	if (entries.length > options.maxObjectFields) {
		result.truncated = true;
		result.omittedFields = entries.length - options.maxObjectFields;
	}
	options.seen.delete(value);
	return result;
}
function truncateJsonTextForOtelAttribute(value, maxChars) {
	const redacted = redactSensitiveText(value);
	if (redacted.length <= maxChars) return redacted;
	const suffixBudget = Math.min(14, maxChars);
	const prefixBudget = Math.max(0, maxChars - suffixBudget);
	return `${redacted.slice(0, prefixBudget)}${TRUNCATED_JSON_TEXT_SUFFIX.slice(14 - suffixBudget)}`;
}
function describeJsonValue(value) {
	if (Array.isArray(value)) return "array";
	if (value === null) return "null";
	return typeof value;
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function textPart(content) {
	return {
		type: "text",
		content
	};
}
function toolCallResponsePart(part) {
	return {
		type: "tool_call_response",
		...typeof part.id === "string" ? { id: part.id } : {},
		result: part.result ?? part.response ?? part.content ?? part.details ?? ""
	};
}
function contentParts(value) {
	if (typeof value === "string") return value.length > 0 ? [textPart(value)] : [];
	if (!Array.isArray(value)) {
		if (value === void 0 || value === null) return [];
		if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return [textPart(String(value))];
		const json = safeJsonString(value, MAX_OTEL_CONTENT_ATTRIBUTE_CHARS);
		return json ? [textPart(json)] : [];
	}
	const parts = [];
	for (const part of value) {
		if (typeof part === "string") {
			if (part.length > 0) parts.push(textPart(part));
			continue;
		}
		if (!isRecord(part)) continue;
		if (part.type === "text" && typeof part.text === "string") parts.push(textPart(part.text));
		else if (part.type === "text" && typeof part.content === "string") parts.push(textPart(part.content));
		else if (part.type === "thinking" && typeof part.thinking === "string") parts.push({
			type: "reasoning",
			content: part.thinking
		});
		else if (part.type === "toolCall" && typeof part.name === "string") parts.push({
			type: "tool_call",
			name: part.name,
			...typeof part.id === "string" ? { id: part.id } : {},
			...part.arguments !== void 0 ? { arguments: part.arguments } : {}
		});
		else if (part.type === "tool_call" && typeof part.name === "string") parts.push({
			type: "tool_call",
			name: part.name,
			...typeof part.id === "string" ? { id: part.id } : {},
			...part.arguments !== void 0 ? { arguments: part.arguments } : {}
		});
		else if (part.type === "tool_call_response") parts.push(toolCallResponsePart(part));
		else if (part.type === "image") {
			const data = typeof part.data === "string" ? part.data : void 0;
			parts.push({
				type: "blob",
				modality: "image",
				...typeof part.mimeType === "string" ? { mime_type: part.mimeType } : {},
				...typeof part.mime_type === "string" ? { mime_type: part.mime_type } : {},
				...data ? { content: data } : {}
			});
		}
	}
	return parts;
}
function normalizeGenAiMessage(value, fallbackRole = "user") {
	if (typeof value === "string") return {
		role: fallbackRole,
		parts: [textPart(value)]
	};
	if (!isRecord(value)) return;
	const rawRole = typeof value.role === "string" ? value.role : fallbackRole;
	const role = rawRole === "toolResult" ? "tool" : rawRole;
	let parts;
	if (role === "tool") {
		const explicitParts = contentParts(value.parts);
		parts = explicitParts.length > 0 ? explicitParts : [toolCallResponsePart({
			id: value.toolCallId,
			result: value.content ?? value.details ?? ""
		})];
	} else parts = contentParts(value.parts ?? value.content);
	if (parts.length === 0) return;
	return {
		role,
		parts,
		...typeof value.name === "string" ? { name: value.name } : {},
		...typeof value.finish_reason === "string" ? { finish_reason: value.finish_reason } : {},
		...typeof value.stopReason === "string" ? { finish_reason: value.stopReason } : {}
	};
}
function normalizeGenAiMessages(value, fallbackRole) {
	const source = Array.isArray(value) ? value : value === void 0 ? [] : [value];
	const messages = [];
	for (const item of source.slice(0, MAX_OTEL_CONTENT_ARRAY_ITEMS)) {
		const message = normalizeGenAiMessage(item, fallbackRole);
		if (message) messages.push(message);
	}
	return messages;
}
function normalizeGenAiToolDefinition(value) {
	if (!isRecord(value) || typeof value.name !== "string" || value.name.trim().length === 0) return;
	return {
		type: typeof value.type === "string" ? value.type : "function",
		name: value.name,
		...typeof value.description === "string" ? { description: value.description } : {},
		...value.parameters !== void 0 ? { parameters: value.parameters } : {}
	};
}
function normalizeGenAiToolDefinitions(value) {
	if (!Array.isArray(value)) return [];
	const definitions = [];
	for (const item of value.slice(0, MAX_OTEL_CONTENT_ARRAY_ITEMS)) {
		const definition = normalizeGenAiToolDefinition(item);
		if (definition) definitions.push(definition);
	}
	return definitions;
}
function assignJsonAttribute(attributes, key, value) {
	const json = safeJsonString(value, MAX_OTEL_CONTENT_ATTRIBUTE_CHARS);
	if (json) attributes[key] = json;
}
function assignGenAiModelContentAttributes(attributes, content, policy) {
	if (policy.systemPrompt && typeof content?.systemPrompt === "string") assignJsonAttribute(attributes, ATTR_GEN_AI_SYSTEM_INSTRUCTIONS, [textPart(content.systemPrompt)]);
	if (policy.inputMessages) {
		const inputMessages = normalizeGenAiMessages(content?.inputMessages, "user");
		if (inputMessages.length > 0) {
			assignJsonAttribute(attributes, ATTR_GEN_AI_INPUT_MESSAGES, inputMessages);
			assignJsonAttribute(attributes, "input.value", inputMessages);
			attributes["input.mime_type"] = "application/json";
		}
	}
	if (policy.toolDefinitions) {
		const toolDefinitions = normalizeGenAiToolDefinitions(content?.toolDefinitions);
		if (toolDefinitions.length > 0) assignJsonAttribute(attributes, ATTR_GEN_AI_TOOL_DEFINITIONS, toolDefinitions);
	}
	if (policy.outputMessages) {
		const outputMessages = normalizeGenAiMessages(content?.outputMessages, "assistant");
		if (outputMessages.length > 0) {
			assignJsonAttribute(attributes, ATTR_GEN_AI_OUTPUT_MESSAGES, outputMessages);
			assignJsonAttribute(attributes, "output.value", outputMessages);
			attributes["output.mime_type"] = "application/json";
		}
	}
}
function assignOtelContentAttribute(attributes, key, value) {
	const normalized = normalizeOtelContentValue(value);
	if (normalized) attributes[key] = normalized;
}
function assignOtelModelContentAttributes(attributes, content, policy) {
	assignGenAiModelContentAttributes(attributes, content, policy);
	if (policy.inputMessages) assignOtelContentAttribute(attributes, "openclaw.content.input_messages", content?.inputMessages);
	if (policy.toolDefinitions) assignOtelContentAttribute(attributes, "openclaw.content.tool_definitions", content?.toolDefinitions);
	if (policy.outputMessages) assignOtelContentAttribute(attributes, "openclaw.content.output_messages", content?.outputMessages);
	if (policy.systemPrompt) assignOtelContentAttribute(attributes, "openclaw.content.system_prompt", content?.systemPrompt);
}
function assignOtelToolContentAttributes(attributes, content, policy) {
	if (policy.toolInputs) assignOtelContentAttribute(attributes, "openclaw.content.tool_input", content?.toolInput);
	if (policy.toolOutputs) assignOtelContentAttribute(attributes, "openclaw.content.tool_output", content?.toolOutput);
}
function assignOtelLogAttribute(attributes, key, value) {
	if (Object.keys(attributes).length >= MAX_OTEL_LOG_ATTRIBUTE_COUNT) return;
	if (BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS.has(key)) return;
	if (redactSensitiveText(key) !== key) return;
	if (!OTEL_LOG_ATTRIBUTE_KEY_RE.test(key)) return;
	if (typeof value === "string") {
		attributes[key] = normalizeOtelLogString(value, MAX_OTEL_LOG_ATTRIBUTE_VALUE_CHARS);
		return;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		attributes[key] = value;
		return;
	}
	if (typeof value === "boolean") attributes[key] = value;
}
function normalizeTraceContext(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const candidate = value;
	if (!isValidDiagnosticTraceId(candidate.traceId)) return;
	if (candidate.spanId !== void 0 && !isValidDiagnosticSpanId(candidate.spanId)) return;
	if (candidate.parentSpanId !== void 0 && !isValidDiagnosticSpanId(candidate.parentSpanId)) return;
	if (candidate.traceFlags !== void 0 && !isValidDiagnosticTraceFlags(candidate.traceFlags)) return;
	return {
		traceId: candidate.traceId,
		...candidate.spanId ? { spanId: candidate.spanId } : {},
		...candidate.parentSpanId ? { parentSpanId: candidate.parentSpanId } : {},
		...candidate.traceFlags ? { traceFlags: candidate.traceFlags } : {}
	};
}
function assignOtelLogEventAttributes(attributes, eventAttributes) {
	if (!eventAttributes) return;
	for (const rawKey in eventAttributes) {
		if (Object.keys(attributes).length >= MAX_OTEL_LOG_ATTRIBUTE_COUNT) break;
		if (!Object.hasOwn(eventAttributes, rawKey)) continue;
		const key = rawKey.trim();
		if (BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS.has(key)) continue;
		if (redactSensitiveText(key) !== key) continue;
		if (!OTEL_LOG_RAW_ATTRIBUTE_KEY_RE.test(key)) continue;
		assignOtelLogAttribute(attributes, `openclaw.${key}`, eventAttributes[rawKey]);
	}
}
function assignOtelSecurityEventAttributes(attributes, eventAttributes) {
	if (!eventAttributes) return;
	for (const rawKey in eventAttributes) {
		if (Object.keys(attributes).length >= MAX_OTEL_LOG_ATTRIBUTE_COUNT) break;
		if (!Object.hasOwn(eventAttributes, rawKey)) continue;
		const key = rawKey.trim();
		if (BLOCKED_OTEL_LOG_ATTRIBUTE_KEYS.has(key)) continue;
		if (redactSensitiveText(key) !== key) continue;
		if (!OTEL_LOG_RAW_ATTRIBUTE_KEY_RE.test(key)) continue;
		const value = eventAttributes[rawKey];
		assignOtelLogAttribute(attributes, `openclaw.security.attribute.${key}`, typeof value === "string" ? lowCardinalityAttr(value) : value);
	}
}
function securitySeverityText(severity) {
	switch (severity) {
		case "critical": return "FATAL";
		case "high": return "ERROR";
		case "medium": return "WARN";
		case "info":
		case "low": return "INFO";
	}
	return severity;
}
function assignOtelSecurityAttributes(attributes, evt) {
	assignOtelLogAttribute(attributes, "openclaw.security.event_id", evt.eventId);
	assignOtelLogAttribute(attributes, "openclaw.security.category", evt.category);
	assignOtelLogAttribute(attributes, "openclaw.security.action", lowCardinalityAttr(evt.action));
	assignOtelLogAttribute(attributes, "openclaw.security.outcome", evt.outcome);
	assignOtelLogAttribute(attributes, "openclaw.security.severity", evt.severity);
	if (evt.reason) assignOtelLogAttribute(attributes, "openclaw.security.reason", lowCardinalityAttr(evt.reason));
	if (evt.actor) {
		assignOtelLogAttribute(attributes, "openclaw.security.actor.kind", evt.actor.kind);
		if (evt.actor.idHash) assignOtelLogAttribute(attributes, "openclaw.security.actor.id_hash", lowCardinalityAttr(evt.actor.idHash));
		if (evt.actor.deviceIdHash) assignOtelLogAttribute(attributes, "openclaw.security.actor.device_id_hash", lowCardinalityAttr(evt.actor.deviceIdHash));
		if (evt.actor.channel) assignOtelLogAttribute(attributes, "openclaw.security.actor.channel", lowCardinalityAttr(evt.actor.channel));
		if (evt.actor.role) assignOtelLogAttribute(attributes, "openclaw.security.actor.role", lowCardinalityAttr(evt.actor.role));
		if (evt.actor.scopes?.length) assignOtelLogAttribute(attributes, "openclaw.security.actor.scopes", evt.actor.scopes.map((scope) => lowCardinalityAttr(scope)).join(","));
	}
	if (evt.target) {
		assignOtelLogAttribute(attributes, "openclaw.security.target.kind", evt.target.kind);
		if (evt.target.idHash) assignOtelLogAttribute(attributes, "openclaw.security.target.id_hash", lowCardinalityAttr(evt.target.idHash));
		if (evt.target.name) assignOtelLogAttribute(attributes, "openclaw.security.target.name", securityTargetNameAttr(evt.target.name));
		if (evt.target.owner) assignOtelLogAttribute(attributes, "openclaw.security.target.owner", lowCardinalityAttr(evt.target.owner));
	}
	if (evt.policy) {
		if (evt.policy.id) assignOtelLogAttribute(attributes, "openclaw.security.policy.id", lowCardinalityAttr(evt.policy.id));
		if (evt.policy.decision) assignOtelLogAttribute(attributes, "openclaw.security.policy.decision", evt.policy.decision);
		if (evt.policy.reason) assignOtelLogAttribute(attributes, "openclaw.security.policy.reason", lowCardinalityAttr(evt.policy.reason));
	}
	if (evt.control) {
		if (evt.control.id) assignOtelLogAttribute(attributes, "openclaw.security.control.id", lowCardinalityAttr(evt.control.id));
		if (evt.control.family) assignOtelLogAttribute(attributes, "openclaw.security.control.family", evt.control.family);
	}
	assignOtelSecurityEventAttributes(attributes, evt.attributes);
}
function traceFlagsToOtel(traceFlags) {
	return (Number.parseInt(traceFlags ?? "00", 16) & TraceFlags.SAMPLED) !== 0 ? TraceFlags.SAMPLED : TraceFlags.NONE;
}
function contextForTraceContext(traceContext) {
	const normalized = normalizeTraceContext(traceContext);
	if (!normalized?.spanId) return;
	return trace.setSpanContext(context.active(), {
		traceId: normalized.traceId,
		spanId: normalized.spanId,
		traceFlags: traceFlagsToOtel(normalized.traceFlags),
		isRemote: true
	});
}
function contextForTrustedTraceContext(evt, metadata) {
	return metadata.trusted || metadata.trustedTraceContext === true ? contextForTraceContext(evt.trace) : void 0;
}
function normalizedTrustedTraceContext(evt, metadata) {
	return metadata.trusted || metadata.trustedTraceContext === true ? normalizeTraceContext(evt.trace) : void 0;
}
function addTraceAttributes(attributes, traceContext) {
	const normalized = normalizeTraceContext(traceContext);
	if (!normalized) return;
	attributes["openclaw.traceId"] = normalized.traceId;
	if (normalized.spanId) attributes["openclaw.spanId"] = normalized.spanId;
	if (normalized.parentSpanId) attributes["openclaw.parentSpanId"] = normalized.parentSpanId;
	if (normalized.traceFlags) attributes["openclaw.traceFlags"] = normalized.traceFlags;
}
function createDiagnosticsOtelService() {
	let tracerProvider = null;
	let meterProvider = null;
	let logProvider = null;
	let unsubscribe = null;
	let stopActiveTrustedSpans = null;
	let unregisterUnhandledRejectionHandler = null;
	const stopStarted = async () => {
		const currentUnsubscribe = unsubscribe;
		const currentLogProvider = logProvider;
		const currentTracerProvider = tracerProvider;
		const currentMeterProvider = meterProvider;
		const currentStopActiveTrustedSpans = stopActiveTrustedSpans;
		const currentUnregisterUnhandledRejectionHandler = unregisterUnhandledRejectionHandler;
		unsubscribe = null;
		logProvider = null;
		tracerProvider = null;
		meterProvider = null;
		stopActiveTrustedSpans = null;
		unregisterUnhandledRejectionHandler = null;
		currentUnregisterUnhandledRejectionHandler?.();
		currentUnsubscribe?.();
		currentStopActiveTrustedSpans?.();
		if (currentLogProvider) await currentLogProvider.shutdown().catch(() => void 0);
		if (currentTracerProvider) await currentTracerProvider.shutdown().catch(() => void 0);
		if (currentMeterProvider) await currentMeterProvider.shutdown().catch(() => void 0);
	};
	return {
		id: "diagnostics-otel",
		async start(ctx) {
			await stopStarted();
			const cfg = ctx.config.diagnostics;
			const otel = cfg?.otel;
			if (!cfg || cfg.enabled === false || !otel?.enabled) return;
			const emitExporterEvent = (event) => {
				try {
					ctx.internalDiagnostics?.emit({
						type: "telemetry.exporter",
						...event
					});
				} catch {}
			};
			const emitForSignals = (signals, event) => {
				for (const signal of signals) emitExporterEvent({
					signal,
					...event
				});
			};
			const tracesEnabled = otel.traces !== false;
			const metricsEnabled = otel.metrics !== false;
			const logsEnabled = otel.logs === true;
			const logsExporter = otel.logsExporter ?? "otlp";
			const logsToOtlp = logsEnabled && (logsExporter === "otlp" || logsExporter === "both");
			const logsToStdout = logsEnabled && (logsExporter === "stdout" || logsExporter === "both");
			const otlpSignals = [
				...tracesEnabled ? ["traces"] : [],
				...metricsEnabled ? ["metrics"] : [],
				...logsToOtlp ? ["logs"] : []
			];
			const enabledSignals = [
				...tracesEnabled ? ["traces"] : [],
				...metricsEnabled ? ["metrics"] : [],
				...logsEnabled ? ["logs"] : []
			];
			if (enabledSignals.length === 0) return;
			const protocol = otel.protocol ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf";
			if (otlpSignals.length > 0 && protocol !== "http/protobuf") {
				emitForSignals(otlpSignals, {
					exporter: "diagnostics-otel",
					status: "failure",
					reason: "unsupported_protocol"
				});
				ctx.logger.warn(`diagnostics-otel: unsupported protocol ${protocol}`);
				return;
			}
			const endpoint = normalizeEndpoint(otel.endpoint ?? process.env[OTEL_EXPORTER_OTLP_ENDPOINT_ENV]);
			const headers = otel.headers ?? void 0;
			const serviceName = otel.serviceName?.trim() || process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
			const sampleRate = resolveSampleRate(otel.sampleRate);
			const contentCapturePolicy = resolveContentCapturePolicy(otel.captureContent);
			const sdkPreloaded = hasPreloadedOtelSdk();
			const resource = defaultResource().merge(detectResources({ detectors: [
				envDetector,
				hostDetector,
				osDetector,
				processDetector
			] })).merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }));
			const logUrl = resolveSignalOtelUrl({
				signalEndpoint: otel.logsEndpoint,
				signalEnvEndpoint: process.env[OTEL_EXPORTER_OTLP_LOGS_ENDPOINT_ENV],
				endpoint,
				path: "v1/logs"
			});
			if (!sdkPreloaded && (tracesEnabled || metricsEnabled)) {
				const traceUrl = resolveSignalOtelUrl({
					signalEndpoint: otel.tracesEndpoint,
					signalEnvEndpoint: process.env[OTEL_EXPORTER_OTLP_TRACES_ENDPOINT_ENV],
					endpoint,
					path: "v1/traces"
				});
				const metricUrl = resolveSignalOtelUrl({
					signalEndpoint: otel.metricsEndpoint,
					signalEnvEndpoint: process.env[OTEL_EXPORTER_OTLP_METRICS_ENDPOINT_ENV],
					endpoint,
					path: "v1/metrics"
				});
				const traceExporter = tracesEnabled ? new OTLPTraceExporter({
					...traceUrl ? { url: traceUrl } : {},
					...headers ? { headers } : {}
				}) : void 0;
				const batchSpanProcessorOptions = typeof otel.flushIntervalMs === "number" ? { scheduledDelayMillis: Math.max(1e3, otel.flushIntervalMs) } : void 0;
				const spanProcessors = traceExporter ? [new BatchSpanProcessor(traceExporter, batchSpanProcessorOptions)] : void 0;
				const metricExporter = metricsEnabled ? new OTLPMetricExporter({
					...metricUrl ? { url: metricUrl } : {},
					...headers ? { headers } : {}
				}) : void 0;
				const metricReader = metricExporter ? new PeriodicExportingMetricReader({
					exporter: metricExporter,
					...typeof otel.flushIntervalMs === "number" ? { exportIntervalMillis: Math.max(1e3, otel.flushIntervalMs) } : {}
				}) : void 0;
				try {
					if (spanProcessors) tracerProvider = new BasicTracerProvider({
						resource,
						spanProcessors,
						...sampleRate !== void 0 ? { sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) }) } : {}
					});
					meterProvider = new MeterProvider({
						resource,
						...metricReader ? { readers: [metricReader] } : {}
					});
				} catch (err) {
					emitForSignals([...tracesEnabled ? ["traces"] : [], ...metricsEnabled ? ["metrics"] : []], {
						exporter: "diagnostics-otel",
						status: "failure",
						reason: "start_failed",
						errorCategory: errorCategory(err)
					});
					await stopStarted();
					ctx.logger.error(`diagnostics-otel: failed to start SDK: ${formatError(err)}`);
					throw err;
				}
			} else if (sdkPreloaded && (tracesEnabled || metricsEnabled)) ctx.logger.info("diagnostics-otel: using preloaded OpenTelemetry SDK");
			if (!sdkPreloaded && !meterProvider) meterProvider = new MeterProvider({ resource });
			const logSeverityMap = {
				TRACE: 1,
				DEBUG: 5,
				INFO: 9,
				WARN: 13,
				ERROR: 17,
				FATAL: 21
			};
			const meter = meterProvider?.getMeter("openclaw") ?? metrics.getMeter("openclaw");
			const tracer = tracerProvider?.getTracer("openclaw") ?? trace.getTracer("openclaw");
			const activeTrustedSpans = /* @__PURE__ */ new Map();
			const activeTrustedSpanAliases = /* @__PURE__ */ new Map();
			const retainedTrustedSpanContexts = /* @__PURE__ */ new Map();
			const retainedTrustedSpanContextCleanupTimers = /* @__PURE__ */ new Set();
			stopActiveTrustedSpans = () => {
				const stopAt = Date.now();
				for (const handle of retainedTrustedSpanContextCleanupTimers) clearTimeout(handle);
				retainedTrustedSpanContextCleanupTimers.clear();
				retainedTrustedSpanContexts.clear();
				for (const span of new Set([...activeTrustedSpans.values(), ...Array.from(activeTrustedSpanAliases.values(), (entry) => entry.span)])) span.end(stopAt);
				activeTrustedSpans.clear();
				activeTrustedSpanAliases.clear();
			};
			const tokensCounter = meter.createCounter("openclaw.tokens", {
				unit: "1",
				description: "Token usage by type"
			});
			const genAiTokenUsageHistogram = meter.createHistogram("gen_ai.client.token.usage", {
				unit: "{token}",
				description: "Number of input and output tokens used by GenAI client operations",
				advice: { explicitBucketBoundaries: GEN_AI_TOKEN_USAGE_BUCKETS }
			});
			const genAiOperationDurationHistogram = meter.createHistogram("gen_ai.client.operation.duration", {
				unit: "s",
				description: "GenAI client operation duration",
				advice: { explicitBucketBoundaries: GEN_AI_OPERATION_DURATION_BUCKETS }
			});
			const costCounter = meter.createCounter("openclaw.cost.usd", {
				unit: "1",
				description: "Estimated model cost (USD)"
			});
			const durationHistogram = meter.createHistogram("openclaw.run.duration_ms", {
				unit: "ms",
				description: "Agent run duration"
			});
			const harnessDurationHistogram = meter.createHistogram("openclaw.harness.duration_ms", {
				unit: "ms",
				description: "Agent harness lifecycle duration"
			});
			const contextHistogram = meter.createHistogram("openclaw.context.tokens", {
				unit: "1",
				description: "Context window size and usage"
			});
			const webhookReceivedCounter = meter.createCounter("openclaw.webhook.received", {
				unit: "1",
				description: "Webhook requests received"
			});
			const webhookErrorCounter = meter.createCounter("openclaw.webhook.error", {
				unit: "1",
				description: "Webhook processing errors"
			});
			const webhookDurationHistogram = meter.createHistogram("openclaw.webhook.duration_ms", {
				unit: "ms",
				description: "Webhook processing duration"
			});
			const messageQueuedCounter = meter.createCounter("openclaw.message.queued", {
				unit: "1",
				description: "Messages queued for processing"
			});
			const messageReceivedCounter = meter.createCounter("openclaw.message.received", {
				unit: "1",
				description: "Inbound messages received"
			});
			const messageDispatchStartedCounter = meter.createCounter("openclaw.message.dispatch.started", {
				unit: "1",
				description: "Inbound message dispatch attempts started"
			});
			const messageDispatchCompletedCounter = meter.createCounter("openclaw.message.dispatch.completed", {
				unit: "1",
				description: "Inbound message dispatch attempts completed"
			});
			const messageDispatchDurationHistogram = meter.createHistogram("openclaw.message.dispatch.duration_ms", {
				unit: "ms",
				description: "Inbound message dispatch duration"
			});
			const messageProcessedCounter = meter.createCounter("openclaw.message.processed", {
				unit: "1",
				description: "Messages processed by outcome"
			});
			const messageDurationHistogram = meter.createHistogram("openclaw.message.duration_ms", {
				unit: "ms",
				description: "Message processing duration"
			});
			const messageDeliveryStartedCounter = meter.createCounter("openclaw.message.delivery.started", {
				unit: "1",
				description: "Outbound message delivery attempts started"
			});
			const messageDeliveryDurationHistogram = meter.createHistogram("openclaw.message.delivery.duration_ms", {
				unit: "ms",
				description: "Outbound message delivery duration"
			});
			const queueDepthHistogram = meter.createHistogram("openclaw.queue.depth", {
				unit: "1",
				description: "Queue depth on enqueue/dequeue"
			});
			const queueWaitHistogram = meter.createHistogram("openclaw.queue.wait_ms", {
				unit: "ms",
				description: "Queue wait time before execution"
			});
			const laneEnqueueCounter = meter.createCounter("openclaw.queue.lane.enqueue", {
				unit: "1",
				description: "Command queue lane enqueue events"
			});
			const laneDequeueCounter = meter.createCounter("openclaw.queue.lane.dequeue", {
				unit: "1",
				description: "Command queue lane dequeue events"
			});
			const sessionStateCounter = meter.createCounter("openclaw.session.state", {
				unit: "1",
				description: "Session state transitions"
			});
			const sessionTurnCreatedCounter = meter.createCounter("openclaw.session.turn.created", {
				unit: "1",
				description: "Agent session turns created"
			});
			const sessionStuckCounter = meter.createCounter("openclaw.session.stuck", {
				unit: "1",
				description: "Sessions stuck in processing"
			});
			const sessionStuckAgeHistogram = meter.createHistogram("openclaw.session.stuck_age_ms", {
				unit: "ms",
				description: "Age of stuck sessions"
			});
			const sessionRecoveryRequestedCounter = meter.createCounter("openclaw.session.recovery.requested", {
				unit: "1",
				description: "Session recovery attempts requested"
			});
			const sessionRecoveryCompletedCounter = meter.createCounter("openclaw.session.recovery.completed", {
				unit: "1",
				description: "Session recovery attempts completed"
			});
			const sessionRecoveryAgeHistogram = meter.createHistogram("openclaw.session.recovery.age_ms", {
				unit: "ms",
				description: "Age of sessions selected for recovery"
			});
			const talkEventCounter = meter.createCounter("openclaw.talk.event", {
				unit: "1",
				description: "Talk events emitted by type"
			});
			const talkEventDurationHistogram = meter.createHistogram("openclaw.talk.event.duration_ms", {
				unit: "ms",
				description: "Talk event duration when reported"
			});
			const talkAudioBytesHistogram = meter.createHistogram("openclaw.talk.audio.bytes", {
				unit: "By",
				description: "Talk audio frame byte lengths"
			});
			const runAttemptCounter = meter.createCounter("openclaw.run.attempt", {
				unit: "1",
				description: "Run attempts"
			});
			const toolLoopCounter = meter.createCounter("openclaw.tool.loop", {
				unit: "1",
				description: "Detected repetitive tool-call loop events"
			});
			const skillUsedCounter = meter.createCounter("openclaw.skill.used", {
				unit: "1",
				description: "Skills used by agent runs"
			});
			const modelCallDurationHistogram = meter.createHistogram("openclaw.model_call.duration_ms", {
				unit: "ms",
				description: "Model call duration"
			});
			const modelCallRequestBytesHistogram = meter.createHistogram("openclaw.model_call.request_bytes", {
				unit: "By",
				description: "UTF-8 byte size of sanitized model request payloads"
			});
			const modelCallResponseBytesHistogram = meter.createHistogram("openclaw.model_call.response_bytes", {
				unit: "By",
				description: "UTF-8 byte size of bounded streamed model response payloads"
			});
			const modelCallTimeToFirstByteHistogram = meter.createHistogram("openclaw.model_call.time_to_first_byte_ms", {
				unit: "ms",
				description: "Elapsed time before the first streamed model response event"
			});
			const modelFailoverCounter = meter.createCounter("openclaw.model.failover", {
				unit: "1",
				description: "Model failovers by source, destination, lane, and reason"
			});
			const toolExecutionDurationHistogram = meter.createHistogram("openclaw.tool.execution.duration_ms", {
				unit: "ms",
				description: "Tool execution duration"
			});
			const toolExecutionBlockedCounter = meter.createCounter("openclaw.tool.execution.blocked", {
				unit: "1",
				description: "Tool executions blocked by policy or sandbox diagnostics"
			});
			const execProcessDurationHistogram = meter.createHistogram("openclaw.exec.duration_ms", {
				unit: "ms",
				description: "Exec process duration"
			});
			const memoryRssHistogram = meter.createHistogram("openclaw.memory.rss_bytes", {
				unit: "By",
				description: "Resident set size reported by diagnostic memory samples"
			});
			const memoryHeapUsedHistogram = meter.createHistogram("openclaw.memory.heap_used_bytes", {
				unit: "By",
				description: "Heap used bytes reported by diagnostic memory samples"
			});
			const memoryHeapTotalHistogram = meter.createHistogram("openclaw.memory.heap_total_bytes", {
				unit: "By",
				description: "Heap total bytes reported by diagnostic memory samples"
			});
			const memoryExternalHistogram = meter.createHistogram("openclaw.memory.external_bytes", {
				unit: "By",
				description: "External memory bytes reported by diagnostic memory samples"
			});
			const memoryArrayBuffersHistogram = meter.createHistogram("openclaw.memory.array_buffers_bytes", {
				unit: "By",
				description: "ArrayBuffer bytes reported by diagnostic memory samples"
			});
			const memoryPressureCounter = meter.createCounter("openclaw.memory.pressure", {
				unit: "1",
				description: "Diagnostic memory pressure events"
			});
			const asyncQueueDroppedCounter = meter.createCounter("openclaw.diagnostic.async_queue.dropped", {
				unit: "1",
				description: "Async diagnostic queue drops by dropped event class"
			});
			const payloadLargeCounter = meter.createCounter("openclaw.payload.large", {
				unit: "1",
				description: "Oversized payload diagnostics by surface and action"
			});
			const payloadLargeBytesHistogram = meter.createHistogram("openclaw.payload.large_bytes", {
				unit: "By",
				description: "Oversized payload byte sizes by surface and action"
			});
			const livenessWarningCounter = meter.createCounter("openclaw.liveness.warning", {
				unit: "1",
				description: "Diagnostic liveness warning events"
			});
			const livenessEventLoopDelayP99Histogram = meter.createHistogram("openclaw.liveness.event_loop_delay_p99_ms", {
				unit: "ms",
				description: "P99 event-loop delay reported by diagnostic liveness warnings"
			});
			const livenessEventLoopDelayMaxHistogram = meter.createHistogram("openclaw.liveness.event_loop_delay_max_ms", {
				unit: "ms",
				description: "Maximum event-loop delay reported by diagnostic liveness warnings"
			});
			const livenessEventLoopUtilizationHistogram = meter.createHistogram("openclaw.liveness.event_loop_utilization", {
				unit: "1",
				description: "Event-loop utilization reported by diagnostic liveness warnings"
			});
			const livenessCpuCoreRatioHistogram = meter.createHistogram("openclaw.liveness.cpu_core_ratio", {
				unit: "1",
				description: "CPU core ratio reported by diagnostic liveness warnings"
			});
			const telemetryExporterCounter = meter.createCounter("openclaw.telemetry.exporter.events", {
				unit: "1",
				description: "Diagnostic telemetry exporter lifecycle and failure events"
			});
			let recordLogRecord;
			let recordSecurityEvent;
			if (logsEnabled) {
				let logRecordExportFailureLastReportedAt = Number.NEGATIVE_INFINITY;
				let otelLogger;
				if (logsToOtlp) {
					logProvider = new LoggerProvider({
						resource,
						processors: [new BatchLogRecordProcessor(new OTLPLogExporter({
							...logUrl ? { url: logUrl } : {},
							...headers ? { headers } : {}
						}), typeof otel.flushIntervalMs === "number" ? { scheduledDelayMillis: Math.max(1e3, otel.flushIntervalMs) } : {})]
					});
					otelLogger = logProvider.getLogger("openclaw");
				}
				const reportLogExportFailure = (err, label) => {
					emitExporterEvent({
						exporter: "diagnostics-otel",
						signal: "logs",
						status: "failure",
						reason: "emit_failed",
						errorCategory: errorCategory(err)
					});
					const now = Date.now();
					if (now - logRecordExportFailureLastReportedAt >= LOG_RECORD_EXPORT_FAILURE_REPORT_INTERVAL_MS) {
						logRecordExportFailureLastReportedAt = now;
						ctx.logger.error(`diagnostics-otel: ${label} export failed: ${formatError(err)}`);
					}
				};
				const emitLogRecord = ({ logRecord, traceContext }) => {
					if (logsToOtlp) otelLogger?.emit(logRecord);
					if (logsToStdout) writeStdoutDiagnosticLogRecord({
						logRecord,
						serviceName,
						...traceContext ? { traceContext } : {}
					});
				};
				const buildDiagnosticLogRecord = (evt, metadata) => {
					const logLevelName = evt.level || "INFO";
					const severityNumber = logSeverityMap[logLevelName] ?? 9;
					const body = shouldCaptureOtelLogBody(contentCapturePolicy) ? normalizeOtelLogString(evt.message || "log", MAX_OTEL_LOG_BODY_CHARS) : "log";
					const attributes = Object.create(null);
					assignOtelLogAttribute(attributes, "openclaw.log.level", logLevelName);
					if (evt.loggerName) assignOtelLogAttribute(attributes, "openclaw.logger", evt.loggerName);
					if (evt.loggerParents?.length) assignOtelLogAttribute(attributes, "openclaw.logger.parents", evt.loggerParents.join("."));
					assignOtelLogEventAttributes(attributes, evt.attributes);
					if (evt.code?.line) assignOtelLogAttribute(attributes, "code.lineno", evt.code.line);
					if (evt.code?.functionName) assignOtelLogAttribute(attributes, "code.function", evt.code.functionName);
					const traceContext = normalizedTrustedTraceContext(evt, metadata);
					addTraceAttributes(attributes, traceContext);
					const logRecord = {
						body,
						severityText: logLevelName,
						severityNumber,
						attributes: redactOtelAttributes(attributes),
						timestamp: evt.ts
					};
					const logContext = contextForTrustedTraceContext(evt, metadata);
					if (logContext) logRecord.context = logContext;
					return {
						logRecord,
						...traceContext ? { traceContext } : {}
					};
				};
				const buildSecurityLogRecord = (evt, metadata) => {
					const severityText = securitySeverityText(evt.severity);
					const attributes = Object.create(null);
					assignOtelSecurityAttributes(attributes, evt);
					const traceContext = normalizedTrustedTraceContext(evt, metadata);
					const logRecord = {
						body: "openclaw.security.event",
						severityText,
						severityNumber: logSeverityMap[severityText] ?? 9,
						attributes: redactOtelAttributes(attributes),
						timestamp: evt.ts
					};
					const logContext = contextForTrustedTraceContext(evt, metadata);
					if (logContext) logRecord.context = logContext;
					return {
						logRecord,
						...traceContext ? { traceContext } : {}
					};
				};
				recordLogRecord = (evt, metadata) => {
					try {
						emitLogRecord(buildDiagnosticLogRecord(evt, metadata));
					} catch (err) {
						reportLogExportFailure(err, "log record");
					}
				};
				recordSecurityEvent = (evt, metadata) => {
					if (!metadata.trusted) return;
					try {
						emitLogRecord(buildSecurityLogRecord(evt, metadata));
					} catch (err) {
						reportLogExportFailure(err, "security event");
					}
				};
			}
			const spanWithDuration = (name, attributes, durationMs, options = {}) => {
				const endTimeMs = options.endTimeMs ?? Date.now();
				const startTime = typeof options.startTimeMs === "number" ? options.startTimeMs : typeof durationMs === "number" && durationMs >= 0 ? endTimeMs - durationMs : void 0;
				const parentContext = "parentContext" in options ? options.parentContext ?? void 0 : void 0;
				return tracer.startSpan(name, {
					attributes: redactOtelAttributes(attributes),
					...options.kind !== void 0 ? { kind: options.kind } : {},
					...startTime !== void 0 ? { startTime } : {}
				}, parentContext);
			};
			const trustedTraceContext = (evt, metadata) => metadata.trusted ? normalizeTraceContext(evt.trace) : void 0;
			const internalOrTrustedTraceContext = (evt, metadata) => metadata.trusted || metadata.internal ? normalizeTraceContext(evt.trace) : void 0;
			const trustedSpanAliasOwner = (evt) => {
				if ("runId" in evt && evt.runId) return {
					kind: "run",
					id: evt.runId
				};
			};
			const sameTrustedSpanAliasOwner = (left, right) => Boolean(left && right && left.kind === right.kind && left.id === right.id);
			const trustedSpanAliasKey = (spanId, owner) => `${spanId}:${owner.kind}:${owner.id}`;
			const retainedTrustedSpanContextKey = (traceId, spanId, owner) => `${traceId}:${owner ? trustedSpanAliasKey(spanId, owner) : spanId}`;
			const retainedTrustedSpanContext = (traceContext, spanId, owner) => {
				if (!traceContext?.traceId || !spanId) return;
				const retained = (owner ? retainedTrustedSpanContexts.get(retainedTrustedSpanContextKey(traceContext.traceId, spanId, owner)) : void 0) ?? retainedTrustedSpanContexts.get(retainedTrustedSpanContextKey(traceContext.traceId, spanId));
				if (retained?.spanContext.traceId !== traceContext.traceId) return;
				if (retained.owner && !sameTrustedSpanAliasOwner(retained.owner, owner)) return;
				return retained.spanContext;
			};
			const activeTrustedSpanAlias = (spanId, owner) => {
				if (!owner) return;
				const alias = activeTrustedSpanAliases.get(trustedSpanAliasKey(spanId, owner));
				if (!alias || !sameTrustedSpanAliasOwner(alias.owner, owner)) return;
				return alias.span;
			};
			const internalOrTrustedParentContext = (evt, metadata) => {
				const traceContext = internalOrTrustedTraceContext(evt, metadata);
				const parentSpanId = traceContext?.parentSpanId ?? traceContext?.spanId;
				if (!traceContext || !parentSpanId) return;
				return contextForTraceContext({
					...traceContext,
					spanId: parentSpanId
				});
			};
			const internalOrTrustedExplicitParentContext = (evt, metadata) => {
				const traceContext = internalOrTrustedTraceContext(evt, metadata);
				if (!traceContext?.parentSpanId) return;
				return contextForTraceContext({
					...traceContext,
					spanId: traceContext.parentSpanId
				});
			};
			const activeTrustedParentContext = (evt, metadata) => {
				const traceContext = trustedTraceContext(evt, metadata);
				const parentSpanId = traceContext?.parentSpanId;
				if (!parentSpanId) return;
				const owner = trustedSpanAliasOwner(evt);
				const spanContext = (activeTrustedSpans.get(parentSpanId) ?? activeTrustedSpanAlias(parentSpanId, owner))?.spanContext() ?? retainedTrustedSpanContext(traceContext, parentSpanId, owner);
				if (!spanContext) return;
				return trace.setSpanContext(context.active(), spanContext);
			};
			const activeInternalOrTrustedContext = (evt, metadata) => {
				const traceContext = internalOrTrustedTraceContext(evt, metadata);
				if (!traceContext) return;
				const owner = trustedSpanAliasOwner(evt);
				const activeSpan = (traceContext.spanId ? activeTrustedSpans.get(traceContext.spanId) ?? activeTrustedSpanAlias(traceContext.spanId, owner) : void 0) ?? (traceContext.parentSpanId ? activeTrustedSpans.get(traceContext.parentSpanId) ?? activeTrustedSpanAlias(traceContext.parentSpanId, owner) : void 0);
				if (activeSpan) return trace.setSpanContext(context.active(), activeSpan.spanContext());
				const retainedSpanContext = retainedTrustedSpanContext(traceContext, traceContext.spanId, owner) ?? retainedTrustedSpanContext(traceContext, traceContext.parentSpanId, owner);
				if (retainedSpanContext) return trace.setSpanContext(context.active(), retainedSpanContext);
				return internalOrTrustedParentContext(evt, metadata);
			};
			const trackTrustedSpan = (evt, metadata, span) => {
				const spanId = trustedTraceContext(evt, metadata)?.spanId;
				if (spanId) activeTrustedSpans.set(spanId, span);
				return span;
			};
			const trackInternalOrTrustedSpan = (evt, metadata, span) => {
				const spanId = internalOrTrustedTraceContext(evt, metadata)?.spanId;
				if (spanId) activeTrustedSpans.set(spanId, span);
				return span;
			};
			const takeTrackedTrustedSpan = (evt, metadata) => {
				const spanId = trustedTraceContext(evt, metadata)?.spanId;
				if (!spanId) return;
				const span = activeTrustedSpans.get(spanId);
				if (span) activeTrustedSpans.delete(spanId);
				return span;
			};
			const getTrackedInternalOrTrustedSpan = (evt, metadata) => {
				const spanId = internalOrTrustedTraceContext(evt, metadata)?.spanId;
				if (!spanId) return;
				return activeTrustedSpans.get(spanId);
			};
			const setSpanAttrs = (span, attributes) => {
				span.setAttributes?.(redactOtelAttributes(attributes));
			};
			const retainTrustedSpanContext = (traceId, spanId, spanContext, token, owner) => {
				retainedTrustedSpanContexts.set(retainedTrustedSpanContextKey(traceId, spanId, owner), {
					spanContext,
					token,
					...owner ? { owner } : {}
				});
				while (retainedTrustedSpanContexts.size > MAX_RETAINED_TRUSTED_SPAN_CONTEXTS) {
					const oldestKey = retainedTrustedSpanContexts.keys().next().value;
					if (!oldestKey) break;
					retainedTrustedSpanContexts.delete(oldestKey);
				}
			};
			const scheduleRetainedTrustedSpanContextCleanup = (token) => {
				let drainHandle;
				let timeoutHandle;
				const cleanup = () => {
					if (drainHandle) {
						clearTimeout(drainHandle);
						retainedTrustedSpanContextCleanupTimers.delete(drainHandle);
						drainHandle = void 0;
					}
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
						retainedTrustedSpanContextCleanupTimers.delete(timeoutHandle);
						timeoutHandle = void 0;
					}
					for (const [key, retained] of retainedTrustedSpanContexts) if (retained.token === token) retainedTrustedSpanContexts.delete(key);
				};
				drainHandle = setTimeout(() => {
					if (drainHandle) {
						retainedTrustedSpanContextCleanupTimers.delete(drainHandle);
						drainHandle = void 0;
					}
					waitForDiagnosticEventsDrained().then(cleanup, cleanup);
				}, 0);
				drainHandle.unref?.();
				retainedTrustedSpanContextCleanupTimers.add(drainHandle);
				timeoutHandle = setTimeout(cleanup, RETAINED_TRUSTED_SPAN_CONTEXT_TIMEOUT_MS);
				timeoutHandle.unref?.();
				retainedTrustedSpanContextCleanupTimers.add(timeoutHandle);
			};
			const completeTrackedLifecycleSpan = (spanId, span, endTimeMs) => {
				const spanContext = span.spanContext();
				const retainedKeys = [{ spanId }];
				const retainedAliasKeys = [];
				for (const [aliasKey, alias] of activeTrustedSpanAliases) if (alias.span === span) {
					retainedKeys.push({
						spanId: alias.spanId,
						owner: alias.owner
					});
					retainedAliasKeys.push(aliasKey);
				}
				if (activeTrustedSpans.get(spanId) === span) activeTrustedSpans.delete(spanId);
				for (const aliasKey of retainedAliasKeys) if (activeTrustedSpanAliases.get(aliasKey)?.span === span) activeTrustedSpanAliases.delete(aliasKey);
				span.end(endTimeMs);
				const token = Symbol("retainedTrustedSpanContext");
				for (const retainedKey of retainedKeys) retainTrustedSpanContext(spanContext.traceId, retainedKey.spanId, spanContext, token, retainedKey.owner);
				scheduleRetainedTrustedSpanContextCleanup(token);
			};
			const addRunAttrs = (spanAttrs, evt) => {
				if (evt.provider) spanAttrs["openclaw.provider"] = evt.provider;
				if (evt.model) spanAttrs["openclaw.model"] = evt.model;
				if (evt.channel) spanAttrs["openclaw.channel"] = evt.channel;
				if (evt.trigger) spanAttrs["openclaw.trigger"] = evt.trigger;
			};
			const paramsSummaryAttrs = (summary) => {
				if (!summary) return {};
				return {
					"openclaw.tool.params.kind": summary.kind,
					..."length" in summary ? { "openclaw.tool.params.length": summary.length } : {}
				};
			};
			const recordModelUsage = (evt, metadata) => {
				const attrs = {
					"openclaw.channel": evt.channel ?? "unknown",
					"openclaw.agent": lowCardinalityAttr(evt.agentId),
					"openclaw.provider": evt.provider ?? "unknown",
					"openclaw.model": evt.model ?? "unknown"
				};
				const genAiAttrs = {
					"gen_ai.operation.name": "chat",
					"gen_ai.provider.name": lowCardinalityAttr(evt.provider),
					"gen_ai.request.model": lowCardinalityAttr(evt.model)
				};
				const usage = evt.usage;
				if (usage.input) {
					tokensCounter.add(usage.input, {
						...attrs,
						"openclaw.token": "input"
					});
					genAiTokenUsageHistogram.record(usage.input, {
						...genAiAttrs,
						"gen_ai.token.type": "input"
					});
				}
				if (usage.output) {
					tokensCounter.add(usage.output, {
						...attrs,
						"openclaw.token": "output"
					});
					genAiTokenUsageHistogram.record(usage.output, {
						...genAiAttrs,
						"gen_ai.token.type": "output"
					});
				}
				if (usage.cacheRead) tokensCounter.add(usage.cacheRead, {
					...attrs,
					"openclaw.token": "cache_read"
				});
				if (usage.cacheWrite) tokensCounter.add(usage.cacheWrite, {
					...attrs,
					"openclaw.token": "cache_write"
				});
				if (usage.promptTokens) tokensCounter.add(usage.promptTokens, {
					...attrs,
					"openclaw.token": "prompt"
				});
				if (usage.total) tokensCounter.add(usage.total, {
					...attrs,
					"openclaw.token": "total"
				});
				if (evt.costUsd) costCounter.add(evt.costUsd, attrs);
				if (evt.durationMs) durationHistogram.record(evt.durationMs, attrs);
				if (evt.context?.limit) contextHistogram.record(evt.context.limit, {
					...attrs,
					"openclaw.context": "limit"
				});
				if (evt.context?.used) contextHistogram.record(evt.context.used, {
					...attrs,
					"openclaw.context": "used"
				});
				if (!tracesEnabled) return;
				const genAiInputTokens = usage.promptTokens ?? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				const spanAttrs = {
					...attrs,
					"openclaw.tokens.input": usage.input ?? 0,
					"openclaw.tokens.output": usage.output ?? 0,
					"openclaw.tokens.cache_read": usage.cacheRead ?? 0,
					"openclaw.tokens.cache_write": usage.cacheWrite ?? 0,
					"openclaw.tokens.total": usage.total ?? 0
				};
				assignGenAiSpanIdentityAttrs(spanAttrs, evt);
				assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.input_tokens", genAiInputTokens);
				assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.output_tokens", usage.output);
				assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.cache_read.input_tokens", usage.cacheRead);
				assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.cache_creation.input_tokens", usage.cacheWrite);
				spanWithDuration("openclaw.model.usage", spanAttrs, evt.durationMs, {
					parentContext: activeInternalOrTrustedContext(evt, metadata),
					endTimeMs: evt.ts
				}).end(evt.ts);
			};
			const recordWebhookReceived = (evt) => {
				const attrs = {
					"openclaw.channel": evt.channel ?? "unknown",
					"openclaw.webhook": evt.updateType ?? "unknown"
				};
				webhookReceivedCounter.add(1, attrs);
			};
			const recordWebhookProcessed = (evt) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.webhook": lowCardinalityAttr(evt.updateType)
				};
				if (typeof evt.durationMs === "number") webhookDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				spanWithDuration("openclaw.webhook.processed", { ...attrs }, evt.durationMs).end();
			};
			const recordWebhookError = (evt) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.webhook": lowCardinalityAttr(evt.updateType)
				};
				webhookErrorCounter.add(1, attrs);
				if (!tracesEnabled) return;
				const redactedError = redactSensitiveText(evt.error);
				const spanAttrs = {
					...attrs,
					"openclaw.error": redactedError
				};
				const span = tracer.startSpan("openclaw.webhook.error", { attributes: spanAttrs });
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: redactedError
				});
				span.end();
			};
			const recordMessageQueued = (evt) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.source": lowCardinalityAttr(evt.source)
				};
				messageQueuedCounter.add(1, attrs);
				if (typeof evt.queueDepth === "number") queueDepthHistogram.record(evt.queueDepth, attrs);
			};
			const recordMessageReceived = (evt) => {
				messageReceivedCounter.add(1, {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.source": lowCardinalityAttr(evt.source)
				});
			};
			const recordMessageDispatchStarted = (evt, metadata) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.source": lowCardinalityAttr(evt.source)
				};
				messageDispatchStartedCounter.add(1, attrs);
				if (!tracesEnabled) return;
				const traceContext = internalOrTrustedTraceContext(evt, metadata);
				if (!traceContext?.spanId || activeTrustedSpans.has(traceContext.spanId)) return;
				trackInternalOrTrustedSpan(evt, metadata, spanWithDuration("openclaw.message.processed", attrs, void 0, {
					parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
					startTimeMs: evt.ts
				}));
			};
			const recordMessageDispatchCompleted = (evt) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.outcome": evt.outcome,
					"openclaw.reason": lowCardinalityAttr(evt.reason, "none"),
					"openclaw.source": lowCardinalityAttr(evt.source)
				};
				messageDispatchCompletedCounter.add(1, attrs);
				messageDispatchDurationHistogram.record(evt.durationMs, attrs);
			};
			const recordMessageProcessed = (evt, metadata) => {
				const attrs = {
					"openclaw.channel": lowCardinalityAttr(evt.channel),
					"openclaw.outcome": evt.outcome ?? "unknown"
				};
				messageProcessedCounter.add(1, attrs);
				if (typeof evt.durationMs === "number") messageDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = { ...attrs };
				if (evt.reason) spanAttrs["openclaw.reason"] = lowCardinalityAttr(evt.reason, "unknown");
				const trackedSpan = getTrackedInternalOrTrustedSpan(evt, metadata);
				const span = trackedSpan ?? spanWithDuration("openclaw.message.processed", spanAttrs, evt.durationMs, {
					parentContext: internalOrTrustedExplicitParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				if (evt.outcome === "error" && evt.error) span.setStatus({
					code: SpanStatusCode.ERROR,
					message: redactSensitiveText(evt.error)
				});
				const traceContext = internalOrTrustedTraceContext(evt, metadata);
				if (trackedSpan && traceContext?.spanId) {
					completeTrackedLifecycleSpan(traceContext.spanId, trackedSpan, evt.ts);
					return;
				}
				span.end(evt.ts);
			};
			const messageDeliveryAttrs = (evt) => ({
				"openclaw.channel": lowCardinalityAttr(evt.channel),
				"openclaw.delivery.kind": lowCardinalityAttr(evt.deliveryKind, "other")
			});
			const recordMessageDeliveryStarted = (evt) => {
				messageDeliveryStartedCounter.add(1, messageDeliveryAttrs(evt));
			};
			const recordMessageDeliveryCompleted = (evt, metadata) => {
				const attrs = {
					...messageDeliveryAttrs(evt),
					"openclaw.outcome": "completed"
				};
				messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				spanWithDuration("openclaw.message.delivery", {
					...attrs,
					"openclaw.delivery.result_count": evt.resultCount
				}, evt.durationMs, {
					parentContext: activeInternalOrTrustedContext(evt, metadata),
					endTimeMs: evt.ts
				}).end(evt.ts);
			};
			const recordMessageDeliveryError = (evt, metadata) => {
				const attrs = {
					...messageDeliveryAttrs(evt),
					"openclaw.outcome": "error",
					"openclaw.errorCategory": lowCardinalityAttr(evt.errorCategory, "other")
				};
				messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const span = spanWithDuration("openclaw.message.delivery", attrs, evt.durationMs, {
					parentContext: activeInternalOrTrustedContext(evt, metadata),
					endTimeMs: evt.ts
				});
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: redactSensitiveText(evt.errorCategory)
				});
				span.end(evt.ts);
			};
			const recordRunStarted = (evt, metadata) => {
				if (!tracesEnabled || !metadata.trusted) return;
				const spanAttrs = {};
				addRunAttrs(spanAttrs, evt);
				const span = trackTrustedSpan(evt, metadata, spanWithDuration("openclaw.run", spanAttrs, void 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					startTimeMs: evt.ts
				}));
				const parentSpanId = trustedTraceContext(evt, metadata)?.parentSpanId;
				if (parentSpanId && !activeTrustedSpans.has(parentSpanId)) {
					const owner = {
						kind: "run",
						id: evt.runId
					};
					activeTrustedSpanAliases.set(trustedSpanAliasKey(parentSpanId, owner), {
						span,
						spanId: parentSpanId,
						owner
					});
				}
			};
			const recordLaneEnqueue = (evt) => {
				const attrs = { "openclaw.lane": lowCardinalityQueueLaneAttr(evt.lane) };
				laneEnqueueCounter.add(1, attrs);
				queueDepthHistogram.record(evt.queueSize, attrs);
			};
			const recordLaneDequeue = (evt) => {
				const attrs = { "openclaw.lane": lowCardinalityQueueLaneAttr(evt.lane) };
				laneDequeueCounter.add(1, attrs);
				queueDepthHistogram.record(evt.queueSize, attrs);
				if (typeof evt.waitMs === "number") queueWaitHistogram.record(evt.waitMs, attrs);
			};
			const recordSessionState = (evt) => {
				const attrs = { "openclaw.state": evt.state };
				if (evt.reason) attrs["openclaw.reason"] = redactSensitiveText(evt.reason);
				sessionStateCounter.add(1, attrs);
			};
			const recordSessionTurnCreated = (evt) => {
				sessionTurnCreatedCounter.add(1, {
					"openclaw.agent": lowCardinalityAttr(evt.agentId, "unknown"),
					"openclaw.channel": lowCardinalityAttr(evt.channel, "unknown"),
					"openclaw.trigger": evt.trigger
				});
			};
			const recordSessionStuck = (evt) => {
				const attrs = { "openclaw.state": evt.state };
				sessionStuckCounter.add(1, attrs);
				if (typeof evt.ageMs === "number") sessionStuckAgeHistogram.record(evt.ageMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = { ...attrs };
				spanAttrs["openclaw.queueDepth"] = evt.queueDepth ?? 0;
				spanAttrs["openclaw.ageMs"] = evt.ageMs;
				const span = tracer.startSpan("openclaw.session.stuck", { attributes: spanAttrs });
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: "session stuck"
				});
				span.end();
			};
			const sessionRecoveryAttrs = (evt) => {
				const attrs = { "openclaw.state": evt.state };
				if (evt.reason) attrs["openclaw.reason"] = redactSensitiveText(evt.reason);
				if (evt.activeWorkKind) attrs["openclaw.active_work_kind"] = evt.activeWorkKind;
				return attrs;
			};
			const recordSessionRecoveryRequested = (evt) => {
				const attrs = sessionRecoveryAttrs(evt);
				attrs["openclaw.action"] = evt.allowActiveAbort ? "abort" : "recover";
				sessionRecoveryRequestedCounter.add(1, attrs);
				sessionRecoveryAgeHistogram.record(evt.ageMs, attrs);
			};
			const recordSessionRecoveryCompleted = (evt) => {
				const attrs = sessionRecoveryAttrs(evt);
				attrs["openclaw.status"] = evt.status;
				attrs["openclaw.action"] = lowCardinalityAttr(evt.action, "unknown");
				if (evt.outcomeReason) attrs["openclaw.reason"] = redactSensitiveText(evt.outcomeReason);
				sessionRecoveryCompletedCounter.add(1, attrs);
				sessionRecoveryAgeHistogram.record(evt.ageMs, attrs);
			};
			const talkEventAttrs = (evt) => ({
				"openclaw.talk.brain": lowCardinalityAttr(evt.brain),
				"openclaw.talk.event_type": lowCardinalityAttr(evt.talkEventType),
				"openclaw.talk.mode": lowCardinalityAttr(evt.mode),
				"openclaw.talk.provider": lowCardinalityAttr(evt.provider),
				"openclaw.talk.transport": lowCardinalityAttr(evt.transport)
			});
			const recordTalkEvent = (evt, metadata) => {
				if (!metadata.trusted) return;
				const attrs = talkEventAttrs(evt);
				talkEventCounter.add(1, attrs);
				if (typeof evt.durationMs === "number") talkEventDurationHistogram.record(evt.durationMs, attrs);
				if (typeof evt.byteLength === "number") talkAudioBytesHistogram.record(evt.byteLength, attrs);
			};
			const recordRunAttempt = (evt) => {
				runAttemptCounter.add(1, { "openclaw.attempt": evt.attempt });
			};
			const toolLoopAttrs = (evt) => ({
				"openclaw.toolName": lowCardinalityAttr(evt.toolName, "tool"),
				"openclaw.loop.level": evt.level,
				"openclaw.loop.action": evt.action,
				"openclaw.loop.detector": evt.detector,
				"openclaw.loop.count": evt.count,
				...evt.pairedToolName ? { "openclaw.loop.paired_tool": lowCardinalityAttr(evt.pairedToolName, "tool") } : {}
			});
			const recordToolLoop = (evt) => {
				const attrs = toolLoopAttrs(evt);
				toolLoopCounter.add(1, attrs);
				if (!tracesEnabled) return;
				const span = spanWithDuration("openclaw.tool.loop", attrs, 0, { endTimeMs: evt.ts });
				if (evt.level === "critical" || evt.action === "block") span.setStatus({
					code: SpanStatusCode.ERROR,
					message: `${evt.detector}:${evt.action}`
				});
				span.end(evt.ts);
			};
			const recordMemoryUsageMetrics = (evt, attrs = {}) => {
				memoryRssHistogram.record(evt.memory.rssBytes, attrs);
				memoryHeapUsedHistogram.record(evt.memory.heapUsedBytes, attrs);
				memoryHeapTotalHistogram.record(evt.memory.heapTotalBytes, attrs);
				memoryExternalHistogram.record(evt.memory.externalBytes, attrs);
				memoryArrayBuffersHistogram.record(evt.memory.arrayBuffersBytes, attrs);
			};
			const recordMemorySample = (evt) => {
				recordMemoryUsageMetrics(evt);
			};
			const recordMemoryPressure = (evt) => {
				const attrs = {
					"openclaw.memory.level": evt.level,
					"openclaw.memory.reason": evt.reason
				};
				memoryPressureCounter.add(1, attrs);
				recordMemoryUsageMetrics(evt, attrs);
				if (!tracesEnabled) return;
				const span = spanWithDuration("openclaw.memory.pressure", {
					...attrs,
					"openclaw.memory.rss_bytes": evt.memory.rssBytes,
					"openclaw.memory.heap_used_bytes": evt.memory.heapUsedBytes,
					"openclaw.memory.heap_total_bytes": evt.memory.heapTotalBytes,
					"openclaw.memory.external_bytes": evt.memory.externalBytes,
					"openclaw.memory.array_buffers_bytes": evt.memory.arrayBuffersBytes,
					...evt.thresholdBytes !== void 0 ? { "openclaw.memory.threshold_bytes": evt.thresholdBytes } : {},
					...evt.rssGrowthBytes !== void 0 ? { "openclaw.memory.rss_growth_bytes": evt.rssGrowthBytes } : {},
					...evt.windowMs !== void 0 ? { "openclaw.memory.window_ms": evt.windowMs } : {}
				}, 0, { endTimeMs: evt.ts });
				if (evt.level === "critical") span.setStatus({
					code: SpanStatusCode.ERROR,
					message: evt.reason
				});
				span.end(evt.ts);
			};
			const recordAsyncQueueDropped = (evt) => {
				asyncQueueDroppedCounter.add(evt.droppedEvents, { "openclaw.diagnostic.async_queue.drop_class": "total" });
				if (evt.droppedTrustedEvents !== void 0) asyncQueueDroppedCounter.add(evt.droppedTrustedEvents, { "openclaw.diagnostic.async_queue.drop_class": "trusted" });
				if (evt.droppedUntrustedEvents !== void 0) asyncQueueDroppedCounter.add(evt.droppedUntrustedEvents, { "openclaw.diagnostic.async_queue.drop_class": "untrusted" });
				if (evt.droppedPriorityEvents !== void 0) asyncQueueDroppedCounter.add(evt.droppedPriorityEvents, { "openclaw.diagnostic.async_queue.drop_class": "priority" });
			};
			const recordRunCompleted = (evt, metadata) => {
				const attrs = {
					"openclaw.outcome": evt.outcome,
					"openclaw.provider": evt.provider ?? "unknown",
					"openclaw.model": evt.model ?? "unknown"
				};
				if (evt.channel) attrs["openclaw.channel"] = evt.channel;
				if (evt.blockedBy) attrs["openclaw.blocked_by"] = lowCardinalityAttr(evt.blockedBy, "unknown");
				durationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = { "openclaw.outcome": evt.outcome };
				addRunAttrs(spanAttrs, evt);
				if (evt.blockedBy) spanAttrs["openclaw.blocked_by"] = lowCardinalityAttr(evt.blockedBy, "unknown");
				if (evt.errorCategory) spanAttrs["openclaw.errorCategory"] = lowCardinalityAttr(evt.errorCategory, "other");
				const trustedTrace = trustedTraceContext(evt, metadata);
				const trackedSpan = trustedTrace?.spanId ? activeTrustedSpans.get(trustedTrace.spanId) : void 0;
				const span = trackedSpan ?? spanWithDuration("openclaw.run", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				if (evt.outcome === "error") span.setStatus({
					code: SpanStatusCode.ERROR,
					...evt.errorCategory ? { message: redactSensitiveText(evt.errorCategory) } : {}
				});
				if (trackedSpan && trustedTrace?.spanId) {
					completeTrackedLifecycleSpan(trustedTrace.spanId, trackedSpan, evt.ts);
					return;
				}
				span.end(evt.ts);
			};
			const harnessRunMetricAttrs = (evt) => ({
				"openclaw.harness.id": lowCardinalityAttr(evt.harnessId, "unknown"),
				"openclaw.harness.plugin": lowCardinalityAttr(evt.pluginId),
				...evt.type === "harness.run.started" ? {} : { "openclaw.outcome": evt.type === "harness.run.error" ? "error" : evt.outcome },
				"openclaw.provider": lowCardinalityAttr(evt.provider, "unknown"),
				"openclaw.model": lowCardinalityAttr(evt.model, "unknown"),
				...evt.channel ? { "openclaw.channel": lowCardinalityAttr(evt.channel) } : {}
			});
			const recordHarnessRunStarted = (evt, metadata) => {
				if (!tracesEnabled || !metadata.trusted) return;
				trackTrustedSpan(evt, metadata, spanWithDuration("openclaw.harness.run", harnessRunMetricAttrs(evt), void 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					startTimeMs: evt.ts
				}));
			};
			const recordHarnessRunCompleted = (evt, metadata) => {
				harnessDurationHistogram.record(evt.durationMs, harnessRunMetricAttrs(evt));
				if (!tracesEnabled) return;
				const spanAttrs = { ...harnessRunMetricAttrs(evt) };
				if (evt.resultClassification) spanAttrs["openclaw.harness.result_classification"] = lowCardinalityAttr(evt.resultClassification);
				if (typeof evt.yieldDetected === "boolean") spanAttrs["openclaw.harness.yield_detected"] = evt.yieldDetected;
				if (evt.itemLifecycle) {
					spanAttrs["openclaw.harness.items.started"] = evt.itemLifecycle.startedCount;
					spanAttrs["openclaw.harness.items.completed"] = evt.itemLifecycle.completedCount;
					spanAttrs["openclaw.harness.items.active"] = evt.itemLifecycle.activeCount;
				}
				const trustedTrace = trustedTraceContext(evt, metadata);
				const trackedSpan = trustedTrace?.spanId ? activeTrustedSpans.get(trustedTrace.spanId) : void 0;
				const span = trackedSpan ?? spanWithDuration("openclaw.harness.run", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				if (evt.outcome === "error") span.setStatus({
					code: SpanStatusCode.ERROR,
					message: "error"
				});
				if (trackedSpan && trustedTrace?.spanId) {
					completeTrackedLifecycleSpan(trustedTrace.spanId, trackedSpan, evt.ts);
					return;
				}
				span.end(evt.ts);
			};
			const recordHarnessRunError = (evt, metadata) => {
				const errorType = lowCardinalityAttr(evt.errorCategory, "other");
				const attrs = {
					...harnessRunMetricAttrs(evt),
					"openclaw.harness.phase": evt.phase,
					"openclaw.errorCategory": errorType
				};
				harnessDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = {
					...attrs,
					"error.type": errorType,
					...evt.cleanupFailed ? { "openclaw.harness.cleanup_failed": true } : {}
				};
				const span = takeTrackedTrustedSpan(evt, metadata) ?? spanWithDuration("openclaw.harness.run", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: errorType
				});
				span.end(evt.ts);
			};
			const recordContextAssembled = (evt, metadata) => {
				if (!tracesEnabled) return;
				const spanAttrs = {
					"openclaw.context.message_count": evt.messageCount,
					"openclaw.context.history_text_chars": evt.historyTextChars,
					"openclaw.context.history_image_blocks": evt.historyImageBlocks,
					"openclaw.context.max_message_text_chars": evt.maxMessageTextChars,
					"openclaw.context.system_prompt_chars": evt.systemPromptChars,
					"openclaw.context.prompt_chars": evt.promptChars,
					"openclaw.context.prompt_images": evt.promptImages
				};
				addRunAttrs(spanAttrs, evt);
				if (evt.contextTokenBudget !== void 0) spanAttrs["openclaw.context.token_budget"] = evt.contextTokenBudget;
				if (evt.reserveTokens !== void 0) spanAttrs["openclaw.context.reserve_tokens"] = evt.reserveTokens;
				spanWithDuration("openclaw.context.assembled", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				}).end(evt.ts);
			};
			const recordModelFailover = (evt, metadata) => {
				const metricAttrs = {
					"openclaw.failover.outcome": lowCardinalityAttr(evt.outcome, "unknown"),
					"openclaw.failover.reason": lowCardinalityAttr(evt.reason, "unknown"),
					"openclaw.failover.suspended": evt.suspended === void 0 ? "unknown" : String(evt.suspended),
					"openclaw.failover.tier": evt.cascadeDepth === void 0 ? "unknown" : String(evt.cascadeDepth),
					"openclaw.lane": lowCardinalityQueueLaneAttr(evt.lane, "unknown"),
					"openclaw.model": lowCardinalityAttr(evt.fromModel),
					"openclaw.provider": lowCardinalityAttr(evt.fromProvider),
					"openclaw.failover.to_model": lowCardinalityAttr(evt.toModel),
					"openclaw.failover.to_provider": lowCardinalityAttr(evt.toProvider)
				};
				modelFailoverCounter.add(1, metricAttrs);
				if (!tracesEnabled) return;
				const spanAttrs = { "openclaw.failover.reason": lowCardinalityAttr(evt.reason, "unknown") };
				if (evt.fromProvider) spanAttrs["openclaw.provider"] = evt.fromProvider;
				if (evt.fromModel) spanAttrs["openclaw.model"] = evt.fromModel;
				if (evt.toProvider) spanAttrs["openclaw.failover.to_provider"] = evt.toProvider;
				if (evt.toModel) spanAttrs["openclaw.failover.to_model"] = evt.toModel;
				if (evt.lane) spanAttrs["openclaw.lane"] = lowCardinalityQueueLaneAttr(evt.lane, "unknown");
				if (evt.suspended !== void 0) spanAttrs["openclaw.failover.suspended"] = evt.suspended;
				if (evt.cascadeDepth !== void 0) spanAttrs["openclaw.failover.tier"] = evt.cascadeDepth;
				if (evt.outcome !== void 0) spanAttrs["openclaw.failover.outcome"] = evt.outcome;
				spanWithDuration("openclaw.model.failover", spanAttrs, 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				}).end(evt.ts);
			};
			const modelCallMetricAttrs = (evt) => ({
				"openclaw.provider": evt.provider,
				"openclaw.model": evt.model,
				"openclaw.api": lowCardinalityAttr(evt.api),
				"openclaw.transport": lowCardinalityAttr(evt.transport)
			});
			const genAiModelCallMetricAttrs = (evt, errorType) => ({
				"gen_ai.operation.name": genAiOperationName(evt.api),
				"gen_ai.provider.name": lowCardinalityAttr(evt.provider),
				"gen_ai.request.model": lowCardinalityAttr(evt.model),
				...errorType ? { "error.type": errorType } : {}
			});
			const recordModelCallSizeTimingMetrics = (evt, attrs) => {
				const requestPayloadBytes = positiveFiniteNumber(evt.requestPayloadBytes);
				if (requestPayloadBytes !== void 0) modelCallRequestBytesHistogram.record(requestPayloadBytes, attrs);
				const responseStreamBytes = positiveFiniteNumber(evt.responseStreamBytes);
				if (responseStreamBytes !== void 0) modelCallResponseBytesHistogram.record(responseStreamBytes, attrs);
				const timeToFirstByteMs = positiveFiniteNumber(evt.timeToFirstByteMs);
				if (timeToFirstByteMs !== void 0) modelCallTimeToFirstByteHistogram.record(timeToFirstByteMs, attrs);
			};
			const recordModelCallStarted = (evt, metadata) => {
				if (!tracesEnabled || !metadata.trusted) return;
				const spanAttrs = {
					"openclaw.provider": evt.provider,
					"openclaw.model": evt.model
				};
				assignGenAiModelCallAttrs(spanAttrs, evt);
				if (evt.api) spanAttrs["openclaw.api"] = evt.api;
				if (evt.transport) spanAttrs["openclaw.transport"] = evt.transport;
				trackTrustedSpan(evt, metadata, spanWithDuration(modelCallSpanName(evt), spanAttrs, void 0, {
					kind: modelCallSpanKind(),
					parentContext: activeTrustedParentContext(evt, metadata),
					startTimeMs: evt.ts
				}));
			};
			const recordModelCallCompleted = (evt, metadata, modelContent) => {
				const metricAttrs = modelCallMetricAttrs(evt);
				modelCallDurationHistogram.record(evt.durationMs, metricAttrs);
				recordModelCallSizeTimingMetrics(evt, metricAttrs);
				genAiOperationDurationHistogram.record(evt.durationMs / 1e3, genAiModelCallMetricAttrs(evt));
				if (!tracesEnabled) return;
				const spanAttrs = {
					"openclaw.provider": evt.provider,
					"openclaw.model": evt.model
				};
				assignGenAiModelCallAttrs(spanAttrs, evt);
				if (evt.api) spanAttrs["openclaw.api"] = evt.api;
				if (evt.transport) spanAttrs["openclaw.transport"] = evt.transport;
				assignModelCallSizeTimingAttrs(spanAttrs, evt);
				assignOtelModelContentAttributes(spanAttrs, modelContent, contentCapturePolicy);
				const span = takeTrackedTrustedSpan(evt, metadata) ?? spanWithDuration(modelCallSpanName(evt), spanAttrs, evt.durationMs, {
					kind: modelCallSpanKind(),
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				addUpstreamRequestIdSpanEvent(span, evt.upstreamRequestIdHash);
				span.end(evt.ts);
			};
			const recordModelCallError = (evt, metadata, modelContent) => {
				const errorType = lowCardinalityAttr(evt.errorCategory, "other");
				const metricAttrs = {
					...modelCallMetricAttrs(evt),
					"openclaw.errorCategory": errorType,
					...evt.failureKind ? { "openclaw.failureKind": lowCardinalityAttr(evt.failureKind, "other") } : {}
				};
				modelCallDurationHistogram.record(evt.durationMs, metricAttrs);
				recordModelCallSizeTimingMetrics(evt, metricAttrs);
				genAiOperationDurationHistogram.record(evt.durationMs / 1e3, genAiModelCallMetricAttrs(evt, errorType));
				if (!tracesEnabled) return;
				const spanAttrs = {
					"openclaw.provider": evt.provider,
					"openclaw.model": evt.model,
					"openclaw.errorCategory": errorType,
					"error.type": errorType
				};
				if (evt.failureKind) spanAttrs["openclaw.failureKind"] = lowCardinalityAttr(evt.failureKind, "other");
				assignGenAiModelCallAttrs(spanAttrs, evt);
				if (evt.api) spanAttrs["openclaw.api"] = evt.api;
				if (evt.transport) spanAttrs["openclaw.transport"] = evt.transport;
				assignModelCallSizeTimingAttrs(spanAttrs, evt);
				assignOtelModelContentAttributes(spanAttrs, modelContent, contentCapturePolicy);
				const span = takeTrackedTrustedSpan(evt, metadata) ?? spanWithDuration(modelCallSpanName(evt), spanAttrs, evt.durationMs, {
					kind: modelCallSpanKind(),
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				addUpstreamRequestIdSpanEvent(span, evt.upstreamRequestIdHash);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: redactSensitiveText(evt.errorCategory)
				});
				span.end(evt.ts);
			};
			const toolExecutionBaseAttrs = (evt) => ({
				"openclaw.toolName": evt.toolName,
				"openclaw.tool.source": lowCardinalityAttr(evt.toolSource, "core"),
				"gen_ai.tool.name": evt.toolName,
				...evt.toolOwner ? { "openclaw.tool.owner": lowCardinalityAttr(evt.toolOwner) } : {},
				...paramsSummaryAttrs(evt.paramsSummary)
			});
			const skillUsedAttrs = (evt) => ({
				"openclaw.skill.name": lowCardinalityAttr(evt.skillName, "skill"),
				"openclaw.skill.source": lowCardinalityAttr(evt.skillSource),
				"openclaw.skill.activation": lowCardinalityAttr(evt.activation),
				...evt.agentId ? { "openclaw.agent": lowCardinalityAttr(evt.agentId) } : {},
				...evt.toolName ? { "openclaw.toolName": lowCardinalityAttr(evt.toolName, "tool") } : {}
			});
			const recordSkillUsed = (evt, metadata) => {
				if (!metadata.trusted) return;
				const attrs = skillUsedAttrs(evt);
				skillUsedCounter.add(1, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = { ...attrs };
				addRunAttrs(spanAttrs, evt);
				const span = spanWithDuration("openclaw.skill.used", spanAttrs, 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				span.end(evt.ts);
			};
			const recordToolExecutionStarted = (evt, metadata) => {
				if (!tracesEnabled || !metadata.trusted) return;
				trackTrustedSpan(evt, metadata, spanWithDuration("openclaw.tool.execution", toolExecutionBaseAttrs(evt), void 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					startTimeMs: evt.ts
				}));
			};
			const recordToolExecutionCompleted = (evt, metadata, toolContent) => {
				const attrs = toolExecutionBaseAttrs(evt);
				toolExecutionDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = { ...toolExecutionBaseAttrs(evt) };
				addRunAttrs(spanAttrs, evt);
				assignOtelToolContentAttributes(spanAttrs, toolContent, contentCapturePolicy);
				const span = takeTrackedTrustedSpan(evt, metadata) ?? spanWithDuration("openclaw.tool.execution", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				span.end(evt.ts);
			};
			const recordToolExecutionError = (evt, metadata, toolContent) => {
				const attrs = {
					...toolExecutionBaseAttrs(evt),
					"openclaw.errorCategory": lowCardinalityAttr(evt.errorCategory, "other")
				};
				toolExecutionDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = {
					...toolExecutionBaseAttrs(evt),
					"openclaw.errorCategory": lowCardinalityAttr(evt.errorCategory, "other")
				};
				addRunAttrs(spanAttrs, evt);
				if (evt.errorCode) spanAttrs["openclaw.errorCode"] = lowCardinalityAttr(evt.errorCode, "other");
				assignOtelToolContentAttributes(spanAttrs, toolContent, contentCapturePolicy);
				const span = takeTrackedTrustedSpan(evt, metadata) ?? spanWithDuration("openclaw.tool.execution", spanAttrs, evt.durationMs, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: redactSensitiveText(evt.errorCategory)
				});
				span.end(evt.ts);
			};
			const recordToolExecutionBlocked = (evt, metadata) => {
				toolExecutionBlockedCounter.add(1, {
					...toolExecutionBaseAttrs(evt),
					"openclaw.deniedReason": lowCardinalityAttr(evt.deniedReason, "other")
				});
				if (!tracesEnabled) return;
				const spanAttrs = {
					...toolExecutionBaseAttrs(evt),
					"openclaw.outcome": "blocked",
					"openclaw.deniedReason": lowCardinalityAttr(evt.deniedReason, "other")
				};
				addRunAttrs(spanAttrs, evt);
				const span = spanWithDuration("openclaw.tool.execution", spanAttrs, 0, {
					parentContext: activeTrustedParentContext(evt, metadata),
					endTimeMs: evt.ts
				});
				setSpanAttrs(span, spanAttrs);
				span.end(evt.ts);
			};
			const recordPayloadLarge = (evt) => {
				const attrs = {
					"openclaw.payload.action": evt.action,
					"openclaw.payload.surface": lowCardinalityAttr(evt.surface, "unknown"),
					"openclaw.channel": lowCardinalityAttr(evt.channel, "none"),
					"openclaw.plugin": lowCardinalityAttr(evt.pluginId, "none"),
					"openclaw.reason": lowCardinalityAttr(evt.reason, "none")
				};
				payloadLargeCounter.add(1, attrs);
				const bytes = positiveFiniteNumber(evt.bytes);
				if (bytes !== void 0) payloadLargeBytesHistogram.record(bytes, attrs);
			};
			const recordExecProcessCompleted = (evt) => {
				const attrs = {
					"openclaw.exec.target": evt.target,
					"openclaw.exec.mode": evt.mode,
					"openclaw.outcome": evt.outcome
				};
				if (evt.failureKind) attrs["openclaw.failureKind"] = evt.failureKind;
				execProcessDurationHistogram.record(evt.durationMs, attrs);
				if (!tracesEnabled) return;
				const spanAttrs = {
					...attrs,
					"openclaw.exec.command_length": evt.commandLength
				};
				if (typeof evt.exitCode === "number") spanAttrs["openclaw.exec.exit_code"] = evt.exitCode;
				if (evt.exitSignal) spanAttrs["openclaw.exec.exit_signal"] = lowCardinalityAttr(evt.exitSignal, "other");
				if (evt.timedOut !== void 0) spanAttrs["openclaw.exec.timed_out"] = evt.timedOut;
				const span = spanWithDuration("openclaw.exec", spanAttrs, evt.durationMs, { endTimeMs: evt.ts });
				if (evt.outcome === "failed") span.setStatus({
					code: SpanStatusCode.ERROR,
					...evt.failureKind ? { message: evt.failureKind } : {}
				});
				span.end(evt.ts);
			};
			const recordHeartbeat = (evt) => {
				queueDepthHistogram.record(evt.queued, { "openclaw.channel": "heartbeat" });
			};
			const recordLivenessWarning = (evt) => {
				const reason = evt.reasons.join(":");
				const attrs = { "openclaw.liveness.reason": lowCardinalityAttr(reason, "unknown") };
				livenessWarningCounter.add(1, attrs);
				queueDepthHistogram.record(evt.queued, { "openclaw.channel": "liveness" });
				if (evt.eventLoopDelayP99Ms !== void 0) livenessEventLoopDelayP99Histogram.record(evt.eventLoopDelayP99Ms, attrs);
				if (evt.eventLoopDelayMaxMs !== void 0) livenessEventLoopDelayMaxHistogram.record(evt.eventLoopDelayMaxMs, attrs);
				if (evt.eventLoopUtilization !== void 0) livenessEventLoopUtilizationHistogram.record(evt.eventLoopUtilization, attrs);
				if (evt.cpuCoreRatio !== void 0) livenessCpuCoreRatioHistogram.record(evt.cpuCoreRatio, attrs);
				if (!tracesEnabled) return;
				const span = spanWithDuration("openclaw.liveness.warning", {
					...attrs,
					"openclaw.liveness.active": evt.active,
					"openclaw.liveness.waiting": evt.waiting,
					"openclaw.liveness.queued": evt.queued,
					"openclaw.liveness.interval_ms": evt.intervalMs,
					...evt.eventLoopDelayP99Ms !== void 0 ? { "openclaw.liveness.event_loop_delay_p99_ms": evt.eventLoopDelayP99Ms } : {},
					...evt.eventLoopDelayMaxMs !== void 0 ? { "openclaw.liveness.event_loop_delay_max_ms": evt.eventLoopDelayMaxMs } : {},
					...evt.eventLoopUtilization !== void 0 ? { "openclaw.liveness.event_loop_utilization": evt.eventLoopUtilization } : {},
					...evt.cpuUserMs !== void 0 ? { "openclaw.liveness.cpu_user_ms": evt.cpuUserMs } : {},
					...evt.cpuSystemMs !== void 0 ? { "openclaw.liveness.cpu_system_ms": evt.cpuSystemMs } : {},
					...evt.cpuTotalMs !== void 0 ? { "openclaw.liveness.cpu_total_ms": evt.cpuTotalMs } : {},
					...evt.cpuCoreRatio !== void 0 ? { "openclaw.liveness.cpu_core_ratio": evt.cpuCoreRatio } : {}
				}, 0, { endTimeMs: evt.ts });
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: reason
				});
				span.end(evt.ts);
			};
			const recordDiagnosticPhaseCompleted = (evt) => {
				if (!tracesEnabled) return;
				const spanAttrs = {
					"openclaw.phase": lowCardinalityAttr(evt.name, "unknown"),
					...evt.cpuUserMs !== void 0 ? { "openclaw.phase.cpu_user_ms": evt.cpuUserMs } : {},
					...evt.cpuSystemMs !== void 0 ? { "openclaw.phase.cpu_system_ms": evt.cpuSystemMs } : {},
					...evt.cpuTotalMs !== void 0 ? { "openclaw.phase.cpu_total_ms": evt.cpuTotalMs } : {},
					...evt.cpuCoreRatio !== void 0 ? { "openclaw.phase.cpu_core_ratio": evt.cpuCoreRatio } : {}
				};
				for (const [key, value] of Object.entries(evt.details ?? {})) spanAttrs[`openclaw.phase.detail.${key}`] = typeof value === "boolean" ? String(value) : value;
				spanWithDuration("openclaw.diagnostic.phase", spanAttrs, evt.durationMs, { endTimeMs: evt.ts }).end(evt.ts);
			};
			const recordTelemetryExporter = (evt, metadata) => {
				if (!metadata.trusted) return;
				telemetryExporterCounter.add(1, {
					"openclaw.exporter": lowCardinalityAttr(evt.exporter, "unknown"),
					"openclaw.signal": evt.signal,
					"openclaw.status": evt.status,
					...evt.reason ? { "openclaw.reason": evt.reason } : {},
					...evt.errorCategory ? { "openclaw.errorCategory": lowCardinalityAttr(evt.errorCategory, "other") } : {}
				});
			};
			const subscribe = ctx.internalDiagnostics?.onEvent;
			if (!subscribe) {
				ctx.logger.error("diagnostics-otel: internal diagnostics capability unavailable");
				return;
			}
			unsubscribe = subscribe((evt, metadata, privateData) => {
				try {
					switch (evt.type) {
						case "model.usage":
							recordModelUsage(evt, metadata);
							return;
						case "webhook.received":
							recordWebhookReceived(evt);
							return;
						case "webhook.processed":
							recordWebhookProcessed(evt);
							return;
						case "webhook.error":
							recordWebhookError(evt);
							return;
						case "message.queued":
							recordMessageQueued(evt);
							return;
						case "message.received":
							recordMessageReceived(evt);
							return;
						case "message.dispatch.started":
							recordMessageDispatchStarted(evt, metadata);
							return;
						case "message.dispatch.completed":
							recordMessageDispatchCompleted(evt);
							return;
						case "message.processed":
							recordMessageProcessed(evt, metadata);
							return;
						case "message.delivery.started":
							recordMessageDeliveryStarted(evt);
							return;
						case "message.delivery.completed":
							recordMessageDeliveryCompleted(evt, metadata);
							return;
						case "message.delivery.error":
							recordMessageDeliveryError(evt, metadata);
							return;
						case "talk.event":
							recordTalkEvent(evt, metadata);
							return;
						case "queue.lane.enqueue":
							recordLaneEnqueue(evt);
							return;
						case "queue.lane.dequeue":
							recordLaneDequeue(evt);
							return;
						case "session.state":
							recordSessionState(evt);
							return;
						case "session.long_running":
						case "session.stalled": return;
						case "session.turn.created":
							recordSessionTurnCreated(evt);
							return;
						case "session.stuck":
							recordSessionStuck(evt);
							return;
						case "session.recovery.requested":
							recordSessionRecoveryRequested(evt);
							return;
						case "session.recovery.completed":
							recordSessionRecoveryCompleted(evt);
							return;
						case "run.attempt":
							recordRunAttempt(evt);
							return;
						case "run.progress": return;
						case "diagnostic.heartbeat":
							recordHeartbeat(evt);
							return;
						case "diagnostic.liveness.warning":
							recordLivenessWarning(evt);
							return;
						case "diagnostic.phase.completed":
							recordDiagnosticPhaseCompleted(evt);
							return;
						case "run.started":
							recordRunStarted(evt, metadata);
							return;
						case "run.completed":
							recordRunCompleted(evt, metadata);
							return;
						case "harness.run.started":
							recordHarnessRunStarted(evt, metadata);
							return;
						case "harness.run.completed":
							recordHarnessRunCompleted(evt, metadata);
							return;
						case "harness.run.error":
							recordHarnessRunError(evt, metadata);
							return;
						case "context.assembled":
							recordContextAssembled(evt, metadata);
							return;
						case "model.call.started":
							recordModelCallStarted(evt, metadata);
							return;
						case "model.call.completed":
							recordModelCallCompleted(evt, metadata, privateData.modelContent);
							return;
						case "model.call.error":
							recordModelCallError(evt, metadata, privateData.modelContent);
							return;
						case "tool.execution.started":
							recordToolExecutionStarted(evt, metadata);
							return;
						case "tool.execution.completed":
							recordToolExecutionCompleted(evt, metadata, privateData.toolContent);
							return;
						case "tool.execution.error":
							recordToolExecutionError(evt, metadata, privateData.toolContent);
							return;
						case "tool.execution.blocked":
							recordToolExecutionBlocked(evt, metadata);
							return;
						case "skill.used":
							recordSkillUsed(evt, metadata);
							return;
						case "exec.process.completed":
							recordExecProcessCompleted(evt);
							return;
						case "log.record":
							recordLogRecord?.(evt, metadata);
							return;
						case "security.event":
							recordSecurityEvent?.(evt, metadata);
							return;
						case "tool.loop":
							recordToolLoop(evt);
							return;
						case "diagnostic.memory.sample":
							recordMemorySample(evt);
							return;
						case "diagnostic.memory.pressure":
							recordMemoryPressure(evt);
							return;
						case "diagnostic.async_queue.dropped":
							recordAsyncQueueDropped(evt);
							return;
						case "telemetry.exporter":
							recordTelemetryExporter(evt, metadata);
							return;
						case "payload.large":
							recordPayloadLarge(evt);
							return;
						case "model.failover": recordModelFailover(evt, metadata);
					}
				} catch (err) {
					ctx.logger.error(`diagnostics-otel: event handler failed (${evt.type}): ${formatError(err)}`);
				}
			});
			unregisterUnhandledRejectionHandler = registerUnhandledRejectionHandler((reason) => {
				const otlpError = findOtlpExporterError(reason);
				if (!otlpError) return false;
				const code = readErrorCode(otlpError) ?? "unknown";
				ctx.logger.warn(`diagnostics-otel: suppressed OTLP exporter unhandled rejection (code=${String(code)})`);
				return true;
			});
			emitForSignals(enabledSignals, {
				exporter: "diagnostics-otel",
				status: "started",
				reason: "configured"
			});
			if (logsEnabled) {
				const label = logsExporter === "both" ? "OTLP/Protobuf + stdout JSONL" : logsExporter === "stdout" ? "stdout JSONL" : "OTLP/Protobuf";
				ctx.logger.info(`diagnostics-otel: logs exporter enabled (${label})`);
			}
		},
		async stop() {
			await stopStarted();
		}
	};
}
//#endregion
//#region extensions/diagnostics-otel/index.ts
var diagnostics_otel_default = definePluginEntry({
	id: "diagnostics-otel",
	name: "Diagnostics OpenTelemetry",
	description: "Export diagnostics events to OpenTelemetry",
	register(api) {
		api.registerService(createDiagnosticsOtelService());
	}
});
//#endregion
export { diagnostics_otel_default as default };
