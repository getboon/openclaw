import { r as resolveFailureDestination } from "./delivery-plan-DmXdkLQl.js";
//#region src/cron/delivery-target-validation.ts
function assertNonBlankStringField(field, value) {
	if (value === void 0 || value === null || typeof value !== "string") return;
	if (value.trim()) return;
	throw new Error(`${field} must be a non-empty string`);
}
function assertCronDeliveryInputNonBlankFields(delivery, fieldPrefix = "delivery") {
	if (!delivery || typeof delivery !== "object") return;
	const deliveryRecord = delivery;
	assertNonBlankStringField(`${fieldPrefix}.channel`, deliveryRecord.channel);
	assertNonBlankStringField(`${fieldPrefix}.to`, deliveryRecord.to);
	const failureDestination = deliveryRecord.failureDestination;
	if (failureDestination && typeof failureDestination === "object") {
		const failureRecord = failureDestination;
		assertNonBlankStringField(`${fieldPrefix}.failureDestination.channel`, failureRecord.channel);
		assertNonBlankStringField(`${fieldPrefix}.failureDestination.to`, failureRecord.to);
	}
	const completionDestination = deliveryRecord.completionDestination;
	if (completionDestination && typeof completionDestination === "object") {
		const completionRecord = completionDestination;
		assertNonBlankStringField(`${fieldPrefix}.completionDestination.to`, completionRecord.to);
	}
}
/**
* Whether a session-bound identity exists for this job to resolve a recipient
* from at run time. "main" and "session:<id>" always name a real, persisted
* session. "isolated" never has one of its own — treated as no basis even if
* a `sessionKey` is still present, since a patch that changes `sessionTarget`
* without also clearing `sessionKey` can leave a stale value behind. "current"
* is normally resolved into "session:<id>" or "isolated" at job-creation time
* (`resolveCronCurrentSessionTarget`); a literal "current" surviving to here
* (e.g. via an update patch, which does not re-run that resolution) is only
* trusted if the job also carries an explicit `sessionKey`.
*/
function hasCronDeliverySessionBasis(job) {
	const sessionTarget = job.sessionTarget;
	if (sessionTarget === "isolated") return false;
	if (sessionTarget === "main" || sessionTarget.startsWith("session:")) return true;
	return Boolean(job.sessionKey?.trim());
}
/**
* Whether the job itself set a `delivery.failureDestination` override, as
* opposed to inheriting the global `cron.failureDestination` default or the
* field being entirely absent. Only an explicit per-job override is this
* job author's own claim about where failures should go, so only that case is
* rejected here. A defaulted primary `delivery.mode="announce"` (the common
* shape for isolated jobs with no explicit target) legitimately resolves live
* at run time via session/channel-selection context and is out of scope for
* this create-time check.
*/
function hasExplicitFailureDestinationOverride(failureDestination) {
	return failureDestination !== void 0 && (failureDestination.channel !== void 0 || failureDestination.to !== void 0 || failureDestination.accountId !== void 0 || failureDestination.mode !== void 0);
}
/**
* Rejects an explicitly-configured `delivery.failureDestination` announce
* override that has no way to resolve a recipient at run time — no explicit
* `to`, and no session of its own to fall back on. Without this, a job whose
* own failure alert can't deliver fails every run with no error ever
* surfacing to an operator.
*/
function assertCronAnnounceDeliveryResolvesRecipient(params) {
	const failureDestination = params.job.delivery?.failureDestination;
	if (!hasExplicitFailureDestinationOverride(failureDestination)) return;
	const failurePlan = resolveFailureDestination(params.job, params.cfg.cron?.failureDestination);
	if (failurePlan?.mode !== "announce") return;
	if (failurePlan.to?.trim() || hasCronDeliverySessionBasis(params.job)) return;
	throw new Error("delivery.failureDestination has no recipient basis: this job has no explicit delivery.failureDestination.to and sessionTarget=\"isolated\" has no session of its own to resolve a recipient from — its own failure alert would fail to deliver on every run. Set delivery.failureDestination.channel and .to explicitly, or use sessionTarget=\"main\"/\"current\"/\"session:<id>\".");
}
//#endregion
export { assertCronDeliveryInputNonBlankFields as n, hasExplicitFailureDestinationOverride as r, assertCronAnnounceDeliveryResolvesRecipient as t };
