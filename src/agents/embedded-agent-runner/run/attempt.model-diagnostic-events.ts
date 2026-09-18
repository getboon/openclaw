import { isRecord } from "@openclaw/normalization-core/record-coerce";
/**
 * Emits diagnostic model-call events around embedded-agent stream functions.
 */
import { fireAndForgetBoundedHook } from "../../../hooks/fire-and-forget.js";
import {
  classify5xxSource,
  diagnosticErrorCategory,
  diagnosticErrorFailureKind,
  diagnosticHttpStatusCode,
  diagnosticProviderRequestIdHash,
} from "../../../infra/diagnostic-error-metadata.js";
import {
  areDiagnosticsEnabledForProcess,
  emitTrustedDiagnosticEvent,
  type DiagnosticEventInput,
  type DiagnosticModelCallContent,
  type DiagnosticMemoryUsage,
  emitTrustedDiagnosticEventWithPrivateData,
} from "../../../infra/diagnostic-events.js";
import {
  cloneDiagnosticContentValue,
  type DiagnosticModelContentCapturePolicy,
} from "../../../infra/diagnostic-llm-content.js";
import {
  createChildDiagnosticTraceContext,
  freezeDiagnosticTraceContext,
  formatDiagnosticTraceparent,
  type DiagnosticTraceContext,
} from "../../../infra/diagnostic-trace-context.js";
import { markDiagnosticRunProgress } from "../../../logging/diagnostic-run-activity.js";
import { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type {
  PluginHookAgentContext,
  PluginHookContextWindowSource,
  PluginHookModelCallEndedEvent,
  PluginHookModelCallStartedEvent,
} from "../../../plugins/hook-types.js";
import type { StreamFn } from "../../runtime/index.js";
import { log } from "../logger.js";

type ModelCallDiagnosticContext = {
  runId: string;
  sessionKey?: string;
  sessionId?: string;
  senderId?: string;
  senderName?: string;
  senderSource?: string;
  threadId?: string;
  // Gateway-audience OBO (set on MsgContext.OboToken by anychat-boon-web,
  // ENG-19116) carrying boon-core's signed internal_test claim. Emitted as
  // x-boon-gateway-obo-token for the gateway to verify and skip metering
  // internal-test traffic (ENG-19117). Opaque token — forwarded verbatim,
  // never logged.
  oboToken?: string;
  provider: string;
  model: string;
  api?: string;
  transport?: string;
  contextTokenBudget?: number;
  contextWindowSource?: PluginHookContextWindowSource;
  contextWindowReferenceTokens?: number;
  trace: DiagnosticTraceContext;
  contentCapture?: DiagnosticModelContentCapturePolicy;
  nextCallId: () => string;
  onStarted?: () => void;
};

type ModelCallEventBase = Omit<
  Extract<DiagnosticEventInput, { type: "model.call.started" }>,
  "type"
>;
type ModelCallErrorFields = Pick<
  Extract<DiagnosticEventInput, { type: "model.call.error" }>,
  "errorCategory" | "failureKind" | "httpStatus" | "errorClass" | "memory" | "upstreamRequestIdHash"
>;
type ModelCallEndedHookFields = Pick<
  PluginHookModelCallEndedEvent,
  | "durationMs"
  | "outcome"
  | "errorCategory"
  | "requestPayloadBytes"
  | "responseStreamBytes"
  | "timeToFirstByteMs"
  | "failureKind"
  | "httpStatus"
  | "errorClass"
  | "upstreamRequestIdHash"
>;
type ModelCallSizeTimingFields = Pick<
  Extract<DiagnosticEventInput, { type: "model.call.completed" }>,
  "requestPayloadBytes" | "responseStreamBytes" | "timeToFirstByteMs"
>;
type ModelCallObservationState = {
  requestPayloadBytes?: number;
  responseStreamBytes: number;
  timeToFirstByteMs?: number;
  modelContent?: DiagnosticModelCallContent;
  outputMessages?: unknown[];
  contentCapture?: DiagnosticModelContentCapturePolicy;
  lastStreamProgressAt?: number;
  terminalEventEmitted?: boolean;
};

const MODEL_CALL_STREAM_PROGRESS_INTERVAL_MS = 30_000;
const MODEL_CALL_STREAM_PROGRESS_REASON = "model_call:stream_progress";
const MODEL_CALL_STREAM_RETURN_TIMEOUT_MS = 1000;
const TRACEPARENT_HEADER_NAME = "traceparent";
// Boon usage-attribution headers: the gateway records these on each
// LLM request log so boon-core can break token usage down per session / per user.
// user-id is the stable per-platform id; user-name + user-source make it legible
// in the dashboard (e.g. "Alice" via "slack"). Header names are lowercase;
// downstream readers (Go net/http) canonicalize.
const BOON_SESSION_HEADER_NAME = "x-boon-session-id";
const BOON_USER_HEADER_NAME = "x-boon-user-id";
const BOON_USER_NAME_HEADER_NAME = "x-boon-user-name";
const BOON_USER_SOURCE_HEADER_NAME = "x-boon-user-source";
// The Boon web-chat thread id (AgentChatThread.id). boon-core joins it to the
// chat title so the usage dashboard shows a readable session name instead of the
// opaque per-session UUID. Absent for non-web surfaces (Slack/Teams) → omitted.
const BOON_THREAD_HEADER_NAME = "x-boon-thread-id";
// The gateway-audience OBO token (ENG-19115). boon-core mints it, anychat-boon-web
// puts it on MsgContext.OboToken (ENG-19116); the gateway verifies it fail-closed
// (ENG-19117) to skip metering internal-test traffic. Omitted when absent.
// Name pinned by the gateway verifier's header constant
// (`X-Boon-Gateway-Obo-Token`); lowercase here — the gateway canonicalizes on
// read. A mismatch would fail-open (traffic metered), so this must stay in
// lockstep with that constant.
const BOON_OBO_HEADER_NAME = "x-boon-gateway-obo-token";
type ModelCallStreamOptions = Parameters<StreamFn>[2];

function utf8JsonByteLength(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

function assignRequestPayloadBytes(state: ModelCallObservationState, payload: unknown): void {
  const bytes = utf8JsonByteLength(payload);
  if (bytes !== undefined) {
    state.requestPayloadBytes = bytes;
  }
}

function utf8StringByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function streamDeltaByteLength(chunk: Record<string, unknown>): number | undefined {
  const type = chunk.type;
  if (
    (type === "text_delta" || type === "thinking_delta" || type === "toolcall_delta") &&
    typeof chunk.delta === "string"
  ) {
    return utf8StringByteLength(chunk.delta);
  }
  return undefined;
}

function responseStreamChunkByteLengthUnchecked(chunk: unknown): number | undefined {
  if (!isRecord(chunk)) {
    return utf8JsonByteLength(chunk);
  }
  const deltaBytes = streamDeltaByteLength(chunk);
  if (deltaBytes !== undefined) {
    return deltaBytes;
  }
  if (!("partial" in chunk)) {
    return utf8JsonByteLength(chunk);
  }
  // Plain stream deltas can carry an accumulated partial snapshot. Byte metrics
  // count the new stream payload, not the answer-so-far replay.
  const { partial: _partial, ...snapshotlessChunk } = chunk;
  return utf8JsonByteLength(snapshotlessChunk);
}

function responseStreamChunkByteLength(chunk: unknown): number | undefined {
  try {
    return responseStreamChunkByteLengthUnchecked(chunk);
  } catch {
    return undefined;
  }
}

function streamContextModelContentFields(
  policy: DiagnosticModelContentCapturePolicy | undefined,
  streamContext: unknown,
): DiagnosticModelCallContent | undefined {
  if (!policy?.anyModelContent || !isRecord(streamContext)) {
    return undefined;
  }
  const content = {
    ...(policy.inputMessages && Array.isArray(streamContext.messages)
      ? { inputMessages: cloneDiagnosticContentValue(streamContext.messages) }
      : {}),
    ...(policy.systemPrompt && typeof streamContext.systemPrompt === "string"
      ? { systemPrompt: streamContext.systemPrompt }
      : {}),
    ...(policy.toolDefinitions && Array.isArray(streamContext.tools)
      ? { toolDefinitions: cloneDiagnosticContentValue(streamContext.tools) }
      : {}),
  };
  return Object.keys(content).length > 0 ? content : undefined;
}

function observeOutputMessageContent(state: ModelCallObservationState, chunk: unknown): void {
  if (!state.contentCapture?.outputMessages || !isRecord(chunk)) {
    return;
  }
  const message =
    chunk.type === "done" ? chunk.message : chunk.type === "error" ? chunk.error : undefined;
  if (message !== undefined) {
    state.outputMessages = [cloneDiagnosticContentValue(message)];
  }
}

function observeResultMessageContent(
  state: ModelCallObservationState,
  startedAt: number,
  result: unknown,
): void {
  state.timeToFirstByteMs ??= Math.max(0, Date.now() - startedAt);
  if (state.contentCapture?.outputMessages && state.outputMessages === undefined) {
    state.outputMessages = [cloneDiagnosticContentValue(result)];
  }
  if (state.responseStreamBytes === 0) {
    const bytes = utf8JsonByteLength(result);
    if (bytes !== undefined) {
      state.responseStreamBytes = bytes;
    }
  }
}

function observeResponseChunk(
  state: ModelCallObservationState,
  startedAt: number,
  chunk: unknown,
): void {
  state.timeToFirstByteMs ??= Math.max(0, Date.now() - startedAt);
  observeOutputMessageContent(state, chunk);
  const bytes = responseStreamChunkByteLength(chunk);
  if (bytes !== undefined) {
    state.responseStreamBytes += bytes;
  }
}

function maybeEmitModelCallStreamProgress(
  eventBase: ModelCallEventBase,
  state: ModelCallObservationState,
): void {
  if (!areDiagnosticsEnabledForProcess()) {
    return;
  }
  const now = Date.now();
  const progressFields = {
    runId: eventBase.runId,
    ...(eventBase.sessionKey ? { sessionKey: eventBase.sessionKey } : {}),
    ...(eventBase.sessionId ? { sessionId: eventBase.sessionId } : {}),
    reason: MODEL_CALL_STREAM_PROGRESS_REASON,
  };
  markDiagnosticRunProgress(progressFields);
  if (
    state.lastStreamProgressAt !== undefined &&
    now - state.lastStreamProgressAt < MODEL_CALL_STREAM_PROGRESS_INTERVAL_MS
  ) {
    return;
  }
  state.lastStreamProgressAt = now;
  // Streaming providers, local or remote, are expected to produce chunks or
  // heartbeat-style progress. The in-memory freshness clock is refreshed for
  // each chunk, while diagnostic events are throttled so token streams do not
  // spam observers; silent/non-streaming calls remain recoverable after the
  // configured stuck-session timeout.
  emitTrustedDiagnosticEvent({
    type: "run.progress",
    ...progressFields,
  });
}

function modelCallSizeTimingFields(state: ModelCallObservationState): ModelCallSizeTimingFields {
  return {
    ...(state.requestPayloadBytes !== undefined
      ? { requestPayloadBytes: state.requestPayloadBytes }
      : {}),
    ...(state.responseStreamBytes > 0 ? { responseStreamBytes: state.responseStreamBytes } : {}),
    ...(state.timeToFirstByteMs !== undefined
      ? { timeToFirstByteMs: state.timeToFirstByteMs }
      : {}),
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  try {
    return typeof (value as { then?: unknown }).then === "function";
  } catch {
    return false;
  }
}

function asyncIteratorFactory(value: unknown): (() => AsyncIterator<unknown>) | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  try {
    const asyncIterator = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
    if (typeof asyncIterator !== "function") {
      return undefined;
    }
    return () => asyncIterator.call(value) as AsyncIterator<unknown>;
  } catch {
    return undefined;
  }
}

function baseModelCallEvent(
  ctx: ModelCallDiagnosticContext,
  callId: string,
  trace: DiagnosticTraceContext,
): ModelCallEventBase {
  return {
    runId: ctx.runId,
    callId,
    ...(ctx.sessionKey && { sessionKey: ctx.sessionKey }),
    ...(ctx.sessionId && { sessionId: ctx.sessionId }),
    provider: ctx.provider,
    model: ctx.model,
    ...(ctx.api && { api: ctx.api }),
    ...(ctx.transport && { transport: ctx.transport }),
    ...(ctx.contextTokenBudget ? { contextTokenBudget: ctx.contextTokenBudget } : {}),
    ...(ctx.contextWindowSource ? { contextWindowSource: ctx.contextWindowSource } : {}),
    ...(ctx.contextWindowReferenceTokens
      ? { contextWindowReferenceTokens: ctx.contextWindowReferenceTokens }
      : {}),
    trace,
  };
}

function modelContentPrivateData(modelContent: DiagnosticModelCallContent | undefined) {
  return modelContent ? { modelContent } : undefined;
}

function modelCallCompletedContent(state: ModelCallObservationState) {
  if (!state.modelContent && !state.outputMessages) {
    return undefined;
  }
  return {
    ...state.modelContent,
    ...(state.outputMessages ? { outputMessages: state.outputMessages } : {}),
  };
}

function modelCallErrorFields(err: unknown): ModelCallErrorFields {
  const upstreamRequestIdHash = diagnosticProviderRequestIdHash(err);
  const failureKind = diagnosticErrorFailureKind(err);
  // ENG-16922: thread the HTTP status + upstream-vs-gateway 5xx source so an
  // observer (sentry-monitor) can page on a Bedrock outage separately from a
  // gateway-origin fault. httpStatus is absent for transport-level failures
  // with no response (those are already described by failureKind).
  const httpStatusStr = diagnosticHttpStatusCode(err);
  const httpStatus = httpStatusStr === undefined ? undefined : Number(httpStatusStr);
  const errorClass = classify5xxSource(httpStatus, err);
  return {
    errorCategory: diagnosticErrorCategory(err),
    ...(failureKind ? { failureKind, memory: processMemoryUsageSnapshot() } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(errorClass ? { errorClass } : {}),
    ...(upstreamRequestIdHash ? { upstreamRequestIdHash } : {}),
  };
}

function processMemoryUsageSnapshot(): DiagnosticMemoryUsage | undefined {
  try {
    const memory = process.memoryUsage();
    return {
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    };
  } catch {
    return undefined;
  }
}

function modelCallHookEventBase(eventBase: ModelCallEventBase): PluginHookModelCallStartedEvent {
  return {
    runId: eventBase.runId,
    callId: eventBase.callId,
    ...(eventBase.sessionKey ? { sessionKey: eventBase.sessionKey } : {}),
    ...(eventBase.sessionId ? { sessionId: eventBase.sessionId } : {}),
    provider: eventBase.provider,
    model: eventBase.model,
    ...(eventBase.api ? { api: eventBase.api } : {}),
    ...(eventBase.transport ? { transport: eventBase.transport } : {}),
    ...(eventBase.contextTokenBudget ? { contextTokenBudget: eventBase.contextTokenBudget } : {}),
    ...(eventBase.contextWindowSource
      ? { contextWindowSource: eventBase.contextWindowSource }
      : {}),
    ...(eventBase.contextWindowReferenceTokens
      ? { contextWindowReferenceTokens: eventBase.contextWindowReferenceTokens }
      : {}),
  };
}

function modelCallHookContext(eventBase: ModelCallEventBase): PluginHookAgentContext {
  return Object.freeze({
    runId: eventBase.runId,
    trace: eventBase.trace,
    ...(eventBase.sessionKey ? { sessionKey: eventBase.sessionKey } : {}),
    ...(eventBase.sessionId ? { sessionId: eventBase.sessionId } : {}),
    modelProviderId: eventBase.provider,
    modelId: eventBase.model,
    ...(eventBase.contextTokenBudget ? { contextTokenBudget: eventBase.contextTokenBudget } : {}),
    ...(eventBase.contextWindowSource
      ? { contextWindowSource: eventBase.contextWindowSource }
      : {}),
    ...(eventBase.contextWindowReferenceTokens
      ? { contextWindowReferenceTokens: eventBase.contextWindowReferenceTokens }
      : {}),
  }) as PluginHookAgentContext;
}

function dispatchModelCallStartedHook(eventBase: ModelCallEventBase): void {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("model_call_started")) {
    return;
  }
  const event = Object.freeze(modelCallHookEventBase(eventBase)) as PluginHookModelCallStartedEvent;
  const hookCtx = modelCallHookContext(eventBase);
  fireAndForgetBoundedHook(
    () => hookRunner.runModelCallStarted(event, hookCtx),
    "model_call_started plugin hook failed",
  );
}

function dispatchModelCallEndedHook(
  eventBase: ModelCallEventBase,
  fields: ModelCallEndedHookFields,
): void {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("model_call_ended")) {
    return;
  }
  const event = Object.freeze({
    ...modelCallHookEventBase(eventBase),
    ...fields,
  }) as PluginHookModelCallEndedEvent;
  const hookCtx = modelCallHookContext(eventBase);
  fireAndForgetBoundedHook(
    () => hookRunner.runModelCallEnded(event, hookCtx),
    "model_call_ended plugin hook failed",
  );
}

function emitModelCallStarted(
  eventBase: ModelCallEventBase,
  modelContent: DiagnosticModelCallContent | undefined,
): void {
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: "model.call.started",
      ...eventBase,
    },
    modelContentPrivateData(modelContent),
  );
  dispatchModelCallStartedHook(eventBase);
}

