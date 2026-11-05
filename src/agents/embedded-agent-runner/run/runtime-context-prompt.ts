/**
 * Builds runtime context prompt fragments and custom session messages.
 */
import {
  extractInternalRuntimeContext,
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
  OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
  OPENCLAW_RUNTIME_CONTEXT_CUSTOM_TYPE,
  OPENCLAW_RUNTIME_CONTEXT_NOTICE,
  OPENCLAW_RUNTIME_EVENT_HEADER,
} from "../../internal-runtime-context.js";
import type { CurrentInboundPromptContext } from "./params.js";

const OPENCLAW_RUNTIME_EVENT_USER_PROMPT = "Continue the OpenClaw runtime event.";

type RuntimeContextPromptParts = {
  prompt: string;
  modelPrompt?: string;
  runtimeContext?: string;
  runtimeOnly?: boolean;
  runtimeSystemContext?: string;
};

/** Hidden custom transcript message that carries runtime context into model conversion. */
export type RuntimeContextCustomMessage = {
  role: "custom";
  customType: string;
  content: string;
  display: false;
  details: { source: "openclaw-runtime-context"; runtimeContextCarrier: true };
  timestamp: number;
};

type EmptyTranscriptMode = "model-prompt" | "runtime-event";

type PromptBuildContext = { prependContext?: string; appendContext?: string };

type CurrentTurnPromptParts = {
  submission: RuntimeContextPromptParts;
  promptForSession: string;
  promptForModel: string;
  runtimeContext?: string;
  inlinePromptBuildContext?: PromptBuildContext;
};

/** Combines inbound context and the current prompt using the channel-provided joiner. */
export function buildCurrentInboundPrompt(params: {
  context: CurrentInboundPromptContext | undefined;
  prompt: string;
  preferResumableText?: boolean;
}): string {
  const contextText =
    params.preferResumableText === true
      ? (params.context?.resumableText ?? params.context?.text)
      : params.context?.text;
  const prefix = contextText?.trim() ?? "";
  if (!prefix) {
    return params.prompt;
  }
  if (!params.prompt) {
    return prefix;
  }
  return [prefix, params.prompt].join(params.context?.promptJoiner ?? "\n\n");
}

function removeLastPromptOccurrence(text: string, prompt: string): string | null {
  const index = text.lastIndexOf(prompt);
  if (index === -1) {
    return null;
  }
  const before = text.slice(0, index).trimEnd();
  const after = text.slice(index + prompt.length).trimStart();
  return [before, after]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .trim();
}

/**
 * Separates user-authored prompt text from hidden runtime context. Transcript
 * prompt stays user-visible; model prompt may carry runtime-only additions that
 * should be delivered as hidden context instead of persisted as user text.
 */
export function resolveRuntimeContextPromptParts(params: {
  effectivePrompt: string;
  transcriptPrompt?: string;
  modelPrompt?: string;
  emptyTranscriptMode?: EmptyTranscriptMode;
}): RuntimeContextPromptParts {
  const transcriptPrompt = params.transcriptPrompt;
  const shouldExtractInternalRuntimeContext = transcriptPrompt !== undefined;
  const extracted = shouldExtractInternalRuntimeContext
    ? extractInternalRuntimeContext(params.effectivePrompt)
    : { text: params.effectivePrompt };
  const modelPrompt =
    params.modelPrompt === undefined
      ? undefined
      : shouldExtractInternalRuntimeContext
        ? extractInternalRuntimeContext(params.modelPrompt)
        : { text: params.modelPrompt };
  const modelPromptText = modelPrompt?.text ?? transcriptPrompt ?? extracted.text;
  const prompt = transcriptPrompt ?? extracted.text;
  if (!prompt.trim() && params.emptyTranscriptMode === "model-prompt") {
    return {
      prompt: extracted.text,
      ...(modelPromptText.trim() && modelPromptText !== extracted.text
        ? { modelPrompt: modelPromptText }
        : {}),
      ...(extracted.runtimeContext ? { runtimeContext: extracted.runtimeContext } : {}),
    };
  }
  const hiddenRuntimeContext = modelPrompt
    ? (removeLastPromptOccurrence(extracted.text, modelPrompt.text)?.trim() ??
      (transcriptPrompt
        ? removeLastPromptOccurrence(extracted.text, transcriptPrompt)?.trim()
        : undefined))
    : transcriptPrompt
      ? removeLastPromptOccurrence(extracted.text, transcriptPrompt)?.trim()
      : undefined;
  // The hidden context is whatever remains after removing the last visible
  // prompt occurrence, plus any explicit internal runtime-context block.
  const runtimeContext =
    [hiddenRuntimeContext, extracted.runtimeContext]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n") || (!prompt.trim() ? extracted.text.trim() : undefined);
  if (!prompt.trim()) {
    return runtimeContext
      ? {
          prompt: OPENCLAW_RUNTIME_EVENT_USER_PROMPT,
          ...(modelPromptText.trim() && modelPromptText !== OPENCLAW_RUNTIME_EVENT_USER_PROMPT
            ? { modelPrompt: modelPromptText }
            : {}),
          runtimeContext,
          runtimeOnly: true,
          runtimeSystemContext: buildRuntimeContextMessageContent({
            runtimeContext,
            kind: "runtime-event",
          }),
        }
      : {
          prompt: "",
          ...(modelPromptText ? { modelPrompt: modelPromptText } : {}),
        };
  }

  return {
    prompt,
    ...(modelPromptText.trim() && modelPromptText !== prompt
      ? { modelPrompt: modelPromptText }
      : {}),
    ...(runtimeContext ? { runtimeContext } : {}),
  };
}

