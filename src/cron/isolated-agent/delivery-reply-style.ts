/** Maps a cron job's delivery.replyStyle to the portable outbound top-level intent (ENG-14117). */
import type { CronJob } from "../types.js";

/**
 * Returns true when a cron completion send should post a fresh top-level channel
 * message instead of threading. Only `delivery.replyStyle === "top-level"`
 * suppresses threading; "thread"/unset keep the channel/global default so
 * existing jobs and conversational replies are unaffected. Consumed as the
 * `threadSuppressed` flag on core outbound, which the MS Teams adapter maps to a
 * per-send top-level override.
 */
export function resolveCronDeliveryThreadSuppressed(job: CronJob): boolean {
  return job.delivery?.replyStyle === "top-level";
}
