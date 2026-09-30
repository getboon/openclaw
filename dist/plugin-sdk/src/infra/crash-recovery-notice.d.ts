import type { OpenClawConfig } from "../config/types.openclaw.js";
export type CrashRecoveryNoticeTarget = {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
    sessionKey?: string;
};
/**
 * Send a plain-text crash-recovery notice through the durable outbound path.
 * Never throws — returns false on any failure (missing routing, unsupported
 * channel, or a send error) so callers can decide whether to retry.
 */
export declare function sendCrashRecoveryNotice(params: {
    cfg: OpenClawConfig;
    text: string;
    target: CrashRecoveryNoticeTarget;
}): Promise<boolean>;
