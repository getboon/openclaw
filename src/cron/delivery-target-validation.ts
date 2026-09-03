// Validation helpers for cron delivery targets before jobs enter runtime dispatch.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveFailureDestination } from "./delivery-plan.js";
import type { CronFailureDestination, CronJob } from "./types.js";

function assertNonBlankStringField(field: string, value: unknown) {
  if (value === undefined || value === null || typeof value !== "string") {
    return;
  }
  if (value.trim()) {
    return;
  }
  throw new Error(`${field} must be a non-empty string`);
}

export function assertCronDeliveryInputNonBlankFields(delivery: unknown, fieldPrefix = "delivery") {
  if (!delivery || typeof delivery !== "object") {
    return;
  }
  const deliveryRecord = delivery as {
    channel?: unknown;
    to?: unknown;
    failureDestination?: unknown;
    completionDestination?: unknown;
  };
  assertNonBlankStringField(`${fieldPrefix}.channel`, deliveryRecord.channel);
  assertNonBlankStringField(`${fieldPrefix}.to`, deliveryRecord.to);

  const failureDestination = deliveryRecord.failureDestination;
  if (failureDestination && typeof failureDestination === "object") {
    const failureRecord = failureDestination as { channel?: unknown; to?: unknown };
    assertNonBlankStringField(`${fieldPrefix}.failureDestination.channel`, failureRecord.channel);
    assertNonBlankStringField(`${fieldPrefix}.failureDestination.to`, failureRecord.to);
  }

  const completionDestination = deliveryRecord.completionDestination;
  if (completionDestination && typeof completionDestination === "object") {
    const completionRecord = completionDestination as { to?: unknown };
    assertNonBlankStringField(`${fieldPrefix}.completionDestination.to`, completionRecord.to);
  }
}

/** Job shape needed to judge whether a failure-destination announce has any recipient basis. */
export type CronAnnounceRecipientJob = Pick<CronJob, "delivery" | "sessionTarget" | "sessionKey">;

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
function hasCronDeliverySessionBasis(job: CronAnnounceRecipientJob): boolean {
  const sessionTarget = job.sessionTarget;
  if (sessionTarget === "isolated") {
    return false;
  }
  if (sessionTarget === "main" || sessionTarget.startsWith("session:")) {
    return true;
  }
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
export function hasExplicitFailureDestinationOverride(
  failureDestination: CronFailureDestination | undefined,
): boolean {
  return (
    failureDestination !== undefined &&
    (failureDestination.channel !== undefined ||
      failureDestination.to !== undefined ||
      failureDestination.accountId !== undefined ||
      failureDestination.mode !== undefined)
  );
}

/**
 * Rejects an explicitly-configured `delivery.failureDestination` announce
 * override that has no way to resolve a recipient at run time — no explicit
 * `to`, and no session of its own to fall back on. Without this, a job whose
 * own failure alert can't deliver fails every run with no error ever
 * surfacing to an operator.
 */
export function assertCronAnnounceDeliveryResolvesRecipient(params: {
  cfg: OpenClawConfig;
  job: CronAnnounceRecipientJob;
}) {
  const failureDestination = params.job.delivery?.failureDestination;
  if (!hasExplicitFailureDestinationOverride(failureDestination)) {
    return;
  }

  const failurePlan = resolveFailureDestination(params.job, params.cfg.cron?.failureDestination);
  if (failurePlan?.mode !== "announce") {
    return;
  }
  if (failurePlan.to?.trim() || hasCronDeliverySessionBasis(params.job)) {
    return;
  }
  throw new Error(
    "delivery.failureDestination has no recipient basis: this job has no explicit " +
      'delivery.failureDestination.to and sessionTarget="isolated" has no session of its own to ' +
      "resolve a recipient from — its own failure alert would fail to deliver on every run. Set " +
      'delivery.failureDestination.channel and .to explicitly, or use sessionTarget="main"/"current"/"session:<id>".',
  );
}
