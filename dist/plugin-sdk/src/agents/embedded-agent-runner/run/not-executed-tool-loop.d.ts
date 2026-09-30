/**
 * Routes tool calls the agent loop rejected before execution (unknown tool,
 * argument-validation failure) into the tool-loop detector. Those never reach
 * the wrapped `tool.execute`, so this `afterToolCall` chain is the only place
 * the detector can see them.
 */
import { type HookContext } from "../../agent-tools.before-tool-call.js";
import type { Agent } from "../../runtime/index.js";
/** Installs an after-tool hook that counts (and eventually blocks) never-executed tool calls. */
export declare function installNotExecutedToolLoopHook(params: {
    agent: Agent;
    ctx: HookContext;
}): void;
