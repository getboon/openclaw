// Sends a best-effort plain-text notice after a crash/restart may have lost a
// message. Modeled on deliverSessionMaintenanceWarning's durable-send
// fallback pattern (session-maintenance-warning.ts).
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import { buildOutboundSessionContext } from "./outbound/session-context.js";

const log = createSubsystemLogger("crash-recovery-notice");

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
export async function sendCrashRecoveryNotice(params: {
  cfg: OpenClawConfig;
  text: string;
  target: CrashRecoveryNoticeTarget;
}): Promise<boolean> {
  const { target } = params;
  if (!target.channel || !target.to) {
    return false;
  }
  const channel = normalizeMessageChannel(target.channel) ?? target.channel;
  if (!isDeliverableMessageChannel(channel)) {
    return false;
  }
  try {
    const { sendDurableMessageBatch } = await import("../channels/message/runtime.js");
    const outboundSession = target.sessionKey
      ? buildOutboundSessionContext({ cfg: params.cfg, sessionKey: target.sessionKey })
      : undefined;
    const send = await sendDurableMessageBatch({
      cfg: params.cfg,
      channel,
      to: target.to,
      accountId: target.accountId,
      threadId: target.threadId,
      payloads: [{ text: params.text }],
      ...(outboundSession ? { session: outboundSession } : {}),
    });
    return send.status !== "failed" && send.status !== "partial_failed";
  } catch (err) {
    log.warn(`Failed to send crash recovery notice: ${String(err)}`);
    return false;
  }
}
