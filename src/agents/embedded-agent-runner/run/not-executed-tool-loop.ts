/**
 * Routes tool calls the agent loop rejected before execution (unknown tool,
 * argument-validation failure) into the tool-loop detector. Those never reach
 * the wrapped `tool.execute`, so this `afterToolCall` chain is the only place
 * the detector can see them.
 */
import {
  buildBlockedToolResult,
  type HookContext,
  runNotExecutedToolCallHook,
} from "../../agent-tools.before-tool-call.js";
import type { Agent } from "../../runtime/index.js";
import { TOOL_LOOP_RUN_ENDED_NOTICE } from "../../tool-loop-detection.js";

/**
 * Consecutive blocked never-executed calls tolerated before the run is ended.
 *
 * Blocking alone does not bound the run: every blocked call is still a full
 * model turn, so a provider that keeps re-emitting the same invalid call burns
 * turns until the run timeout — an E2E against a never-varying stub measured
 * over a thousand model turns with every one of them blocked. Ending the run is
 * the only real bound, mirroring the always-on unknown-tool guard, which stops
 * a run whose tool calls can never make progress. Three, not one: the first
 * block is the first time the model is told to stop, so it gets two more turns
 * to answer without the tool or call a different one before the run is cut.
 */
const BLOCKED_STREAK_TERMINATE_THRESHOLD = 3;

function toolResultText(content: unknown): string {
  return Array.isArray(content)
    ? content
        .map((part) =>
          part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "",
        )
        .join("\n")
    : "";
}

/** Installs an after-tool hook that counts (and eventually blocks) never-executed tool calls. */
export function installNotExecutedToolLoopHook(params: { agent: Agent; ctx: HookContext }): void {
  const previousAfterToolCall = params.agent.afterToolCall?.bind(params.agent);
  // Consecutive blocked calls in THIS run. Distinct from the detector's own
  // streak, which stays pinned at its critical threshold for exactly as long as
  // the block lasts (a block is not progress, so it never advances or resets).
  let blockedStreak = 0;
  params.agent.afterToolCall = async (context, signal) => {
    const hookResult = await previousAfterToolCall?.(context, signal);
    const isError = hookResult?.isError ?? context.isError;
    if (context.executionStarted || !isError || signal?.aborted) {
      // A call that actually ran, or any non-error outcome, is progress.
      blockedStreak = 0;
      return hookResult;
    }
    const outcome = await runNotExecutedToolCallHook({
      toolName: context.toolCall.name,
      params: context.toolCall.arguments,
      toolCallId: context.toolCall.id,
      error: toolResultText(hookResult?.content ?? context.result.content),
      ctx: params.ctx,
    });
    if (!outcome.blocked || !outcome.reason) {
      blockedStreak = 0;
      return hookResult;
    }
    blockedStreak += 1;
    const terminate = blockedStreak >= BLOCKED_STREAK_TERMINATE_THRESHOLD;
    const blocked = buildBlockedToolResult({
      reason: terminate ? `${outcome.reason} ${TOOL_LOOP_RUN_ENDED_NOTICE}` : outcome.reason,
      deniedReason: "tool-loop",
      toolCallId: context.toolCall.id,
      ...(params.ctx.runId ? { runId: params.ctx.runId } : {}),
    });
    return {
      content: blocked.content,
      details: blocked.details,
      isError: true,
      ...(terminate ? { terminate: true } : {}),
    };
  };
}