/**
 * Resolves the current turn's transcript prompt, model prompt, and hidden
 * runtime-context carrier text.
 */
export function resolveCurrentTurnPromptParts(params: {
  effectivePrompt: string;
  transcriptPrompt?: string;
  modelPromptWithBuildContext: string;
  promptBuildContext?: PromptBuildContext;
  currentInboundContext?: CurrentInboundPromptContext;
  suppressUserMessagePersistence?: boolean;
}): CurrentTurnPromptParts {
  const prependContext = params.promptBuildContext?.prependContext?.trim() || undefined;
  const appendContext = params.promptBuildContext?.appendContext?.trim() || undefined;
  const hasPromptBuildContext = Boolean(prependContext || appendContext);
  const resolveSubmission = (modelPrompt: string | undefined) =>
    resolveRuntimeContextPromptParts({
      effectivePrompt: params.effectivePrompt,
      transcriptPrompt: params.transcriptPrompt,
      modelPrompt,
      emptyTranscriptMode: params.suppressUserMessagePersistence ? "model-prompt" : "runtime-event",
    });
  const submissionWithoutBuildContext = resolveSubmission(undefined);
  // A persisted user turn replays bare next turn, so its hook prompt context rides the
  // tail carrier to keep the active user message byte-identical for prompt caching.
  const promptBuildContextInCarrier =
    hasPromptBuildContext &&
    params.suppressUserMessagePersistence !== true &&
    submissionWithoutBuildContext.runtimeOnly !== true;
  const submission =
    hasPromptBuildContext && !promptBuildContextInCarrier
      ? resolveSubmission(params.modelPromptWithBuildContext)
      : submissionWithoutBuildContext;
  const inlinePromptBuildContext = promptBuildContextInCarrier
    ? undefined
    : params.promptBuildContext;
  // Normal user turns keep the user prompt BARE and route current-turn
  // inbound metadata into the runtime-context carrier (relocated after the
  // active user turn on the wire), so the persisted/replayed user message
  // is byte-identical whether active or historical. Runtime-only turns (room
  // events, etc.) have no bare user turn to protect, so their inbound context
  // stays inline exactly as before. That inline path stays byte-stable because
  // a runtime-only turn only ever carries room-event/system context, which is
  // NOT strip-eligible: the historical strip only removes the
  // `buildInboundUserContextPrefix` blocks (Conversation info / Reply target /
  // Sender / …), and those are produced only for non-room turns, which always
  // have a non-empty body and so are never runtime-only.
  if (submission.runtimeOnly === true) {
    return {
      submission,
      promptForSession: buildCurrentInboundPrompt({
        context: params.currentInboundContext,
        prompt: submission.prompt,
      }),
      promptForModel: buildCurrentInboundPrompt({
        context: params.currentInboundContext,
        prompt: submission.modelPrompt ?? submission.prompt,
      }),
      inlinePromptBuildContext,
    };
  }
  const runtimeContext =
    [
      params.currentInboundContext?.text?.trim(),
      submission.runtimeContext?.trim(),
      ...(promptBuildContextInCarrier ? [prependContext, appendContext] : []),
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n") || undefined;
  return {
    submission,
    promptForSession: submission.prompt,
    promptForModel: submission.modelPrompt ?? submission.prompt,
    runtimeContext,
    inlinePromptBuildContext,
  };
}

function buildRuntimeContextMessageContent(params: {
  runtimeContext: string;
  kind: "next-turn" | "runtime-event";
}): string {
  // Wrap the runtime context body in delimited internal-context markers so
  // stripInternalRuntimeContext can fully remove the block when it leaks
  // into user-visible surfaces (e.g. Feishu streaming cards, #92589).
  return [
    params.kind === "runtime-event"
      ? OPENCLAW_RUNTIME_EVENT_HEADER
      : OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER,
    OPENCLAW_RUNTIME_CONTEXT_NOTICE,
    "",
    INTERNAL_RUNTIME_CONTEXT_BEGIN,
    params.runtimeContext,
    INTERNAL_RUNTIME_CONTEXT_END,
  ].join("\n");
}

/** Creates a non-displayed custom transcript message for runtime context, if any exists. */
export function buildRuntimeContextCustomMessage(
  runtimeContext: string | undefined,
): RuntimeContextCustomMessage | undefined {
  const trimmedRuntimeContext = runtimeContext?.trim();
  if (!trimmedRuntimeContext) {
    return undefined;
  }
  return {
    role: "custom",
    customType: OPENCLAW_RUNTIME_CONTEXT_CUSTOM_TYPE,
    content: buildRuntimeContextMessageContent({
      runtimeContext: trimmedRuntimeContext,
      kind: "next-turn",
    }),
    display: false,
    details: { source: "openclaw-runtime-context", runtimeContextCarrier: true },
    timestamp: Date.now(),
  };
}