function emitModelCallCompleted(
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): void {
  if (state.terminalEventEmitted) {
    return;
  }
  state.terminalEventEmitted = true;
  const durationMs = Date.now() - startedAt;
  const sizeTimingFields = modelCallSizeTimingFields(state);
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: "model.call.completed",
      ...eventBase,
      durationMs,
      ...sizeTimingFields,
    },
    modelContentPrivateData(modelCallCompletedContent(state)),
  );
  dispatchModelCallEndedHook(eventBase, {
    durationMs,
    outcome: "completed",
    ...sizeTimingFields,
  });
}

function emitModelCallError(
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
  fields: ModelCallErrorFields,
): void {
  if (state.terminalEventEmitted) {
    return;
  }
  state.terminalEventEmitted = true;
  const durationMs = Date.now() - startedAt;
  const sizeTimingFields = modelCallSizeTimingFields(state);
  emitTrustedDiagnosticEventWithPrivateData(
    {
      type: "model.call.error",
      ...eventBase,
      durationMs,
      ...sizeTimingFields,
      ...fields,
    },
    modelContentPrivateData(modelCallCompletedContent(state)),
  );
  dispatchModelCallEndedHook(eventBase, {
    durationMs,
    outcome: "error",
    ...sizeTimingFields,
    ...fields,
  });
}

