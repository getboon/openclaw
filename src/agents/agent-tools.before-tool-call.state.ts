/**
 * Shared before_tool_call state for adjusted tool params.
 * The adapter and wrapper both consult this map so later execution can use the
 * normalized payload selected by hook processing.
 */
export const adjustedParamsByToolCallId = new Map<string, unknown>();
// Value is the optional pre-execution failure detail: present for ANY thrown
// pre-execution failure — the before_tool_call handler itself, OR surrounding
// pipeline processing (trusted policy / approval / skill-workshop) — and
// undefined for a plain policy veto (which records no detail). Map (was a Set)
// so the detail rides alongside the blocked key.
export const preExecutionBlockedToolCallIds = new Map<string, string | undefined>();
export const structuredReplaySafeToolCallIds = new Set<string>();

export function buildAdjustedParamsKey(params: { runId?: string; toolCallId: string }): string {
  if (params.runId && params.runId.trim()) {
    return `${params.runId}:${params.toolCallId}`;
  }
  return params.toolCallId;
}

/** Consume and remove hook-adjusted params for a completed tool call. */
export function consumeAdjustedParamsForToolCall(toolCallId: string, runId?: string): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const params = adjustedParamsByToolCallId.get(key);
  adjustedParamsByToolCallId.delete(key);
  return params;
}

/** Snapshot hook-adjusted params without consuming later outcome bookkeeping. */
export function peekAdjustedParamsForToolCall(toolCallId: string, runId?: string): unknown {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const params = adjustedParamsByToolCallId.get(key);
  return params === undefined ? undefined : structuredClone(params);
}

/**
 * Consume whether policy prevented the target tool from starting, plus any
 * pre-execution failure detail. `detail` is set for ANY thrown pre-execution
 * failure — the before_tool_call handler itself, or surrounding pipeline
 * processing (trusted policy / approval / skill-workshop) — and is undefined
 * for a plain policy veto (kind:"veto"), which records no detail.
 */
export function consumePreExecutionBlockedToolCall(
  toolCallId: string,
  runId?: string,
): { blocked: boolean; detail?: string } {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const blocked = preExecutionBlockedToolCallIds.has(key);
  const detail = preExecutionBlockedToolCallIds.get(key);
  preExecutionBlockedToolCallIds.delete(key);
  return { blocked, ...(detail ? { detail } : {}) };
}

export function recordStructuredReplaySafeToolCall(toolCallId: string, runId?: string): void {
  structuredReplaySafeToolCallIds.add(buildAdjustedParamsKey({ runId, toolCallId }));
}

export function consumeStructuredReplaySafeToolCall(toolCallId: string, runId?: string): boolean {
  const key = buildAdjustedParamsKey({ runId, toolCallId });
  const replaySafe = structuredReplaySafeToolCallIds.has(key);
  structuredReplaySafeToolCallIds.delete(key);
  return replaySafe;
}

/** Clear adjusted tool parameters between isolated tests. */
export function resetAdjustedParamsByToolCallIdForTests(): void {
  adjustedParamsByToolCallId.clear();
  preExecutionBlockedToolCallIds.clear();
  structuredReplaySafeToolCallIds.clear();
}
