import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PluginHookAfterToolCallErrorKind } from "../plugins/hook-types.js";
import type { MessagingToolSend, MessagingToolSourceReplyPayload } from "./embedded-agent-messaging.types.js";
export { isToolResultError } from "./tool-result-error.js";
export declare function buildToolLifecycleErrorResult(error: unknown): {
    details: Record<string, unknown>;
};
export declare function sanitizeToolArgs(args: unknown): unknown;
export declare function sanitizeToolResult(result: unknown): unknown;
export declare function extractToolResultText(result: unknown): string | undefined;
/** Collects messaging attachment references from tool-call arguments or result records. */
export declare function collectMessagingMediaUrlsFromRecord(record: Record<string, unknown>): string[];
/** Collects messaging attachment references from a completed tool result. */
export declare function collectMessagingMediaUrlsFromToolResult(result: unknown): string[];
/** Extract an internal source-reply payload from a completed message tool result. */
export declare function extractMessagingToolSourceReplyPayload(result: unknown): MessagingToolSourceReplyPayload | undefined;
export declare function isToolResultMediaTrusted(toolName?: string, result?: unknown, trustedLocalMediaToolNames?: ReadonlySet<string>): boolean;
export declare function filterToolResultMediaUrls(toolName: string | undefined, mediaUrls: string[], result?: unknown, trustedLocalMediaToolNames?: ReadonlySet<string>): string[];
/**
 * Extract media file paths from a tool result.
 *
 * Strategy (first match wins):
 * 1. Read structured `details.media` attachments from tool details.
 * 2. Fall back to `details.path` when image content exists (legacy imageResult).
 *
 * Returns an empty array when no media is found (e.g. embedded `read` tool
 * returns base64 image data but no file path; those need a different delivery
 * path like saving to a temp file).
 */
type ToolResultMediaArtifact = {
    mediaUrls: string[];
    audioAsVoice?: boolean;
    trustedLocalMedia?: boolean;
};
export declare function extractToolResultMediaArtifact(result: unknown): ToolResultMediaArtifact | undefined;
export declare function extractToolErrorCode(result: unknown): string | undefined;
export declare function isToolResultTimedOut(result: unknown): boolean;
/**
 * Classifies a failed tool result for `after_tool_call` hook consumers (see
 * `PluginHookAfterToolCallErrorKind`), using only structured signals the host
 * already computes — never `error` text. Precedence matters: a denial or an
 * unstarted execution takes priority over an exec exit code, since a policy
 * check or validation failure can leave stale/irrelevant `details.exitCode`
 * behind from an unrelated earlier attempt.
 */
export declare function classifyToolCallErrorKind(params: {
    result: unknown;
    executionStarted: boolean;
    middlewareError: boolean;
}): PluginHookAfterToolCallErrorKind;
export declare function extractToolErrorMessage(result: unknown): string | undefined;
export declare function extractMessagingToolSend(toolName: string, args: Record<string, unknown>, options?: {
    config?: OpenClawConfig;
    currentChannelId?: string;
    currentMessagingTarget?: string;
    currentThreadId?: string;
    currentMessageId?: string | number;
    replyToMode?: "off" | "first" | "all" | "batched";
    hasRepliedRef?: {
        value: boolean;
    };
}): MessagingToolSend | undefined;
/** Reconciles pending send evidence with the provider's successful action result. */
export declare function extractMessagingToolSendResult(pending: MessagingToolSend, result: unknown): MessagingToolSend;
