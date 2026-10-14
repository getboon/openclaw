// Model-backed image understanding runtime for providers without a native media
// provider hook.
import { clampPositiveTimerTimeoutMs } from "@openclaw/normalization-core/number-coercion";
import { resolveModelAsync } from "../agents/embedded-agent-runner/model.js";
import { isMinimaxVlmModel, minimaxUnderstandImage } from "../agents/minimax-vlm.js";
import {
  getApiKeyForModel,
  requireApiKey,
  resolveApiKeyForProvider,
} from "../agents/model-auth.js";
import { normalizeModelRef } from "../agents/model-selection.js";
import { ensureOpenClawModelsJson } from "../agents/models-config.js";
import { resolveProviderRequestCapabilities } from "../agents/provider-attribution.js";
import { registerProviderStreamForModel } from "../agents/provider-stream.js";
import {
  coerceImageAssistantText,
  hasImageReasoningOnlyResponse,
} from "../agents/tools/image-tool.helpers.js";
import { isSecretRef } from "../config/types.secrets.js";
import { complete } from "../llm/stream.js";
import type { AssistantMessage, Context, Model, ProviderStreamOptions } from "../llm/types.js";
import {
  buildCopilotIdeHeaders,
  COPILOT_INTEGRATION_ID,
  resolveCopilotApiToken,
} from "../plugin-sdk/provider-auth.js";
import { normalizeMediaProviderId } from "./provider-id.js";
import type {
  ImageDescriptionRequest,
  ImageDescriptionResult,
  ImagesDescriptionRequest,
  ImagesDescriptionResult,
} from "./types.js";