function withDiagnosticTraceparentHeader(
  options: ModelCallStreamOptions,
  trace: DiagnosticTraceContext,
  state: ModelCallObservationState,
): ModelCallStreamOptions {
  const traceparent = formatDiagnosticTraceparent(trace);
  const originalOnPayload = options?.onPayload;
  const onPayload: NonNullable<ModelCallStreamOptions>["onPayload"] = (payload, model) => {
    if (!originalOnPayload) {
      assignRequestPayloadBytes(state, payload);
      return undefined;
    }
    const result = originalOnPayload(payload, model);
    if (isPromiseLike(result)) {
      return result.then((replacement) => {
        assignRequestPayloadBytes(state, replacement ?? payload);
        return replacement;
      });
    }
    assignRequestPayloadBytes(state, result ?? payload);
    return result;
  };

  if (!traceparent) {
    return {
      ...options,
      onPayload,
    };
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options?.headers ?? {})) {
    if (key.toLowerCase() === TRACEPARENT_HEADER_NAME) {
      continue;
    }
    headers[key] = value;
  }
  headers[TRACEPARENT_HEADER_NAME] = traceparent;
  return {
    ...options,
    headers,
    onPayload,
  };
}

// A header value is user-controlled (e.g. a Slack display name), so it can carry
// bytes the fetch/SDK header layer rejects — CR/LF and other C0 controls, DEL,
// or non-ASCII such as emoji and the JS line separators U+2028/U+2029 — any of
// which would fail the entire model call. Keep only printable ASCII (0x20-0x7E);
// if nothing safe remains, the caller omits the header rather than emit it blank.
// The stable identity still rides X-Boon-User-ID; the name is a best-effort label.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^ -~]/g, "").trim();
}

