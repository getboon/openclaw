import type { Tool, ToolCall } from "./types.js";
/**
 * Thrown by `validateToolArguments` when a tool call's arguments fail schema
 * validation. `message` (via `Error`) keeps the full multi-line detail;
 * `summary` carries the same per-field issues joined onto one line, for
 * callers that can only surface one line of an error and would otherwise see
 * just the generic `Validation failed for tool "<name>":`.
 */
export declare class ToolArgumentValidationError extends Error {
    readonly toolName: string;
    readonly summary: string;
    constructor(params: {
        toolName: string;
        summary: string;
        message: string;
    });
}
/** Finds the target tool and validates/coerces a model-emitted tool call. */
export declare function validateToolCall(tools: Tool[], toolCall: ToolCall): unknown;
/** Validates tool arguments against TypeBox or plain JSON-schema parameters. */
export declare function validateToolArguments(tool: Tool, toolCall: ToolCall): unknown;
