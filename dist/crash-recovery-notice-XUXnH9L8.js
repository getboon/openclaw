import { t as createSubsystemLogger } from "./subsystem-CYwCorYs.js";
import { i as normalizeMessageChannel, t as isDeliverableMessageChannel } from "./message-channel-normalize-CADqpu1-.js";
import "./message-channel-BmnltGSU.js";
import { t as buildOutboundSessionContext } from "./session-context-B5BRwDjy.js";
//#region src/infra/crash-recovery-notice.ts
const log = createSubsystemLogger("crash-recovery-notice");
/**
* Send a plain-text crash-recovery notice through the durable outbound path.
* Never throws — returns false on any failure (missing routing, unsupported
* channel, or a send error) so callers can decide whether to retry.
*/
async function sendCrashRecoveryNotice(params) {
	const { target } = params;
	if (!target.channel || !target.to) return false;
	const channel = normalizeMessageChannel(target.channel) ?? target.channel;
	if (!isDeliverableMessageChannel(channel)) return false;
	try {
		const { sendDurableMessageBatch } = await import("./runtime-CBdidkyn.js");
		const outboundSession = target.sessionKey ? buildOutboundSessionContext({
			cfg: params.cfg,
			sessionKey: target.sessionKey
		}) : void 0;
		const send = await sendDurableMessageBatch({
			cfg: params.cfg,
			channel,
			to: target.to,
			accountId: target.accountId,
			threadId: target.threadId,
			payloads: [{ text: params.text }],
			...outboundSession ? { session: outboundSession } : {}
		});
		return send.status !== "failed" && send.status !== "partial_failed";
	} catch (err) {
		log.warn(`Failed to send crash recovery notice: ${String(err)}`);
		return false;
	}
}
//#endregion
export { sendCrashRecoveryNotice as t };
