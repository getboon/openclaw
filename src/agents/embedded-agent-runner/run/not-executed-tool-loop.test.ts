/**
 * Guards the wiring seam: only tool calls that never reached `tool.execute`
 * may be fed to the not-executed loop hook, and a critical loop must come back
 * as a blocked tool result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AfterToolCallContext, Agent } from "../../runtime/index.js";
import { installNotExecutedToolLoopHook } from "./not-executed-tool-loop.js";

const runNotExecutedToolCallHook = vi.hoisted(() => vi.fn());
vi.mock("../../agent-tools.before-tool-call.js", async () => {
  const actual = await vi.importActual<typeof import("../../agent-tools.before-tool-call.js")>(
    "../../agent-tools.before-tool-call.js",
  );
  return { ...actual, runNotExecutedToolCallHook };
});

function contextFor(overrides: Partial<AfterToolCallContext>): AfterToolCallContext {
  return {
    toolCall: { id: "call-1", name: "exec", arguments: {} },
    args: {},
    result: { content: [{ type: "text", text: 'Validation failed for tool "exec"' }] },
    isError: true,
    executionStarted: false,
    ...overrides,
  } as AfterToolCallContext;
}

describe("installNotExecutedToolLoopHook", () => {
  beforeEach(() => {
    runNotExecutedToolCallHook.mockReset();
    runNotExecutedToolCallHook.mockResolvedValue({ blocked: false });
  });

  it("reports a never-executed error result to the loop hook", async () => {
    const agent = {} as unknown as Agent;
    installNotExecutedToolLoopHook({ agent, ctx: { sessionKey: "sess-1" } });

    await agent.afterToolCall?.(contextFor({}));

    expect(runNotExecutedToolCallHook).toHaveBeenCalledTimes(1);
    expect(runNotExecutedToolCallHook.mock.calls[0]?.[0]).toMatchObject({
      toolName: "exec",
      toolCallId: "call-1",
    });
  });

  it("ignores a tool call that actually executed", async () => {
    const agent = {} as unknown as Agent;
    installNotExecutedToolLoopHook({ agent, ctx: { sessionKey: "sess-1" } });

    await agent.afterToolCall?.(contextFor({ executionStarted: true }));

    expect(runNotExecutedToolCallHook).not.toHaveBeenCalled();
  });

  it("ignores a never-executed result that is not an error", async () => {
    const agent = {} as unknown as Agent;
    installNotExecutedToolLoopHook({ agent, ctx: { sessionKey: "sess-1" } });

    await agent.afterToolCall?.(contextFor({ isError: false }));

    expect(runNotExecutedToolCallHook).not.toHaveBeenCalled();
  });

  it("turns a critical loop into a blocked tool result and keeps the previous hook", async () => {
    const previousAfterToolCall = vi.fn(async () => undefined);
    const agent = { afterToolCall: previousAfterToolCall } as unknown as Agent;
    runNotExecutedToolCallHook.mockResolvedValue({ blocked: true, reason: "CRITICAL: stuck" });
    installNotExecutedToolLoopHook({ agent, ctx: { sessionKey: "sess-1", runId: "run-1" } });

    const result = await agent.afterToolCall?.(contextFor({}));

    expect(previousAfterToolCall).toHaveBeenCalledTimes(1);
    expect(result?.isError).toBe(true);
    expect(result?.content).toEqual([{ type: "text", text: "CRITICAL: stuck" }]);
    expect(result?.details).toMatchObject({ status: "blocked", deniedReason: "tool-loop" });
  });
});
