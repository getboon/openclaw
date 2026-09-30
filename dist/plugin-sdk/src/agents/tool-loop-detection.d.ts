import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { SessionState, ToolCallRecord } from "../logging/diagnostic-session-state.js";
type LoopDetectorKind = "generic_repeat" | "unknown_tool_repeat" | "known_poll_no_progress" | "global_circuit_breaker" | "ping_pong";
type LoopDetectionResult = {
    stuck: false;
} | {
    stuck: true;
    level: "warning" | "critical";
    detector: LoopDetectorKind;
    count: number;
    message: string;
    pairedToolName?: string;
    warningKey?: string;
};
export declare const TOOL_CALL_HISTORY_SIZE = 30;
export declare const WARNING_THRESHOLD = 10;
export declare const UNKNOWN_TOOL_THRESHOLD = 10;
export declare const CRITICAL_THRESHOLD = 20;
export declare const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30;
/**
 * Appended to the reason on the blocked tool result that ENDS a run (not merely
 * blocks a call). User-facing copy only: it is fixed authored text, never leaked
 * tool output, and it is the only explanation the user gets for why the agent
 * stopped early. It is NOT what the reply builder keys on — see
 * `TOOL_LOOP_RUN_ENDED_CODE`.
 */
export declare const TOOL_LOOP_RUN_ENDED_NOTICE = "Ending this run: the model kept repeating a blocked tool call and made no progress.";
/**
 * Structured marker for the same event, carried in the blocked result's
 * `details.code` (and so in `ToolErrorSummary.errorCode`). Consumers key on
 * this, never on the notice text, which a tool's own error output could quote.
 */
export declare const TOOL_LOOP_RUN_ENDED_CODE = "tool_loop_run_ended";
type ToolLoopDetectionScope = {
    runId?: string;
};
/**
 * Hash a tool call for pattern matching.
 * Uses tool name + deterministic JSON serialization digest of params.
 */
export declare function hashToolCall(toolName: string, params: unknown): string;
/**
 * Detect if an agent is stuck in a repetitive tool call loop.
 * Checks if the same tool+params combination has been called excessively.
 */
export declare function detectToolCallLoop(state: SessionState, toolName: string, params: unknown, config?: ToolLoopDetectionConfig, scope?: ToolLoopDetectionScope): LoopDetectionResult;
/**
 * Record a tool call in the session's history for loop detection.
 * Maintains sliding window of last N calls.
 */
export declare function recordToolCall(state: SessionState, toolName: string, params: unknown, toolCallId?: string, config?: ToolLoopDetectionConfig, scope?: ToolLoopDetectionScope): void;
/**
 * Record a completed tool call outcome so loop detection can identify no-progress repeats.
 */
export declare function recordToolCallOutcome(state: SessionState, params: {
    toolName: string;
    toolParams: unknown;
    toolCallId?: string;
    result?: unknown;
    error?: unknown;
    config?: ToolLoopDetectionConfig;
    runId?: string;
}): ToolCallRecord | undefined;
export {};