function resolveImageToolMaxTokens(modelMaxTokens: number | undefined, requestedMaxTokens = 4096) {
  if (
    typeof modelMaxTokens !== "number" ||
    !Number.isFinite(modelMaxTokens) ||
    modelMaxTokens <= 0
  ) {
    return requestedMaxTokens;
  }
  return Math.min(requestedMaxTokens, modelMaxTokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNativeResponsesReasoningPayload(model: Model): boolean {
  if (
    model.api !== "openai-responses" &&
    model.api !== "azure-openai-responses" &&
    model.api !== "openai-chatgpt-responses"
  ) {
    return false;
  }
  return resolveProviderRequestCapabilities({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    capability: "image",
    transport: "media-understanding",
  }).usesKnownNativeOpenAIRoute;
}

function formatModelInputCapabilities(input: Model["input"] | undefined): string {
  return input && input.length > 0 ? input.join(", ") : "none";
}

function removeReasoningInclude(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const next = value.filter((entry) => entry !== "reasoning.encrypted_content");
  return next.length > 0 ? next : undefined;
}

function disableReasoningForImageRetryPayload(payload: unknown, model: Model): unknown {
  // Empty-text image responses can be caused by reasoning-only payloads; retry
  // with reasoning stripped while preserving provider-specific Responses shape.
  if (!isRecord(payload)) {
    return undefined;
  }
  const next = { ...payload };
  delete next.reasoning;
  delete next.reasoning_effort;

  const include = removeReasoningInclude(next.include);
  if (include === undefined) {
    delete next.include;
  } else {
    next.include = include;
  }

  if (isNativeResponsesReasoningPayload(model)) {
    next.reasoning = { effort: "none" };
  }
  return next;
}

function isImageModelNoTextError(err: unknown): boolean {
  return err instanceof Error && /^Image model returned no text\b/.test(err.message);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function composeImageDescriptionPayloadHandlers(
  first: ProviderStreamOptions["onPayload"] | undefined,
  second: ProviderStreamOptions["onPayload"] | undefined,
): ProviderStreamOptions["onPayload"] | undefined {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }
  return (payload, payloadModel) => {
    const runSecond = (firstResult: unknown) => {
      const nextPayload = firstResult === undefined ? payload : firstResult;
      const secondResult = second(nextPayload, payloadModel);
      const coerceResult = (resolvedSecond: unknown) =>
        resolvedSecond === undefined ? firstResult : resolvedSecond;
      return isPromiseLike(secondResult)
        ? Promise.resolve(secondResult).then(coerceResult)
        : coerceResult(secondResult);
    };
    const firstResult = first(payload, payloadModel);
    if (isPromiseLike(firstResult)) {
      return Promise.resolve(firstResult).then(runSecond);
    }
    return runSecond(firstResult);
  };
}

async function resolveImageRuntime(params: {
  cfg: ImageDescriptionRequest["cfg"];
  agentDir: string;
  provider: string;
  model: string;
  profile?: string;
  preferredProfile?: string;
  authStore?: ImageDescriptionRequest["authStore"];
  workspaceDir?: string;
}): Promise<{ apiKey: string; model: Model }> {
  // Fast static resolution avoids provider runtime hooks during tool discovery;
  // execution falls back to full model discovery when the static path lacks image metadata.
  const resolvedRef = normalizeModelRef(params.provider, params.model);
  const fastResolved = await resolveModelAsync(
    resolvedRef.provider,
    resolvedRef.model,
    params.agentDir,
    params.cfg,
    {
      allowBundledStaticCatalogFallback: true,
      skipAgentDiscovery: true,
      skipProviderRuntimeHooks: true,
      ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    },
  );
  if (fastResolved.model?.input?.includes("image")) {
    const normalizedResolved = await resolveModelAsync(
      resolvedRef.provider,
      resolvedRef.model,
      params.agentDir,
      params.cfg,
      {
        allowBundledStaticCatalogFallback: true,
        skipAgentDiscovery: true,
        ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
      },
    );
    if (normalizedResolved.model?.input?.includes("image")) {
      return await prepareResolvedImageRuntime(
        params,
        normalizedResolved.model,
        normalizedResolved.authStorage,
      );
    }
  }

  const modelsOptions = params.workspaceDir ? { workspaceDir: params.workspaceDir } : undefined;
  await ensureOpenClawModelsJson(params.cfg, params.agentDir, modelsOptions);
  const resolved = await resolveModelAsync(
    resolvedRef.provider,
    resolvedRef.model,
    params.agentDir,
    params.cfg,
    {
      allowBundledStaticCatalogFallback: true,
      ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    },
  );
  const { authStorage } = resolved;
  const { model } = resolved;
  if (!model) {
    throw new Error(`Unknown model: ${resolvedRef.provider}/${resolvedRef.model}`);
  }
  if (!model.input?.includes("image")) {
    // resolveModelWithRegistry may synthesize a text-only fallback for configured
    // providers, which would change "Unknown model" → "Model does not support images"
    // and skip the MiniMax VLM recovery path. Throw Unknown model for MiniMax VLM
    // models so the caller can attempt the fallback.
    if (isMinimaxVlmModel(resolvedRef.provider, resolvedRef.model)) {
      throw new Error(`Unknown model: ${resolvedRef.provider}/${resolvedRef.model}`);
    }
    throw new Error(
      `Model does not support images: ${params.provider}/${params.model} ` +
        `(resolved ${model.provider}/${model.id} input: ${formatModelInputCapabilities(model.input)})`,
    );
  }
  return await prepareResolvedImageRuntime(params, model, authStorage);
}

async function prepareResolvedImageRuntime(
  params: {
    cfg: ImageDescriptionRequest["cfg"];
    agentDir: string;
    provider: string;
    model: string;
    profile?: string;
    preferredProfile?: string;
    authStore?: ImageDescriptionRequest["authStore"];
    workspaceDir?: string;
  },
  resolvedModel: Model,
  authStorage: Awaited<ReturnType<typeof resolveModelAsync>>["authStorage"],
): Promise<{ apiKey: string; model: Model }> {
  let model = resolvedModel;
  const apiKeyInfo = await getApiKeyForModel({
    model,
    cfg: params.cfg,
    agentDir: params.agentDir,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    profileId: params.profile,
    preferredProfile: params.preferredProfile,
    store: params.authStore,
  });
  let apiKey = requireApiKey(apiKeyInfo, model.provider);
  // Image tool bypasses prepareRuntimeAuth — exchange OAuth token for
  // a short-lived Copilot API token so the integrator scope (vscode-chat)
  // matches what runtime chat requests send.
  if (model.provider === "github-copilot") {
    const copilotToken = await resolveCopilotApiToken({
      githubToken: apiKey,
    });
    apiKey = copilotToken.token;
    const runtimeBaseUrl = copilotToken.baseUrl?.trim();
    if (runtimeBaseUrl) {
      model = { ...model, baseUrl: runtimeBaseUrl };
    }
  }
  authStorage.setRuntimeApiKey(model.provider, apiKey);
  return { apiKey, model };
}

function buildImageContext(
  prompt: string,
  images: Array<{ buffer: Buffer; mime?: string }>,
  opts?: { promptInUserContent?: boolean },
): Context {
  const imageContent = images.map((image) => ({
    type: "image" as const,
    data: image.buffer.toString("base64"),
    mimeType: image.mime ?? "image/jpeg",
  }));
  const content = opts?.promptInUserContent
    ? [{ type: "text" as const, text: prompt }, ...imageContent]
    : imageContent;

  return {
    ...(opts?.promptInUserContent ? {} : { systemPrompt: prompt }),
    messages: [
      {
        role: "user",
        content,
        timestamp: Date.now(),
      },
    ],
  };
}

function shouldPlaceImagePromptInUserContent(model: Model): boolean {
  // GitHub Copilot models (including Gemini 3.1 Pro Preview) require the
  // prompt text to be in the user message alongside the image. Placing it
  // in a separate system message produces "Request must contain at least
  // one non-empty message" (400).
  if (model.provider === "github-copilot") {
    return true;
  }
  const capabilities = resolveProviderRequestCapabilities({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    capability: "image",
    transport: "media-understanding",
  });
  return (
    capabilities.endpointClass === "openrouter" ||
    capabilities.endpointClass === "modelstudio-native" ||
    (model.provider.toLowerCase() === "openrouter" && capabilities.endpointClass === "default")
  );
}

function buildImageRequestHeaders(model: Model): Record<string, string> | undefined {
  if (model.provider !== "github-copilot") {
    return undefined;
  }
  return {
    ...buildCopilotIdeHeaders(),
    "Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
    "Openai-Organization": "github-copilot",
    "x-initiator": "user",
    "Copilot-Vision-Request": "true",
  };
}

async function describeImagesWithMinimax(params: {
  apiKey: string;
  provider: string;
  modelId: string;
  modelBaseUrl?: string;
  prompt: string;
  timeoutMs?: number;
  images: Array<{ buffer: Buffer; mime?: string }>;
}): Promise<ImagesDescriptionResult> {
  const responses: string[] = [];
  for (const [index, image] of params.images.entries()) {
    const prompt =
      params.images.length > 1
        ? `${params.prompt}\n\nDescribe image ${index + 1} of ${params.images.length} independently.`
        : params.prompt;
    const text = await minimaxUnderstandImage({
      apiKey: params.apiKey,
      provider: params.provider,
      prompt,
      imageDataUrl: `data:${image.mime ?? "image/jpeg"};base64,${image.buffer.toString("base64")}`,
      modelBaseUrl: params.modelBaseUrl,
      timeoutMs: params.timeoutMs,
    });
    responses.push(params.images.length > 1 ? `Image ${index + 1}:\n${text.trim()}` : text.trim());
  }
  return {
    text: responses.join("\n\n").trim(),
    model: params.modelId,
  };
}

function isUnknownModelError(err: unknown): boolean {
  return err instanceof Error && /^Unknown model:/i.test(err.message);
}

function resolveConfiguredProviderBaseUrl(
  cfg: ImageDescriptionRequest["cfg"],
  provider: string,
): string | undefined {
  const direct = cfg.models?.providers?.[provider];
  if (typeof direct?.baseUrl === "string" && direct.baseUrl.trim()) {
    return direct.baseUrl.trim();
  }
  const normalizedProvider = normalizeMediaProviderId(provider);
  const normalized = cfg.models?.providers?.[normalizedProvider];
  if (typeof normalized?.baseUrl === "string" && normalized.baseUrl.trim()) {
    if (isMinimaxCnAlias(provider) && !isMinimaxCnBaseUrl(normalized.baseUrl)) {
      return undefined;
    }
    return normalized.baseUrl.trim();
  }
  return undefined;
}

function isMinimaxCnAlias(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return normalized === "minimax-cn" || normalized === "minimax-portal-cn";
}

function isMinimaxCnBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase() === "api.minimaxi.com";
  } catch {
    return false;
  }
}