// withBoonUsageHeaders adds the Boon per-turn attribution headers to the
// outbound model-call request: X-Boon-Session-ID (the per-thread session
// id), X-Boon-User-ID (the stable per-platform user id), and — to make that id
// legible in the dashboard — X-Boon-User-Name and X-Boon-User-Source (the
// originating platform, e.g. "slack") — plus X-Boon-Thread-Id (the web-chat
// thread id, resolved to the chat title for a readable session name). Empty/
// invalid values are omitted so we never emit a blank or control-character-bearing
// header. Composes on top of the
// traceparent wrapper — preserves its onPayload accounting by spreading the
// already-wrapped options.
function withBoonUsageHeaders(
  options: ModelCallStreamOptions,
  ctx: ModelCallDiagnosticContext,
): ModelCallStreamOptions {
  const entries: Array<[string, string | undefined]> = [
    [BOON_SESSION_HEADER_NAME, ctx.sessionId],
    [BOON_USER_HEADER_NAME, ctx.senderId],
    [BOON_USER_NAME_HEADER_NAME, ctx.senderName],
    [BOON_USER_SOURCE_HEADER_NAME, ctx.senderSource],
    [BOON_THREAD_HEADER_NAME, ctx.threadId],
    [BOON_OBO_HEADER_NAME, ctx.oboToken],
  ];
  const headers: Record<string, string> = { ...options?.headers };
  let added = false;
  const attached: string[] = [];
  for (const [name, raw] of entries) {
    if (!raw) {
      continue;
    }
    const safe = sanitizeHeaderValue(raw);
    if (!safe) {
      continue;
    }
    if (Object.keys(headers).some((key) => key.toLowerCase() === name)) {
      continue;
    }
    headers[name] = safe;
    attached.push(name);
    added = true;
  }
  // Names only — never values (the OBO is a bearer credential). This is the one
  // hop where the per-turn identity becomes wire headers; without it, a dropped
  // token upstream is indistinguishable from a gateway-side miss (ENG-19115).
  log.debug(
    `boon usage headers attached: [${attached.join(", ")}] obo=${ctx.oboToken ? "present" : "absent"}`,
  );
  if (!added) {
    return options;
  }
  return {
    ...options,
    headers,
  };
}

