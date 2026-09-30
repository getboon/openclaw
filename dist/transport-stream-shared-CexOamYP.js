import { c as redactSensitiveText } from "./redact-BFQyU94D.js";
import { r as createAssistantMessageEventStream } from "./event-stream-ReMmOTzX.js";
import { _ as truncateErrorDetail } from "./provider-http-errors-BMy4Th7x.js";
//#region src/agents/transport-stream-shared.ts
/**
* Shared transport-stream normalization helpers.
*
* Sanitizes provider payloads, merges metadata, and formats streamed assistant events.
*/
const EMPTY_TOOL_RESULT_TEXT = "(no output)";
function sanitizeTransportPayloadText(text) {
	if (typeof text !== "string") return "";
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
function sanitizeNonEmptyTransportPayloadText(text, fallback = EMPTY_TOOL_RESULT_TEXT) {
	const sanitized = sanitizeTransportPayloadText(text);
	return sanitized.trim().length > 0 ? sanitized : fallback;
}
function coerceTransportToolCallArguments(argumentsValue) {
	if (argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)) return argumentsValue;
	if (typeof argumentsValue === "string") try {
		const parsed = JSON.parse(argumentsValue);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
	} catch {}
	return {};
}
function mergeTransportHeaders(...headerSources) {
	const merged = {};
	const headerNamesByLowerKey = /* @__PURE__ */ new Map();
	for (const headers of headerSources) if (headers) for (const [key, value] of Object.entries(headers)) {
		const normalizedKey = key.toLowerCase();
		const previousKey = headerNamesByLowerKey.get(normalizedKey);
		if (previousKey && previousKey !== key) delete merged[previousKey];
		merged[key] = value;
		headerNamesByLowerKey.set(normalizedKey, key);
	}
	return Object.keys(merged).length > 0 ? merged : void 0;
}
function isProvisioningSmokeHeaderName(key) {
	const normalized = key.toLowerCase();
	return normalized === "x-boon-session-id" || normalized.startsWith("x-boon-provisioning-smoke-");
}
function preserveProvisioningSmokeSessionHeader(headers, modelHeaders) {
	if (!Object.entries(modelHeaders ?? {}).some(([key, value]) => key.toLowerCase() === "x-boon-session-id" && value.startsWith("provisioning-smoke-"))) return headers;
	return mergeTransportHeaders(headers, Object.fromEntries(Object.entries(modelHeaders ?? {}).filter(([key]) => isProvisioningSmokeHeaderName(key))));
}
function mergeTransportMetadata(payload, metadata) {
	if (!metadata || Object.keys(metadata).length === 0) return payload;
	const existingMetadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : void 0;
	return {
		...payload,
		metadata: {
			...existingMetadata,
			...metadata
		}
	};
}
function createEmptyTransportUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0
		}
	};
}
function createWritableTransportEventStream() {
	const eventStream = createAssistantMessageEventStream();
	return {
		eventStream,
		stream: eventStream
	};
}
function finalizeTransportStream(params) {
	const { stream, output, signal } = params;
	if (signal?.aborted) throw new Error("Request was aborted");
	if (output.stopReason === "aborted" || output.stopReason === "error") throw new Error(output.errorMessage ?? "An unknown error occurred");
	stream.push({
		type: "done",
		reason: output.stopReason,
		message: output
	});
	stream.end();
}
function readStringLikeProperty(value, key) {
	if (!value || typeof value !== "object") return;
	const raw = value[key];
	if (typeof raw === "string") return raw.trim() || void 0;
	if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
}
function readObjectProperty(value, key) {
	if (!value || typeof value !== "object") return;
	const raw = value[key];
	return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : void 0;
}
function stringifyErrorBody(value) {
	if (typeof value === "string") return value;
	if (value === void 0 || value === null) return;
	try {
		return JSON.stringify(value);
	} catch {
		return;
	}
}
function normalizeTransportErrorBody(value) {
	const text = stringifyErrorBody(value);
	if (!text?.trim()) return;
	return truncateErrorDetail(redactSensitiveText(text), 500);
}
function readNumericErrorStatus(value) {
	if (!value || typeof value !== "object") return;
	const source = value;
	for (const candidate of [
		source.status,
		source.statusCode,
		source.errorStatus
	]) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
		if (typeof candidate === "string") {
			const parsed = Number.parseInt(candidate, 10);
			if (Number.isFinite(parsed) && String(parsed) === candidate.trim()) return parsed;
		}
	}
}
function extractTransportErrorDetails(error) {
	const errorObject = error && typeof error === "object" ? error : void 0;
	const nestedError = readObjectProperty(errorObject, "error");
	const errorCode = readStringLikeProperty(errorObject, "errorCode") ?? readStringLikeProperty(errorObject, "code") ?? readStringLikeProperty(nestedError, "code");
	const errorType = readStringLikeProperty(errorObject, "errorType") ?? readStringLikeProperty(errorObject, "type") ?? readStringLikeProperty(nestedError, "type");
	const errorBody = normalizeTransportErrorBody(readStringLikeProperty(errorObject, "errorBody")) ?? normalizeTransportErrorBody(readStringLikeProperty(errorObject, "body")) ?? normalizeTransportErrorBody(readObjectProperty(errorObject, "body")) ?? normalizeTransportErrorBody(nestedError);
	const errorStatus = readNumericErrorStatus(errorObject);
	return {
		...errorCode ? { errorCode } : {},
		...errorType ? { errorType } : {},
		...errorBody ? { errorBody } : {},
		...errorStatus !== void 0 ? { errorStatus } : {}
	};
}
function assignTransportErrorDetails(output, error, signal) {
	output.stopReason = signal?.aborted ? "aborted" : "error";
	output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
	Object.assign(output, extractTransportErrorDetails(error));
}
function failTransportStream(params) {
	const { stream, output, signal, error, cleanup } = params;
	cleanup?.();
	assignTransportErrorDetails(output, error, signal);
	stream.push({
		type: "error",
		reason: output.stopReason,
		error: output
	});
	stream.end();
}
//#endregion
export { failTransportStream as a, mergeTransportHeaders as c, sanitizeNonEmptyTransportPayloadText as d, sanitizeTransportPayloadText as f, createWritableTransportEventStream as i, mergeTransportMetadata as l, coerceTransportToolCallArguments as n, finalizeTransportStream as o, createEmptyTransportUsage as r, isProvisioningSmokeHeaderName as s, assignTransportErrorDetails as t, preserveProvisioningSmokeSessionHeader as u };