function hasConfiguredProviderApiKey(
  cfg: ImageDescriptionRequest["cfg"],
  provider: string,
): boolean {
  const apiKey = cfg.models?.providers?.[provider]?.apiKey;
  return (typeof apiKey === "string" && apiKey.trim().length > 0) || isSecretRef(apiKey);
}

function resolveMinimaxVlmAuthProvider(
  cfg: ImageDescriptionRequest["cfg"],
  provider: string,
): string {
  if (!isMinimaxCnAlias(provider) || hasConfiguredProviderApiKey(cfg, provider)) {
    return provider;
  }
  return normalizeMediaProviderId(provider);
}

async function resolveMinimaxVlmFallbackRuntime(params: {
  cfg: ImageDescriptionRequest["cfg"];
  agentDir: string;
  workspaceDir?: string;
  provider: string;
  profile?: string;
  preferredProfile?: string;
}): Promise<{ apiKey: string; modelBaseUrl?: string }> {
  const authProvider = resolveMinimaxVlmAuthProvider(params.cfg, params.provider);
  const auth = await resolveApiKeyForProvider({
    provider: authProvider,
    cfg: params.cfg,
    profileId: params.profile,
    preferredProfile: params.preferredProfile,
    agentDir: params.agentDir,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
  });
  return {
    apiKey: requireApiKey(auth, authProvider),
    modelBaseUrl: resolveConfiguredProviderBaseUrl(params.cfg, params.provider),
  };
}

