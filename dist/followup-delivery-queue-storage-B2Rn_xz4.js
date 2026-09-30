import { a as generateSecureUuid } from "./secure-random-Ds4AFLgz.js";
import { a as updateDeliveryQueueEntry, n as loadDeliveryQueueEntries, o as upsertDeliveryQueueEntry, t as deleteDeliveryQueueEntry } from "./delivery-queue-sqlite-2zNmxlc6.js";
//#region src/infra/followup-delivery-queue-storage.ts
const QUEUE_NAME = "followup";
function queuedFollowupReplayMetadata(entry) {
	return {
		entryKind: "followup",
		sessionKey: entry.sessionKey,
		channel: entry.channel,
		target: entry.to,
		accountId: entry.accountId
	};
}
/**
* Persist a queued followup so it survives a crash before it drains. Returns
* the durable id. Synchronous: the underlying write is already synchronous,
* and the only caller (enqueueFollowupRun) must stay synchronous — see the
* task plan note on this deliberate deviation from the session/outbound
* queue wrappers' async convention.
*/
function enqueueFollowupReplay(params, stateDir) {
	const id = generateSecureUuid();
	const entry = {
		...params,
		id,
		enqueuedAt: Date.now(),
		retryCount: 0
	};
	upsertDeliveryQueueEntry({
		queueName: QUEUE_NAME,
		entry,
		metadata: queuedFollowupReplayMetadata(entry),
		stateDir
	});
	return id;
}
/** Remove one followup replay record, e.g. after its crash-recovery notice was sent. */
async function deleteFollowupReplay(id, stateDir) {
	deleteDeliveryQueueEntry(QUEUE_NAME, id, stateDir);
}
/** Remove every persisted followup for one queue key once its queue has fully drained. */
async function deleteFollowupReplaysForQueueKey(queueKey, stateDir) {
	const rows = loadDeliveryQueueEntries(QUEUE_NAME, stateDir);
	for (const row of rows) if (row.queueKey === queueKey) deleteDeliveryQueueEntry(QUEUE_NAME, row.id, stateDir);
}
/** Record a failed crash-recovery notice attempt and increment retry metadata. */
async function failFollowupReplay(id, error, stateDir) {
	updateDeliveryQueueEntry(QUEUE_NAME, id, stateDir, (entry) => {
		const queued = entry;
		return {
			...queued,
			retryCount: queued.retryCount + 1,
			lastAttemptAt: Date.now(),
			lastError: error
		};
	});
}
/** Load all pending followup replays in enqueue order. */
async function loadPendingFollowupReplays(stateDir) {
	return loadDeliveryQueueEntries(QUEUE_NAME, stateDir);
}
//#endregion
export { loadPendingFollowupReplays as a, failFollowupReplay as i, deleteFollowupReplaysForQueueKey as n, enqueueFollowupReplay as r, deleteFollowupReplay as t };
