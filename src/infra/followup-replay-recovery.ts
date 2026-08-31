// On gateway startup, notify senders whose queued followup message never got
// a chance to run before a crash or restart. Never auto-replays — see the
// design doc's "notify, don't auto-reply" decision.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { sendCrashRecoveryNotice } from "./crash-recovery-notice.js";
import {
  deleteFollowupReplay,
  failFollowupReplay,
  loadPendingFollowupReplays,
} from "./followup-delivery-queue-storage.js";

export interface FollowupRecoveryLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

const FOLLOWUP_RECOVERY_NOTICE_TEXT =
  "I may have missed a message from you — please resend if you haven't heard back from me.";

// Matches the outbound delivery-recovery MAX_RETRIES bound
// (delivery-queue-recovery.ts) so a followup record cannot be retried forever
// across repeated restarts if the channel stays undeliverable.
const MAX_FOLLOWUP_NOTICE_RETRIES = 5;

export async function recoverPendingFollowupReplays(opts: {
  cfg: OpenClawConfig;
  log: FollowupRecoveryLogger;
  stateDir?: string;
}): Promise<{ notified: number; retained: number }> {
  const pending = await loadPendingFollowupReplays(opts.stateDir);
  if (pending.length === 0) {
    return { notified: 0, retained: 0 };
  }
  opts.log.info(`Found ${pending.length} pending followup replay record(s) — recovering`);

  let notified = 0;
  let retained = 0;
  for (const entry of pending) {
    if (entry.retryCount >= MAX_FOLLOWUP_NOTICE_RETRIES) {
      await deleteFollowupReplay(entry.id, opts.stateDir);
      opts.log.warn(`Followup replay ${entry.id}: exceeded max notice retries, giving up`);
      continue;
    }
    const sent = await sendCrashRecoveryNotice({
      cfg: opts.cfg,
      text: FOLLOWUP_RECOVERY_NOTICE_TEXT,
      target: {
        channel: entry.channel,
        to: entry.to,
        accountId: entry.accountId,
        threadId: entry.threadId,
        sessionKey: entry.sessionKey,
      },
    });
    if (sent) {
      await deleteFollowupReplay(entry.id, opts.stateDir);
      notified += 1;
      opts.log.info(`Followup replay ${entry.id}: sent crash-recovery notice`);
    } else {
      await failFollowupReplay(entry.id, "failed to send crash-recovery notice", opts.stateDir);
      retained += 1;
      opts.log.warn(`Followup replay ${entry.id}: could not notify, retained for next startup`);
    }
  }
  return { notified, retained };
}