function resolveImageDescriptionTimeoutMs(timeoutMs: number | undefined) {
  return clampPositiveTimerTimeoutMs(timeoutMs);
}

function buildImageDescriptionTimeoutMessage(params: {
  phase: "setup" | "request";
  timeoutMs: number;
  setupDurationMs?: number;
}): string {
  if (params.phase === "setup") {
    return `image description setup timed out after ${params.timeoutMs}ms before provider request started`;
  }
  const setupDurationMs =
    typeof params.setupDurationMs === "number" && Number.isFinite(params.setupDurationMs)
      ? Math.max(0, Math.floor(params.setupDurationMs))
      : 0;
  return setupDurationMs > 0
    ? `image description request timed out after ${params.timeoutMs}ms (setup took ${setupDurationMs}ms before provider request started)`
    : `image description request timed out after ${params.timeoutMs}ms`;
}

/**
 * Thrown when the shared describe-image deadline (see `deadlineAtMs` in
 * `describeImagesWithModelInternal`) is exhausted. Carries a stable `name`
 * (set below) rather than requiring callers to sniff the message text, so
 * `image-tool.ts` can classify a timeout without statically importing this
 * module — `image.ts` is only ever reached through the lazy
 * `image-runtime.ts` facade (see its header comment) to keep provider code
 * out of the cold path, and a real `instanceof` check from a static importer
 * would defeat that.
 */
export class ImageDescriptionTimeoutError extends Error {
  readonly phase: "setup" | "request";
  readonly timeoutMs: number;

  constructor(params: { phase: "setup" | "request"; timeoutMs: number; setupDurationMs?: number }) {
    super(buildImageDescriptionTimeoutMessage(params));
    this.name = "ImageDescriptionTimeoutError";
    this.phase = params.phase;
    this.timeoutMs = params.timeoutMs;
  }
}

function buildImageDescriptionTimeoutError(params: {
  phase: "setup" | "request";
  timeoutMs: number;
  setupDurationMs?: number;
}): ImageDescriptionTimeoutError {
  return new ImageDescriptionTimeoutError(params);
}

