import { a as loadPendingFollowupReplays, i as failFollowupReplay, t as deleteFollowupReplay } from "./followup-delivery-queue-storage-B2Rn_xz4.js";
import { t as sendCrashRecoveryNotice } from "./crash-recovery-notice-XUXnH9L8.js";
//#region src/infra/followup-replay-recovery.ts
const FOLLOWUP_RECOVERY_NOTICE_TEXT = "I may have missed a message from you — please resend if you haven't heard back from me.";
const MAX_FOLLOWUP_NOTICE_RETRIES = 5;
const DEFAULT_MAX_RECOVERY_MS = 6e4;
async function recoverPendingFollowupReplays(opts) {
	const pending = await loadPendingFollowupReplays(opts.stateDir);
	if (pending.length === 0) return {
		notified: 0,
		retained: 0
	};
	opts.log.info(`Found ${pending.length} pending followup replay record(s) — recovering`);
	const budgetMs = typeof opts.maxRecoveryMs === "number" && Number.isFinite(opts.maxRecoveryMs) ? Math.max(0, opts.maxRecoveryMs) : DEFAULT_MAX_RECOVERY_MS;
	const deadline = Date.now() + budgetMs;
	let notified = 0;
	let retained = 0;
	for (const entry of pending) {
		if (Date.now() >= deadline) {
			opts.log.warn("Followup recovery time budget exceeded — remaining records deferred to next startup");
			break;
		}
		if (entry.retryCount >= MAX_FOLLOWUP_NOTICE_RETRIES) {
			await deleteFollowupReplay(entry.id, opts.stateDir);
			opts.log.warn(`Followup replay ${entry.id}: exceeded max notice retries, giving up`);
			continue;
		}
		if (await sendCrashRecoveryNotice({
			cfg: opts.cfg,
			text: FOLLOWUP_RECOVERY_NOTICE_TEXT,
			target: {
				channel: entry.channel,
				to: entry.to,
				accountId: entry.accountId,
				threadId: entry.threadId,
				sessionKey: entry.sessionKey
			}
		})) {
			await deleteFollowupReplay(entry.id, opts.stateDir);
			notified += 1;
			opts.log.info(`Followup replay ${entry.id}: sent crash-recovery notice`);
		} else {
			await failFollowupReplay(entry.id, "failed to send crash-recovery notice", opts.stateDir);
			retained += 1;
			opts.log.warn(`Followup replay ${entry.id}: could not notify, retained for next startup`);
		}
	}
	return {
		notified,
		retained
	};
}
//#endregion
export { recoverPendingFollowupReplays };
