// Extracts provider diagnostic metadata from error objects and text.
import crypto from "node:crypto";
import { sanitizeControlCharsForLogging } from "./control-char-sanitize.js";

const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;
const REQUEST_ID_HASH_PREFIX_LEN = 12;
const PROVIDER_REQUEST_ID_KEYS = [
  "upstreamRequestId",
  "providerRequestId",
  "requestId",
  "request_id",
] as const;
const PROVIDER_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const PROVIDER_REQUEST_ID_TEXT_PATTERNS = [
  /\b(?:x-request-id|request-id|request_id|requestId|trace-id|trace_id)\b["'\s:=([]+([A-Za-z0-9._:-]{1,128})/i,
  /\((?:request_id|trace_id)\s*:\s*([A-Za-z0-9._:-]{1,128})\)/i,
] as const;

type DiagnosticErrorFailureKind =
  | "aborted"
  | "connection_closed"
  | "connection_reset"
  | "terminated"
  | "timeout";

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (!isObjectLike(value)) {
    return undefined;
  }
  try {
    // Read only own data properties; diagnostic extraction must not trigger userland getters.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function findDiagnosticErrorProperty<T>(
  err: unknown,
  reader: (candidate: unknown) => T | undefined,
  seen: Set<object> = new Set(),
): T | undefined {
  const direct = reader(err);
  if (direct !== undefined) {
    return direct;
  }
  if (!isObjectLike(err) || seen.has(err)) {
    return undefined;
  }
  seen.add(err);
  return (
    findDiagnosticErrorProperty(readOwnDataProperty(err, "error"), reader, seen) ??
    findDiagnosticErrorProperty(readOwnDataProperty(err, "cause"), reader, seen)
  );
}

function isHttpStatusCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= HTTP_STATUS_MIN &&
    value <= HTTP_STATUS_MAX
  );
}

function normalizeProviderRequestId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return PROVIDER_REQUEST_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = String(value);
    return PROVIDER_REQUEST_ID_RE.test(normalized) ? normalized : undefined;
  }
  if (typeof value === "bigint") {
    const normalized = String(value);
    return PROVIDER_REQUEST_ID_RE.test(normalized) ? normalized : undefined;
  }
  return undefined;
}

