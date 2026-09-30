export declare function stripToolMessages(messages: unknown[]): unknown[];
/**
 * Drops assistant transcript entries that carry only thinking/tool-call
 * plumbing and no visible text or image. In message-tool-only delivery, the
 * real inference-turn record has no text block at all — the reply text lives
 * solely in a paired `delivery-mirror` entry written back after the send —
 * so these stubs add zero conversational value once `stripToolMessages` has
 * already dropped tool results, but still eat a caller's requested history
 * window ahead of the turns it actually asked for. `delivery-mirror` entries
 * are the only record of that text and must never be dropped here.
 */
export declare function dropToolPlumbingOnlyAssistantMessages(messages: unknown[]): unknown[];
/**
 * Sanitize text content to strip tool call markers and thinking tags.
 * This ensures user-facing text doesn't leak internal tool representations.
 */
export declare function sanitizeTextContent(text: string): string;
export declare function extractAssistantText(message: unknown): string | undefined;
