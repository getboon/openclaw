// Persists queued inbound followup messages so a crash or restart cannot
// silently lose them. Mirrors session-delivery-queue-storage.ts, sharing the
// generic delivery_queue_entries table via a distinct queue_name.
import {
  deleteDeliveryQueueEntry,
  loadDeliveryQueueEntries,
  updateDeliveryQueueEntry,
  upsertDeliveryQueueEntry,
  type DeliveryQueueRowMetadata,
} from "./delivery-queue-sqlite.js";
import { generateSecureUuid } from "./secure-random.js";

const QUEUE_NAME = "followup";

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

function queuedFollowupReplayMetadata(entry: QueuedFollowupReplay): DeliveryQueueRowMetadata {
  return {
    entryKind: "followup",
    sessionKey: entry.sessionKey,
    channel: entry.channel,
    target: entry.to,
    accountId: entry.accountId,
  };
}

/**
 * Persist a queued followup so it survives a crash before it drains. Returns
 * the durable id. Synchronous: the underlying write is already synchronous,
 * and the only caller (enqueueFollowupRun) must stay synchronous — see the
 * task plan note on this deliberate deviation from the session/outbound
 * queue wrappers' async convention.
 */
export function enqueueFollowupReplay(
  params: QueuedFollowupReplayPayload,
  stateDir?: string,
): string {
  const id = generateSecureUuid();
  const entry: QueuedFollowupReplay = {
    ...params,
    id,
    enqueuedAt: Date.now(),
    retryCount: 0,
  };
  upsertDeliveryQueueEntry({
    queueName: QUEUE_NAME,
    entry,
    metadata: queuedFollowupReplayMetadata(entry),
    stateDir,
  });
  return id;
}

/** Remove one followup replay record, e.g. after its crash-recovery notice was sent. */
export async function deleteFollowupReplay(id: string, stateDir?: string): Promise<void> {
  deleteDeliveryQueueEntry(QUEUE_NAME, id, stateDir);
}

/** Remove every persisted followup for one queue key once its queue has fully drained. */
export async function deleteFollowupReplaysForQueueKey(
  queueKey: string,
  stateDir?: string,
): Promise<void> {
  const rows = loadDeliveryQueueEntries(QUEUE_NAME, stateDir) as QueuedFollowupReplay[];
  for (const row of rows) {
    if (row.queueKey === queueKey) {
      deleteDeliveryQueueEntry(QUEUE_NAME, row.id, stateDir);
    }
  }
}

/** Record a failed crash-recovery notice attempt and increment retry metadata. */
export async function failFollowupReplay(
  id: string,
  error: string,
  stateDir?: string,
): Promise<void> {
  updateDeliveryQueueEntry(QUEUE_NAME, id, stateDir, (entry) => {
    const queued = entry as QueuedFollowupReplay;
    return {
      ...queued,
      retryCount: queued.retryCount + 1,
      lastAttemptAt: Date.now(),
      lastError: error,
    };
  });
}

/** Load all pending followup replays in enqueue order. */
export async function loadPendingFollowupReplays(
  stateDir?: string,
): Promise<QueuedFollowupReplay[]> {
  return loadDeliveryQueueEntries(QUEUE_NAME, stateDir) as QueuedFollowupReplay[];
}
