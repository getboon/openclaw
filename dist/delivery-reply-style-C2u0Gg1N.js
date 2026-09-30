//#region src/cron/run-id.ts
/** Builds the stable diagnostic/session execution id for a single cron run. */
function createCronExecutionId(jobId, startedAt) {
	return `cron:${jobId}:${startedAt}`;
}
//#endregion
//#region src/cron/isolated-agent/delivery-reply-style.ts
/**
* Maps a cron `delivery.replyStyle` to the tri-state `threadSuppressed` intent on
* core outbound: `true` for "top-level" (post a fresh channel-root message),
* `false` for "thread" (force threading even when the channel default is
* top-level), and `undefined` when unset (keep the channel/global default so
* existing jobs are unaffected). The MS Teams adapter maps this to a per-send
* replyStyle override.
*/
function replyStyleToThreadSuppressed(replyStyle) {
	if (replyStyle === "top-level") return true;
	if (replyStyle === "thread") return false;
}
/** Convenience wrapper resolving the tri-state intent from a cron job's delivery config. */
function resolveCronDeliveryThreadSuppressed(job) {
	return replyStyleToThreadSuppressed(job.delivery?.replyStyle);
}
//#endregion
export { resolveCronDeliveryThreadSuppressed as n, createCronExecutionId as r, replyStyleToThreadSuppressed as t };
