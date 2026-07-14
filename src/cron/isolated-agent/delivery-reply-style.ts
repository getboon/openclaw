/** Maps a cron delivery.replyStyle to the portable outbound threadSuppressed intent (ENG-14117). */
import type { CronJob, CronReplyStyle } from "../types.js";

/**
 * Maps a cron `delivery.replyStyle` to the tri-state `threadSuppressed` intent on
 * core outbound: `true` for "top-level" (post a fresh channel-root message),
 * `false` for "thread" (force threading even when the channel default is
 * top-level), and `undefined` when unset (keep the channel/global default so
 * existing jobs are unaffected). The MS Teams adapter maps this to a per-send
 * replyStyle override.
 */
export function replyStyleToThreadSuppressed(
  replyStyle: CronReplyStyle | undefined,
): boolean | undefined {
  if (replyStyle === "top-level") {
    return true;
  }
  if (replyStyle === "thread") {
    return false;
  }
  return undefined;
}

/** Convenience wrapper resolving the tri-state intent from a cron job's delivery config. */
export function resolveCronDeliveryThreadSuppressed(job: CronJob): boolean | undefined {
  return replyStyleToThreadSuppressed(job.delivery?.replyStyle);
}
