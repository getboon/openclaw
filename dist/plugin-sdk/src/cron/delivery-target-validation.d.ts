import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { CronFailureDestination, CronJob } from "./types.js";
export declare function assertCronDeliveryInputNonBlankFields(delivery: unknown, fieldPrefix?: string): void;
/** Job shape needed to judge whether a failure-destination announce has any recipient basis. */
export type CronAnnounceRecipientJob = Pick<CronJob, "delivery" | "sessionTarget" | "sessionKey">;
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
export declare function hasExplicitFailureDestinationOverride(failureDestination: CronFailureDestination | undefined): boolean;
/**
 * Rejects an explicitly-configured `delivery.failureDestination` announce
 * override that has no way to resolve a recipient at run time — no explicit
 * `to`, and no session of its own to fall back on. Without this, a job whose
 * own failure alert can't deliver fails every run with no error ever
 * surfacing to an operator.
 */
export declare function assertCronAnnounceDeliveryResolvesRecipient(params: {
    cfg: OpenClawConfig;
    job: CronAnnounceRecipientJob;
}): void;