async function safeReturnIterator(iterator: AsyncIterator<unknown>): Promise<void> {
  let returnResult: unknown;
  try {
    returnResult = iterator.return?.();
  } catch {
    return;
  }
  if (!returnResult) {
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Early consumer return should not hang diagnostic completion forever; give
    // provider cleanup a short chance, then emit completion for the observed call.
    await Promise.race([
      Promise.resolve(returnResult).catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, MODEL_CALL_STREAM_RETURN_TIMEOUT_MS);
        const unref =
          typeof timeout === "object" && timeout
            ? (timeout as { unref?: () => void }).unref
            : undefined;
        if (unref) {
          unref.call(timeout);
        }
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function* observeModelCallIterator<T>(
  iterator: AsyncIterator<T>,
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): AsyncIterable<T> {
  // Tracks whether the underlying iterator terminated on its own (done or threw).
  // This is independent of state.terminalEventEmitted: result() can emit the
  // terminal event first, but the abandoned iterator still needs return() cleanup.
  let iteratorSettled = false;
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done) {
        iteratorSettled = true;
        break;
      }
      observeResponseChunk(state, startedAt, next.value);
      maybeEmitModelCallStreamProgress(eventBase, state);
      yield next.value;
    }
    emitModelCallCompleted(eventBase, startedAt, state);
  } catch (err) {
    iteratorSettled = true;
    emitModelCallError(eventBase, startedAt, state, modelCallErrorFields(err));
    throw err;
  } finally {
    if (!iteratorSettled) {
      // A consumer can stop reading before the provider emits done/error — e.g.
      // the agent loop returns on the terminal event after awaiting result().
      // Close the underlying iterator for provider cleanup (idle-timeout abort
      // listeners, SSE readers) even when result() already emitted the terminal
      // event; emitModelCallCompleted self-dedupes via state.terminalEventEmitted.
      await safeReturnIterator(iterator);
      emitModelCallCompleted(eventBase, startedAt, state);
    }
  }
}