function hashDiagnosticIdentifier(value: string): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, REQUEST_ID_HASH_PREFIX_LEN)}`;
}

function readDirectProviderRequestId(err: unknown): string | undefined {
  for (const key of PROVIDER_REQUEST_ID_KEYS) {
    const normalized = normalizeProviderRequestId(readOwnDataProperty(err, key));
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function readDirectMessage(err: unknown): string | undefined {
  if (typeof err === "string") {
    return err;
  }
  const message = readOwnDataProperty(err, "message");
  return typeof message === "string" ? message : undefined;
}

function readDirectCode(err: unknown): string | undefined {
  const code = readOwnDataProperty(err, "code");
  return typeof code === "string" ? code : undefined;
}

function extractProviderRequestIdFromText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  for (const pattern of PROVIDER_REQUEST_ID_TEXT_PATTERNS) {
    const normalized = normalizeProviderRequestId(text.match(pattern)?.[1]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

/** Returns a low-cardinality error category without trusting mutable `Error.name`. */
export function diagnosticErrorCategory(err: unknown): string {
  try {
    if (err instanceof TypeError) {
      return "TypeError";
    }
    if (err instanceof RangeError) {
      return "RangeError";
    }
    if (err instanceof ReferenceError) {
      return "ReferenceError";
    }
    if (err instanceof SyntaxError) {
      return "SyntaxError";
    }
    if (err instanceof URIError) {
      return "URIError";
    }
    if (typeof AggregateError !== "undefined" && err instanceof AggregateError) {
      return "AggregateError";
    }
    if (err instanceof Error) {
      return "Error";
    }
  } catch {
    return "unknown";
  }
  if (err === null) {
    return "null";
  }
  return typeof err;
}

/** Extracts a safe HTTP status code from own `status` or `statusCode` data properties. */
export function diagnosticHttpStatusCode(err: unknown): string | undefined {
  const status = readOwnDataProperty(err, "status");
  if (isHttpStatusCode(status)) {
    return String(status);
  }
  const statusCode = readOwnDataProperty(err, "statusCode");
  if (isHttpStatusCode(statusCode)) {
    return String(statusCode);
  }
  return undefined;
}

/** Source classification of a 5xx model-call failure (see PluginHookModelCallEndedEvent). */
export type Diagnostic5xxSource = "upstream_provider_5xx" | "gateway_origin_5xx";

// Provider error-type keys checked (own data props only) for the tie-break: a
// Bedrock/Anthropic relay body carries error.type = "api_error"/"overloaded".
const UPSTREAM_PROVIDER_ERROR_TYPES = new Set(["api_error", "overloaded_error", "overloaded"]);

function readProviderErrorType(candidate: unknown): string | undefined {
  const value =
    readOwnDataProperty(candidate, "type") ?? readOwnDataProperty(candidate, "errorType");
  return typeof value === "string" && value !== "" ? value : undefined;
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
export function classify5xxSource(
  httpStatus: number | undefined,
  err?: unknown,
): Diagnostic5xxSource | undefined {
  if (httpStatus === undefined || httpStatus < 500 || httpStatus > 599) {
    return undefined;
  }
  const providerType = findDiagnosticErrorProperty(err, readProviderErrorType);
  if (providerType && UPSTREAM_PROVIDER_ERROR_TYPES.has(providerType)) {
    return "upstream_provider_5xx";
  }
  if (httpStatus === 500 || httpStatus === 503 || httpStatus === 529) {
    return "upstream_provider_5xx";
  }
  return "gateway_origin_5xx";
}

/** Classifies transport-style failures without exposing raw error messages. */
export function diagnosticErrorFailureKind(err: unknown): DiagnosticErrorFailureKind | undefined {
  const code = findDiagnosticErrorProperty(err, readDirectCode)?.trim().toUpperCase();
  switch (code) {
    case undefined:
      break;
    case "ABORT_ERR":
    case "ECONNABORTED":
    case "ERR_ABORTED":
      return "aborted";
    case "ECONNRESET":
      return "connection_reset";
    case "ERR_STREAM_PREMATURE_CLOSE":
    case "UND_ERR_SOCKET":
      return "connection_closed";
    case "ETIMEDOUT":
    case "ERR_SOCKET_CONNECTION_TIMEOUT":
      return "timeout";
  }

  const message = findDiagnosticErrorProperty(err, readDirectMessage);
  if (!message) {
    return undefined;
  }
  if (/\b(?:terminated|sigkill|sigterm)\b/i.test(message)) {
    return "terminated";
  }
  if (/\b(?:econnreset|connection reset)\b/i.test(message)) {
    return "connection_reset";
  }
  if (/\b(?:socket hang up|premature close|connection closed|other side closed)\b/i.test(message)) {
    return "connection_closed";
  }
  if (/\b(?:timed out|timeout|etimedout)\b/i.test(message)) {
    return "timeout";
  }
  if (/\b(?:aborted|abort_err|operation was aborted)\b/i.test(message)) {
    return "aborted";
  }
  return undefined;
}

/** Extracts and hashes bounded provider request ids so diagnostics never expose raw ids. */
export function diagnosticProviderRequestIdHash(err: unknown): string | undefined {
  const fromProperty = findDiagnosticErrorProperty(err, readDirectProviderRequestId);
  if (fromProperty) {
    return hashDiagnosticIdentifier(fromProperty);
  }
  const fromMessage = findDiagnosticErrorProperty(err, (candidate) =>
    extractProviderRequestIdFromText(readDirectMessage(candidate)),
  );
  return fromMessage ? hashDiagnosticIdentifier(fromMessage) : undefined;
}

const FAILOVER_DETAIL_PROPS = [
  "reason",
  "status",
  "code",
  "provider",
  "model",
  "rawError",
] as const;
const MAX_FAILOVER_DETAIL_VALUE_CHARS = 200;

function readDirectStringProperty(err: unknown, key: string): string | undefined {
  const value = readOwnDataProperty(err, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readDirectLoggableProperty(err: unknown, key: string): string | undefined {
  const value = readOwnDataProperty(err, key);
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

// Mirrors isFailoverError's own-property duck-type check (agents/failover-error.ts)
// without importing it, so an unrelated error can't be mislabeled as failover detail.
function isFailoverErrorShaped(err: unknown): boolean {
  return (
    readDirectStringProperty(err, "name") === "FailoverError" &&
    typeof readOwnDataProperty(err, "reason") === "string"
  );
}

// A truncation cut can land inside an escaped `\\` or `\"` pair, leaving a
// dangling backslash that then escapes the log line's own closing quote.
// Back off by one char whenever the trailing backslash run is unpaired.
function truncateEscapedAtWholeUnit(escaped: string, maxChars: number): string {
  if (escaped.length <= maxChars) {
    return escaped;
  }
  let cut = maxChars;
  let trailingBackslashRun = 0;
  for (let i = cut - 1; i >= 0 && escaped[i] === "\\"; i--) {
    trailingBackslashRun++;
  }
  if (trailingBackslashRun % 2 === 1) {
    cut -= 1;
  }
  return `${escaped.slice(0, cut)}…`;
}

function formatFailoverDetailValue(value: string): string {
  const singleLine = sanitizeControlCharsForLogging(value);
  const escaped = singleLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return truncateEscapedAtWholeUnit(escaped, MAX_FAILOVER_DETAIL_VALUE_CHARS);
}

// FailoverError.message is consumer-audience-redacted copy, never the raw
// provider failure (see CONSUMER_ERROR_COPY in embedded-agent-helpers/errors.ts).
// This recovers the detail from FailoverError's own data properties instead.
/** Formats a FailoverError-shaped error's reason/status/code/provider/model/rawError as a bounded, single-line log suffix. */
export function diagnosticFailoverDetailSuffix(err: unknown): string {
  if (!isFailoverErrorShaped(err)) {
    return "";
  }
  let suffix = "";
  for (const prop of FAILOVER_DETAIL_PROPS) {
    const value = readDirectLoggableProperty(err, prop);
    if (!value) {
      continue;
    }
    const formatted = formatFailoverDetailValue(value);
    if (!formatted) {
      continue;
    }
    suffix += ` ${prop}="${formatted}"`;
  }
  return suffix;
}