async function withImageDescriptionTimeout<T>(params: {
  task: Promise<T>;
  timeoutMs: number | undefined;
  controller: AbortController;
  createTimeoutError: () => Error;
}): Promise<T> {
  if (params.timeoutMs === undefined) {
    return await params.task;
  }
  if (params.timeoutMs <= 0) {
    // The shared deadline (see `deadlineAtMs` below) was already exhausted
    // before this phase got a turn to run — fail fast with the same error an
    // expired timer would produce instead of racing a same-tick timeout that
    // would still let an unbounded task start before rejecting.
    params.controller.abort();
    // `params.task` was already created (and, via `controller.signal`, may
    // now reject from the abort above) by the caller before this function
    // ran. `Promise.race` below would normally subscribe to it and observe
    // that rejection; skip that path entirely here, so attach a no-op
    // catch to avoid an unhandled rejection crashing the process.
    void params.task.catch(() => {});
    throw params.createTimeoutError();
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      params.task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          params.controller.abort();
          reject(params.createTimeoutError());
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// Remaining ms until `deadlineAtMs`, or undefined when the call is unbounded
// (no deadline at all). Never negative — a budget that has already elapsed
// returns 0 so `withImageDescriptionTimeout` fails fast instead of starting
// a fresh full-length timer for the next phase.
function remainingTimeoutMs(deadlineAtMs: number | undefined): number | undefined {
  return deadlineAtMs === undefined ? undefined : Math.max(0, deadlineAtMs - Date.now());
}

async function describeImagesWithModelInternal(
  params: ImagesDescriptionRequest,
  options: { onPayload?: ProviderStreamOptions["onPayload"] } = {},
): Promise<ImagesDescriptionResult> {
  const prompt = params.prompt ?? "Describe the image.";
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const configuredTimeoutMs = resolveImageDescriptionTimeoutMs(params.timeoutMs);
  // ENG-21406: one deadline shared by runtime/auth setup, the MiniMax setup
  // fallback, and the provider request(s) below. Previously each phase
  // independently raced the full configured timeout, so a slow setup
  // followed by a reasoning-only retry could cost up to ~3x the configured
  // budget before the call ever failed. `configuredTimeoutMs` is only
  // undefined when the caller asked for no timeout at all, in which case
  // `deadlineAtMs` stays undefined too and every phase below runs unbounded.
  const deadlineAtMs =
    configuredTimeoutMs === undefined ? undefined : startedAtMs + configuredTimeoutMs;
  let apiKey: string;
  let model: Model | undefined;

  try {
    const resolved = await withImageDescriptionTimeout({
      controller,
      timeoutMs: remainingTimeoutMs(deadlineAtMs),
      // configuredTimeoutMs is defined whenever deadlineAtMs (and so the
      // timeoutMs above) is defined — this only runs on that branch.
      createTimeoutError: () =>
        buildImageDescriptionTimeoutError({ phase: "setup", timeoutMs: configuredTimeoutMs! }),
      task: resolveImageRuntime(params),
    });
    apiKey = resolved.apiKey;
    model = resolved.model;
  } catch (err) {
    if (!isMinimaxVlmModel(params.provider, params.model) || !isUnknownModelError(err)) {
      throw err;
    }
    const fallback = await withImageDescriptionTimeout({
      controller,
      timeoutMs: remainingTimeoutMs(deadlineAtMs),
      createTimeoutError: () =>
        buildImageDescriptionTimeoutError({ phase: "setup", timeoutMs: configuredTimeoutMs! }),
      task: resolveMinimaxVlmFallbackRuntime(params),
    });
    // The MiniMax VLM path calls `minimaxUnderstandImage` directly instead of
    // racing through `withImageDescriptionTimeout`, and that helper treats a
    // falsy `timeoutMs` (including a near-zero shared remainder) as "unset"
    // and substitutes its own 60s default (minimax-vlm.ts's
    // resolvePositiveTimerTimeoutMs) — so forwarding the shared remainder
    // here could silently grant a fresh 60s budget instead of the configured
    // one. Deliberately kept on the pre-ENG-21406 full-budget behavior rather
    // than the shared deadline used above and below.
    return await describeImagesWithMinimax({
      apiKey: fallback.apiKey,
      provider: params.provider,
      modelId: params.model,
      modelBaseUrl: fallback.modelBaseUrl,
      prompt,
      timeoutMs: params.timeoutMs,
      images: params.images,
    });
  }

  const setupDurationMs = Date.now() - startedAtMs;

  if (isMinimaxVlmModel(model.provider, model.id)) {
    // Same pre-ENG-21406 full-budget forwarding as the fallback branch above
    // — see its comment for why the shared remainder isn't used here.
    return await describeImagesWithMinimax({
      apiKey,
      provider: model.provider,
      modelId: model.id,
      modelBaseUrl: model.baseUrl,
      prompt,
      timeoutMs: params.timeoutMs,
      images: params.images,
    });
  }

  const providerStreamFn = registerProviderStreamForModel({
    model,
    cfg: params.cfg,
    agentDir: params.agentDir,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
  });

  const context = buildImageContext(prompt, params.images, {
    promptInUserContent: shouldPlaceImagePromptInUserContent(model),
  });

  const maxTokens = resolveImageToolMaxTokens(model.maxTokens, params.maxTokens);
  const completeImage = async (onPayload?: ProviderStreamOptions["onPayload"]) => {
    const payloadHandler = composeImageDescriptionPayloadHandlers(onPayload, options.onPayload);
    const timeoutMs = remainingTimeoutMs(deadlineAtMs);
    const headers = buildImageRequestHeaders(model);
    const streamOptions = {
      apiKey,
      maxTokens,
      signal: controller.signal,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(headers ? { headers } : {}),
      ...(payloadHandler ? { onPayload: payloadHandler } : {}),
    };
    const task: Promise<AssistantMessage> = providerStreamFn
      ? (async () => await (await providerStreamFn(model, context, streamOptions)).result())()
      : complete(model, context, streamOptions);
    return await withImageDescriptionTimeout({
      controller,
      timeoutMs,
      createTimeoutError: () =>
        buildImageDescriptionTimeoutError({
          phase: "request",
          timeoutMs: configuredTimeoutMs!,
          setupDurationMs,
        }),
      task,
    });
  };

  const message = await completeImage();
  try {
    const text = coerceImageAssistantText({
      message,
      provider: model.provider,
      model: model.id,
    });
    return { text, model: model.id };
  } catch (err) {
    if (!isImageModelNoTextError(err) || !hasImageReasoningOnlyResponse(message)) {
      throw err;
    }
  }

  const retryMessage = await completeImage(disableReasoningForImageRetryPayload);
  const text = coerceImageAssistantText({
    message: retryMessage,
    provider: model.provider,
    model: model.id,
  });
  return { text, model: model.id };
}

function toImagesDescriptionRequest(params: ImageDescriptionRequest): ImagesDescriptionRequest {
  return {
    images: [
      {
        buffer: params.buffer,
        fileName: params.fileName,
        mime: params.mime,
      },
    ],
    model: params.model,
    provider: params.provider,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    timeoutMs: params.timeoutMs,
    profile: params.profile,
    preferredProfile: params.preferredProfile,
    authStore: params.authStore,
    agentDir: params.agentDir,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
    cfg: params.cfg,
  };
}

export async function describeImagesWithModel(
  params: ImagesDescriptionRequest,
): Promise<ImagesDescriptionResult> {
  return await describeImagesWithModelInternal(params);
}

export async function describeImagesWithModelPayloadTransform(
  params: ImagesDescriptionRequest,
  onPayload: ProviderStreamOptions["onPayload"],
): Promise<ImagesDescriptionResult> {
  return await describeImagesWithModelInternal(params, { onPayload });
}

export async function describeImageWithModel(
  params: ImageDescriptionRequest,
): Promise<ImageDescriptionResult> {
  return await describeImagesWithModel(toImagesDescriptionRequest(params));
}

export async function describeImageWithModelPayloadTransform(
  params: ImageDescriptionRequest,
  onPayload: ProviderStreamOptions["onPayload"],
): Promise<ImageDescriptionResult> {
  return await describeImagesWithModelPayloadTransform(
    toImagesDescriptionRequest(params),
    onPayload,
  );
}
