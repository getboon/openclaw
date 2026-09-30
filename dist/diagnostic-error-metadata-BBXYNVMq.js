import { t as sanitizeControlCharsForLogging } from "./control-char-sanitize-BAIDpw7A.js";
import crypto from "node:crypto";
//#region src/infra/diagnostic-error-metadata.ts
const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;
const REQUEST_ID_HASH_PREFIX_LEN = 12;
const PROVIDER_REQUEST_ID_KEYS = [
	"upstreamRequestId",
	"providerRequestId",
	"requestId",
	"request_id"
];
const PROVIDER_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const PROVIDER_REQUEST_ID_TEXT_PATTERNS = [/\b(?:x-request-id|request-id|request_id|requestId|trace-id|trace_id)\b["'\s:=([]+([A-Za-z0-9._:-]{1,128})/i, /\((?:request_id|trace_id)\s*:\s*([A-Za-z0-9._:-]{1,128})\)/i];
function isObjectLike(value) {
	return (typeof value === "object" || typeof value === "function") && value !== null;
}
function readOwnDataProperty(value, key) {
	if (!isObjectLike(value)) return;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor && "value" in descriptor ? descriptor.value : void 0;
	} catch {
		return;
	}
}
function findDiagnosticErrorProperty(err, reader, seen = /* @__PURE__ */ new Set()) {
	const direct = reader(err);
	if (direct !== void 0) return direct;
	if (!isObjectLike(err) || seen.has(err)) return;
	seen.add(err);
	return findDiagnosticErrorProperty(readOwnDataProperty(err, "error"), reader, seen) ?? findDiagnosticErrorProperty(readOwnDataProperty(err, "cause"), reader, seen);
}
function isHttpStatusCode(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= HTTP_STATUS_MIN && value <= HTTP_STATUS_MAX;
}
function normalizeProviderRequestId(value) {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return PROVIDER_REQUEST_ID_RE.test(trimmed) ? trimmed : void 0;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		const normalized = String(value);
		return PROVIDER_REQUEST_ID_RE.test(normalized) ? normalized : void 0;
	}
	if (typeof value === "bigint") {
		const normalized = String(value);
		return PROVIDER_REQUEST_ID_RE.test(normalized) ? normalized : void 0;
	}
}
function hashDiagnosticIdentifier(value) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex").slice(0, REQUEST_ID_HASH_PREFIX_LEN)}`;
}
function readDirectProviderRequestId(err) {
	for (const key of PROVIDER_REQUEST_ID_KEYS) {
		const normalized = normalizeProviderRequestId(readOwnDataProperty(err, key));
		if (normalized) return normalized;
	}
}
function readDirectMessage(err) {
	if (typeof err === "string") return err;
	const message = readOwnDataProperty(err, "message");
	return typeof message === "string" ? message : void 0;
}
function readDirectCode(err) {
	const code = readOwnDataProperty(err, "code");
	return typeof code === "string" ? code : void 0;
}
function extractProviderRequestIdFromText(text) {
	if (!text) return;
	for (const pattern of PROVIDER_REQUEST_ID_TEXT_PATTERNS) {
		const normalized = normalizeProviderRequestId(text.match(pattern)?.[1]);
		if (normalized) return normalized;
	}
}
/** Returns a low-cardinality error category without trusting mutable `Error.name`. */
function diagnosticErrorCategory(err) {
	try {
		if (err instanceof TypeError) return "TypeError";
		if (err instanceof RangeError) return "RangeError";
		if (err instanceof ReferenceError) return "ReferenceError";
		if (err instanceof SyntaxError) return "SyntaxError";
		if (err instanceof URIError) return "URIError";
		if (typeof AggregateError !== "undefined" && err instanceof AggregateError) return "AggregateError";
		if (err instanceof Error) return "Error";
	} catch {
		return "unknown";
	}
	if (err === null) return "null";
	return typeof err;
}
/** Extracts a safe HTTP status code from own `status` or `statusCode` data properties. */
function diagnosticHttpStatusCode(err) {
	const status = readOwnDataProperty(err, "status");
	if (isHttpStatusCode(status)) return String(status);
	const statusCode = readOwnDataProperty(err, "statusCode");
	if (isHttpStatusCode(statusCode)) return String(statusCode);
}
const UPSTREAM_PROVIDER_ERROR_TYPES = new Set([
	"api_error",
	"overloaded_error",
	"overloaded"
]);
function readProviderErrorType(candidate) {
	const value = readOwnDataProperty(candidate, "type") ?? readOwnDataProperty(candidate, "errorType");
	return typeof value === "string" && value !== "" ? value : void 0;
}
/**
* Classifies a 5xx model-call failure as upstream-provider vs gateway-origin
* (ENG-16922), so an observer can page on them differently. Status-driven, NOT
* text-driven — no free-text message regex (that fragility is what ENG-16815
* deliberately removed). Returns undefined for a missing or non-5xx status.
*
* The split mirrors boon-llm-gateway's single-hop behavior: a real upstream 5xx
* (Bedrock/Anthropic 500/503/529) is relayed verbatim, while the gateway only
* *synthesizes* 502 for its own faults (chain exhausted, WAF/HTML block page,
* no-response transport failure). So:
*   - 502              -> gateway_origin_5xx (the gateway made the final call)
*   - 500 / 503 / 529  -> upstream_provider_5xx (relayed provider outage)
*   - other 5xx        -> gateway_origin_5xx (conservative: unknown => our infra)
* A recognized upstream provider `error.type` (api_error/overloaded) forces the
* upstream class even on an ambiguous status, breaking ties without regex.
*/
function classify5xxSource(httpStatus, err) {
	if (httpStatus === void 0 || httpStatus < 500 || httpStatus > 599) return;
	const providerType = findDiagnosticErrorProperty(err, readProviderErrorType);
	if (providerType && UPSTREAM_PROVIDER_ERROR_TYPES.has(providerType)) return "upstream_provider_5xx";
	if (httpStatus === 500 || httpStatus === 503 || httpStatus === 529) return "upstream_provider_5xx";
	return "gateway_origin_5xx";
}
/** Classifies transport-style failures without exposing raw error messages. */
function diagnosticErrorFailureKind(err) {
	switch (findDiagnosticErrorProperty(err, readDirectCode)?.trim().toUpperCase()) {
		case void 0: break;
		case "ABORT_ERR":
		case "ECONNABORTED":
		case "ERR_ABORTED": return "aborted";
		case "ECONNRESET": return "connection_reset";
		case "ERR_STREAM_PREMATURE_CLOSE":
		case "UND_ERR_SOCKET": return "connection_closed";
		case "ETIMEDOUT":
		case "ERR_SOCKET_CONNECTION_TIMEOUT": return "timeout";
	}
	const message = findDiagnosticErrorProperty(err, readDirectMessage);
	if (!message) return;
	if (/\b(?:terminated|sigkill|sigterm)\b/i.test(message)) return "terminated";
	if (/\b(?:econnreset|connection reset)\b/i.test(message)) return "connection_reset";
	if (/\b(?:socket hang up|premature close|connection closed|other side closed)\b/i.test(message)) return "connection_closed";
	if (/\b(?:timed out|timeout|etimedout)\b/i.test(message)) return "timeout";
	if (/\b(?:aborted|abort_err|operation was aborted)\b/i.test(message)) return "aborted";
}
/** Extracts and hashes bounded provider request ids so diagnostics never expose raw ids. */
function diagnosticProviderRequestIdHash(err) {
	const fromProperty = findDiagnosticErrorProperty(err, readDirectProviderRequestId);
	if (fromProperty) return hashDiagnosticIdentifier(fromProperty);
	const fromMessage = findDiagnosticErrorProperty(err, (candidate) => extractProviderRequestIdFromText(readDirectMessage(candidate)));
	return fromMessage ? hashDiagnosticIdentifier(fromMessage) : void 0;
}
const FAILOVER_DETAIL_PROPS = [
	"reason",
	"status",
	"code",
	"provider",
	"model",
	"rawError"
];
const MAX_FAILOVER_DETAIL_VALUE_CHARS = 200;
function readDirectStringProperty(err, key) {
	const value = readOwnDataProperty(err, key);
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function readDirectLoggableProperty(err, key) {
	const value = readOwnDataProperty(err, key);
	if (typeof value === "string" && value.length > 0) return value;
	return typeof value === "number" && Number.isFinite(value) ? String(value) : void 0;
}
function isFailoverErrorShaped(err) {
	return readDirectStringProperty(err, "name") === "FailoverError" && typeof readOwnDataProperty(err, "reason") === "string";
}
function truncateEscapedAtWholeUnit(escaped, maxChars) {
	if (escaped.length <= maxChars) return escaped;
	let cut = maxChars;
	let trailingBackslashRun = 0;
	for (let i = cut - 1; i >= 0 && escaped[i] === "\\"; i--) trailingBackslashRun++;
	if (trailingBackslashRun % 2 === 1) cut -= 1;
	return `${escaped.slice(0, cut)}…`;
}
function formatFailoverDetailValue(value) {
	return truncateEscapedAtWholeUnit(sanitizeControlCharsForLogging(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\""), MAX_FAILOVER_DETAIL_VALUE_CHARS);
}
/** Formats a FailoverError-shaped error's reason/status/code/provider/model/rawError as a bounded, single-line log suffix. */
function diagnosticFailoverDetailSuffix(err) {
	if (!isFailoverErrorShaped(err)) return "";
	let suffix = "";
	for (const prop of FAILOVER_DETAIL_PROPS) {
		const value = readDirectLoggableProperty(err, prop);
		if (!value) continue;
		const formatted = formatFailoverDetailValue(value);
		if (!formatted) continue;
		suffix += ` ${prop}="${formatted}"`;
	}
	return suffix;
}
//#endregion
export { diagnosticHttpStatusCode as a, diagnosticFailoverDetailSuffix as i, diagnosticErrorCategory as n, diagnosticProviderRequestIdHash as o, diagnosticErrorFailureKind as r, classify5xxSource as t };
