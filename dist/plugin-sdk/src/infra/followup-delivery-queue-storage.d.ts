export type QueuedFollowupReplayPayload = {
    /** FOLLOWUP_QUEUES map key this record belongs to (see queue/state.ts). */
    queueKey: string;
    sessionKey?: string;
    messageId?: string;
    prompt: string;
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
    chatType?: string;
    replyToId?: string;
    replyToMode?: string;
};
export type QueuedFollowupReplay = QueuedFollowupReplayPayload & {
    id: string;
    enqueuedAt: number;
    retryCount: number;
    lastAttemptAt?: number;
    lastError?: string;
};
/**
 * Persist a queued followup so it survives a crash before it drains. Returns
 * the durable id. Synchronous: the underlying write is already synchronous,
 * and the only caller (enqueueFollowupRun) must stay synchronous — see the
 * task plan note on this deliberate deviation from the session/outbound
 * queue wrappers' async convention.
 */
export declare function enqueueFollowupReplay(params: QueuedFollowupReplayPayload, stateDir?: string): string;
/** Remove one followup replay record, e.g. after its crash-recovery notice was sent. */
export declare function deleteFollowupReplay(id: string, stateDir?: string): Promise<void>;
/** Remove every persisted followup for one queue key once its queue has fully drained. */
export declare function deleteFollowupReplaysForQueueKey(queueKey: string, stateDir?: string): Promise<void>;
/** Record a failed crash-recovery notice attempt and increment retry metadata. */
export declare function failFollowupReplay(id: string, error: string, stateDir?: string): Promise<void>;
/** Load all pending followup replays in enqueue order. */
export declare function loadPendingFollowupReplays(stateDir?: string): Promise<QueuedFollowupReplay[]>;
