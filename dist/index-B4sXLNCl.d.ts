import { O as Tool, a as AssistantMessageEventStreamContract, i as AssistantMessageEvent, k as ToolCall, r as AssistantMessage } from "./types-BqnYI5iG.js";

//#region packages/llm-core/src/model-contracts/anthropic.d.ts
type ClaudeModelRef = {
  id?: string;
  params?: Record<string, unknown>;
};
type ClaudeEffortModelRef = ClaudeModelRef & {
  thinkingLevelMap?: Record<string, string | null | undefined>;
};
/** Resolve the canonical normalized Claude model id for one runtime model ref. */
declare function resolveClaudeModelIdentity(ref: ClaudeModelRef): string;
/** Resolve Claude Fable 5 through direct ids, cloud ids, or deployment metadata. */
declare function resolveClaudeFable5ModelIdentity(ref: ClaudeModelRef): string | undefined;
/** Return whether a Claude model supports adaptive thinking. */
declare function supportsClaudeAdaptiveThinking(ref: ClaudeModelRef): boolean;
/** Return whether a Claude model supports native max effort. */
declare function supportsClaudeNativeMaxEffort(ref: ClaudeModelRef): boolean;
/** Return whether a Claude model supports native xhigh effort. */
declare function supportsClaudeNativeXhighEffort(ref: ClaudeModelRef): boolean;
/**
 * Fill native Claude effort mappings only when the provider did not publish a
 * narrower route-specific contract.
 */
declare function resolveClaudeNativeThinkingLevelMap(ref: ClaudeEffortModelRef): Record<string, string | null | undefined> | undefined;
//#endregion
//#region packages/llm-core/src/utils/event-stream.d.ts
/** Generic async-iterable event stream with a separately awaited final result. */
declare class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue;
  private waiting;
  private done;
  private finalResultPromise;
  private resolveFinalResult;
  private isComplete;
  private extractResult;
  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R);
  push(event: T): void;
  end(result?: R): void;
  [Symbol.asyncIterator](): AsyncIterator<T>;
  result(): Promise<R>;
}
/** Assistant-message event stream that resolves on done/error terminal events. */
declare class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> implements AssistantMessageEventStreamContract {
  constructor();
}
/** Creates an assistant-message stream for provider and plugin adapters. */
declare function createAssistantMessageEventStream(): AssistantMessageEventStream;
//#endregion
//#region packages/llm-core/src/validation.d.ts
/**
 * Thrown by `validateToolArguments` when a tool call's arguments fail schema
 * validation. `message` (via `Error`) keeps the full multi-line detail;
 * `summary` carries the same per-field issues joined onto one line, for
 * callers that can only surface one line of an error and would otherwise see
 * just the generic `Validation failed for tool "<name>":`.
 */
declare class ToolArgumentValidationError extends Error {
  readonly toolName: string;
  readonly summary: string;
  constructor(params: {
    toolName: string;
    summary: string;
    message: string;
  });
}
/** Finds the target tool and validates/coerces a model-emitted tool call. */
declare function validateToolCall(tools: Tool[], toolCall: ToolCall): unknown;
/** Validates tool arguments against TypeBox or plain JSON-schema parameters. */
declare function validateToolArguments(tool: Tool, toolCall: ToolCall): unknown;
//#endregion
export { EventStream as a, resolveClaudeModelIdentity as c, supportsClaudeNativeMaxEffort as d, supportsClaudeNativeXhighEffort as f, AssistantMessageEventStream as i, resolveClaudeNativeThinkingLevelMap as l, validateToolArguments as n, createAssistantMessageEventStream as o, validateToolCall as r, resolveClaudeFable5ModelIdentity as s, ToolArgumentValidationError as t, supportsClaudeAdaptiveThinking as u };