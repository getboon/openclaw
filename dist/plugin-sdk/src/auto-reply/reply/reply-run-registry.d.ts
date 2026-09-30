import type { ReplyFollowupAdmissionBarrierTimeoutPolicy } from "./reply-dispatcher.types.js";
export type ReplyRunKey = string;
export type ReplyBackendKind = "embedded" | "cli";
export type ReplyBackendCancelReason = "user_abort" | "restart" | "superseded";
export type ReplyBackendHandle = {
    readonly kind: ReplyBackendKind;
    cancel(reason?: ReplyBackendCancelReason): void;
    isStreaming(): boolean;
    isAbortable?: () => boolean;
    queueMessage?: (text: string) => Promise<void>;
    /**
     * Compatibility-only hook so legacy "abort compacting runs" paths can still
     * find embedded runs that are compacting during the main run phase.
     */
    isCompacting?: () => boolean;
};
export type ReplyOperationPhase = "queued" | "preflight_compacting" | "memory_flushing" | "running" | "completed" | "failed" | "aborted";
export type ReplyOperationFailureCode = "gateway_draining" | "command_lane_cleared" | "aborted_by_user" | "session_corruption_reset" | "turn_deadline" | "delivery_failed" | "run_failed";
export type ReplyOperationAbortCode = "aborted_by_user" | "aborted_for_restart";
export type ReplyOperationResult = {
    kind: "completed";
} | {
    kind: "failed";
    code: ReplyOperationFailureCode;
    cause?: unknown;
} | {
    kind: "aborted";
    code: ReplyOperationAbortCode;
};
/** Terminal outcome broadcast to onReplyRunTerminal listeners when a run clears. */
export type ReplyRunTerminalEvent = {
    readonly sessionKey: string;
    readonly sessionId: string;
    /** Final result at clear time; null when the run cleared before a result was set (e.g. a queued abort). */
    readonly result: ReplyOperationResult | null;
    /**
     * The run's route thread/topic id, snapshotted at clear time. The operation is
     * already removed from the registry when listeners fire, so a terminal nudge
     * must read the route from here (not resolveActiveReplyRunThreadId, which would
     * return undefined) to stay attributable to the originating thread.
     */
    readonly routeThreadId?: string | number;
    /**
     * Epoch ms the run started, so a listener can decide whether the run had "gone
     * long" from elapsed time rather than from whether a nudge happened to fire —
     * a run that crosses the threshold then fails between poll ticks still counts.
     */
    readonly startedAt: number;
};
export type ReplyOperation = {
    readonly key: ReplyRunKey;
    readonly sessionId: string;
    readonly routeThreadId?: string | number;
    readonly abortSignal: AbortSignal;
    readonly resetTriggered: boolean;
    readonly phase: ReplyOperationPhase;
    readonly result: ReplyOperationResult | null;
    /** Epoch ms captured when the operation was created (turn start). */
    readonly startedAt: number;
    readonly lastActivityAtMs: number;
    recordActivity(): void;
    setPhase(next: "queued" | "preflight_compacting" | "memory_flushing" | "running"): void;
    updateSessionId(nextSessionId: string): void;
    attachBackend(handle: ReplyBackendHandle): void;
    detachBackend(handle: ReplyBackendHandle): void;
    /**
     * Keep a failed operation active until complete() releases the session lane.
     * Dispatch uses this while a user-visible failure payload still needs delivery.
     */
    retainFailureUntilComplete(): void;
    complete(): void;
    /**
     * Complete the operation, clear active-run state, then run follow-up work.
     * Use when the follow-up can create another ReplyOperation for this session.
     */
    completeThen(afterClear: () => void): void;
    /**
     * Clear active-run state immediately, but delay registered after-clear work
     * until delivery or another external barrier settles.
     */
    completeWithAfterClearBarrier(barrier: PromiseLike<unknown>, timeout?: number | ReplyFollowupAdmissionBarrierTimeoutPolicy): void;
    fail(code: Exclude<ReplyOperationFailureCode, "aborted_by_user">, cause?: unknown): void;
    abortByUser(): boolean;
    abortForRestart(): boolean;
};
export type ReplyRunRegistry = {
    begin(params: {
        sessionKey: string;
        sessionId: string;
        resetTriggered: boolean;
        routeThreadId?: string | number;
        upstreamAbortSignal?: AbortSignal;
    }): ReplyOperation;
    get(sessionKey: string): ReplyOperation | undefined;
    isActive(sessionKey: string): boolean;
    isStreaming(sessionKey: string): boolean;
    abort(sessionKey: string): boolean;
    waitForIdle(sessionKey: string, timeoutMs?: number, opts?: {
        signal?: AbortSignal;
    }): Promise<boolean>;
    resolveSessionId(sessionKey: string): string | undefined;
};
export declare const REPLY_RUN_IDLE_SETTLE_TIMEOUT_MS = 15000;
/**
 * Subscribe to reply-run terminal events (fires once per operation when its
 * session lane clears, via clearReplyRunState). The event carries the final
 * result, so a subscriber can distinguish completed / failed / aborted without
 * polling — a poller cannot observe `failed` reliably because fail() clears the
 * session key before the next tick. Returns an idempotent unsubscribe handle.
 */
export declare function onReplyRunTerminal(listener: (event: ReplyRunTerminalEvent) => void): () => void;
export declare class ReplyRunAlreadyActiveError extends Error {
    constructor(sessionKey: string);
}
export declare class ReplyRunFollowupAdmissionBlockedError extends Error {
    constructor(sessionKey: string);
}
/** Run work after an operation no longer owns its session lane. */
export declare function runAfterReplyOperationClear(operation: ReplyOperation, afterClear: (sessionId: string) => void): void;
export declare function createReplyOperation(params: {
    sessionKey: string;
    sessionId: string;
    resetTriggered: boolean;
    routeThreadId?: string | number;
    upstreamAbortSignal?: AbortSignal;
    deadlineMs?: number;
    respectFollowupAdmissionBarrier?: boolean;
}): ReplyOperation;
export declare const replyRunRegistry: ReplyRunRegistry;
export declare function resolveActiveReplyRunSessionId(sessionKey: string): string | undefined;
export declare function resolveActiveReplyRunThreadId(sessionKey: string): string | number | undefined;
export declare function resolveActiveReplyRunStartedAt(sessionKey: string): number | undefined;
export declare function isReplyRunActiveForSessionId(sessionId: string): boolean;
export declare function isReplyRunAbortableForCompaction(sessionId: string): boolean;
export declare function isReplyRunStreamingForSessionId(sessionId: string): boolean;
export declare function isReplyRunEvidenceStaleBySessionId(sessionId: string): boolean;
export declare function queueReplyRunMessage(sessionId: string, text: string): boolean;
export declare function abortReplyRunBySessionId(sessionId: string): boolean;
export declare function forceClearReplyRunBySessionId(sessionId: string, cause?: unknown): boolean;
export declare function waitForReplyRunEndBySessionId(sessionId: string, timeoutMs: number): Promise<boolean>;
export declare function waitForReplyRunFollowupAdmission(sessionKey: string, timeoutMs: number, opts?: {
    signal?: AbortSignal;
}): Promise<{
    settled: boolean;
    sessionId?: string;
}>;
export declare function abortActiveReplyRuns(opts: {
    mode: "all" | "compacting";
}): boolean;
export declare function getActiveReplyRunCount(): number;
export declare function listActiveReplyRunSessionIds(): string[];
export declare function listActiveReplyRunSessionKeys(): string[];
export declare const testing: {
    resetReplyRunRegistry(): void;
};
export { testing as __testing };
