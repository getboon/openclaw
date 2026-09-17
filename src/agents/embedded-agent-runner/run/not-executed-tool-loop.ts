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
  params.agent.afterToolCall = async (context, signal) => {
    const hookResult = await previousAfterToolCall?.(context, signal);
    const isError = hookResult?.isError ?? context.isError;
    if (context.executionStarted || !isError || signal?.aborted) {
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
      return hookResult;
    }
    const blocked = buildBlockedToolResult({
      reason: outcome.reason,
      deniedReason: "tool-loop",
      toolCallId: context.toolCall.id,
      ...(params.ctx.runId ? { runId: params.ctx.runId } : {}),
    });
    return { content: blocked.content, details: blocked.details, isError: true };
  };
}