function observeModelCallFinalResult<T>(
  result: T,
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): T {
  observeResultMessageContent(state, startedAt, result);
  emitModelCallCompleted(eventBase, startedAt, state);
  return result;
}

function createObservedResultFunction(
  stream: unknown,
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): ((...args: unknown[]) => unknown) | undefined {
  if (!isRecord(stream) || typeof stream.result !== "function") {
    return undefined;
  }
  const resultFn = stream.result;
  return (...args: unknown[]) => {
    try {
      const result = resultFn.apply(stream, args);
      if (isPromiseLike(result)) {
        return result.then(
          (resolved) => observeModelCallFinalResult(resolved, eventBase, startedAt, state),
          (err: unknown) => {
            emitModelCallError(eventBase, startedAt, state, modelCallErrorFields(err));
            throw err;
          },
        );
      }
      return observeModelCallFinalResult(result, eventBase, startedAt, state);
    } catch (err) {
      emitModelCallError(eventBase, startedAt, state, modelCallErrorFields(err));
      throw err;
    }
  };
}

function observeModelCallStream<T extends AsyncIterable<unknown>>(
  stream: T,
  createIterator: () => AsyncIterator<unknown>,
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): T {
  const observedIterator = () =>
    observeModelCallIterator(createIterator(), eventBase, startedAt, state)[Symbol.asyncIterator]();
  const observedResult = createObservedResultFunction(stream, eventBase, startedAt, state);
  let hasNonConfigurableIterator;
  try {
    hasNonConfigurableIterator =
      Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator)?.configurable === false;
  } catch {
    hasNonConfigurableIterator = true;
  }
  if (hasNonConfigurableIterator) {
    return {
      [Symbol.asyncIterator]: observedIterator,
      ...(observedResult ? { result: observedResult } : {}),
    } as T;
  }
  return new Proxy(stream, {
    get(target, property, receiver) {
      if (property === Symbol.asyncIterator) {
        return observedIterator;
      }
      if (property === "result" && observedResult) {
        return observedResult;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function observeModelCallResult(
  result: unknown,
  eventBase: ModelCallEventBase,
  startedAt: number,
  state: ModelCallObservationState,
): unknown {
  const createIterator = asyncIteratorFactory(result);
  if (createIterator) {
    return observeModelCallStream(
      result as AsyncIterable<unknown>,
      createIterator,
      eventBase,
      startedAt,
      state,
    );
  }
  emitModelCallCompleted(eventBase, startedAt, state);
  return result;
}

/**
 * Wraps a model stream function with diagnostic model-call lifecycle events,
 * traceparent propagation, request/response byte accounting, optional captured
 * model content, progress heartbeats, and plugin hook dispatch.
 */
export function wrapStreamFnWithDiagnosticModelCallEvents(
  streamFn: StreamFn,
  ctx: ModelCallDiagnosticContext,
): StreamFn {
  return ((model, streamContext, options) => {
    const callId = ctx.nextCallId();
    const trace = freezeDiagnosticTraceContext(createChildDiagnosticTraceContext(ctx.trace));
    const eventBase = baseModelCallEvent(ctx, callId, trace);
    const modelContent = streamContextModelContentFields(ctx.contentCapture, streamContext);
    emitModelCallStarted(eventBase, modelContent);
    ctx.onStarted?.();
    const startedAt = Date.now();
    const state: ModelCallObservationState = {
      responseStreamBytes: 0,
      modelContent,
      contentCapture: ctx.contentCapture,
    };
    const propagatedOptions = withBoonUsageHeaders(
      withDiagnosticTraceparentHeader(options, trace, state),
      ctx,
    );

    try {
      const result = streamFn(model, streamContext, propagatedOptions);
      if (isPromiseLike(result)) {
        return result.then(
          (resolved) => observeModelCallResult(resolved, eventBase, startedAt, state),
          (err: unknown) => {
            emitModelCallError(eventBase, startedAt, state, modelCallErrorFields(err));
            throw err;
          },
        );
      }
      return observeModelCallResult(result, eventBase, startedAt, state);
    } catch (err) {
      emitModelCallError(eventBase, startedAt, state, modelCallErrorFields(err));
      throw err;
    }
  }) as StreamFn;
}
