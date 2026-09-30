import type { SourceReplyDeliveryMode } from "../auto-reply/get-reply-options.types.js";
import type { InboundEventKind } from "../channels/inbound-event/kind.js";
export type McpLoopbackRequestContext = {
    sessionKey: string;
    sessionId?: string;
    messageProvider?: string;
    currentChannelId?: string;
    currentThreadTs?: string;
    currentMessageId?: string;
    currentInboundAudio?: boolean;
    accountId?: string;
    inboundEventKind?: InboundEventKind;
    sourceReplyDeliveryMode?: SourceReplyDeliveryMode;
    requireExplicitMessageTarget?: boolean;
    senderIsOwner: boolean;
};
export interface McpAttachGrant {
    /** Opaque bearer presented as `Authorization: Bearer <token>`. */
    readonly token: string;
    /** The openclaw session this grant is bound to; tool scope is resolved for this key. */
    readonly sessionKey: string;
    /** Absolute expiry (ms epoch). */
    readonly expiresAtMs: number;
    /** Absolute mint time (ms epoch). */
    readonly issuedAtMs: number;
}
export interface McpLoopbackClientGrant {
    /** Opaque bearer presented as `Authorization: Bearer <token>`. */
    readonly token: string;
    /** Gateway-selected request context; child-process headers cannot widen it. */
    readonly context: McpLoopbackRequestContext;
}
/** Mint a grant bound to `sessionKey`. Returns the grant (the caller hands `token` to the harness). */
export declare function mintAttachGrant(params: {
    sessionKey: string;
    ttlMs?: number;
    nowMs?: number;
}): McpAttachGrant;
/**
 * Resolve a bearer token to a live grant, or `undefined` if unknown/expired. An expired grant is
 * dropped on lookup (lazy sweep). Lookup is by full-token map key: a caller must already hold the
 * complete 256-bit token to get a hit, so there is no partial-match timing oracle to defend.
 */
export declare function resolveAttachGrant(token: string, nowMs?: number): McpAttachGrant | undefined;
/** Revoke a grant by token. Returns true if a grant was removed. */
export declare function revokeAttachGrant(token: string): boolean;
/** Revoke every live grant for a session (e.g. on session teardown). Returns the count removed. */
export declare function revokeAttachGrantsForSession(sessionKey: string): number;
/** Drop expired grants. Returns the count swept. Call opportunistically; lookup also self-sweeps. */
export declare function sweepExpiredAttachGrants(nowMs?: number): number;
/** Number of entries currently held (test/diagnostics). Does not sweep; reflects raw store size. */
export declare function attachGrantStoreSize(): number;
/** Clear all grants (test isolation only). */
export declare function resetAttachGrantsForTest(): void;
export declare function mintMcpLoopbackClientGrant(params: {
    context: McpLoopbackRequestContext;
    runtimeOwnerToken: string;
}): McpLoopbackClientGrant;
/** Bind the active execution attempt's capture before its child process starts. */
export declare function activateMcpLoopbackClientGrantCapture(params: {
    token: string;
    runtimeOwnerToken: string;
    captureKey: string;
}): boolean;
/** Release only the attempt that still owns this grant's active capture. */
export declare function deactivateMcpLoopbackClientGrantCapture(params: {
    token: string;
    runtimeOwnerToken: string;
    captureKey: string;
}): boolean;
export declare function resolveMcpLoopbackClientGrant(params: {
    token: string;
    runtimeOwnerToken: string;
    captureKey: string;
}): {
    context: McpLoopbackRequestContext;
    captureKey: string;
} | undefined;
export declare function revokeMcpLoopbackClientGrant(token: string): boolean;
export declare function revokeMcpLoopbackClientGrantsForRuntime(runtimeOwnerToken: string): number;
export declare function mcpLoopbackClientGrantStoreSize(): number;
export declare function resetMcpLoopbackClientGrantsForTest(): void;
