import { t as DEFAULT_ACCOUNT_ID } from "../../account-id-5IgE9UKY.js";
import { r as buildChannelConfigSchema } from "../../config-schema-BeUmE600.js";
import { p as formatTrimmedAllowFromEntries } from "../../channel-config-helpers-CMg35hQR.js";
import { a as resolveChannelMediaMaxBytes } from "../../media-runtime-y612m5EI.js";
import { t as chunkTextForOutbound } from "../../text-chunking-DOIivPnH.js";
import { c as getChatChannelMeta } from "../../core-D0bazuUi.js";
import { t as PAIRING_APPROVED_MESSAGE } from "../../pairing-message-DNhqI-OE.js";
import { c as collectStatusIssuesFromLastError, r as buildComputedAccountStatusSnapshot } from "../../status-helpers-BIrxMHAX.js";
import "../../channel-status-BcQsPXKC.js";
import { i as IMessageConfigSchema } from "../../bundled-channel-config-schema-Dn5ChHHK.js";
import { a as resolveIMessageAccount } from "../../accounts-aGx9kx-h.js";
import { p as setIMessageRuntime } from "../../monitor-reply-cache-B6XA9WFc.js";
import { o as probeIMessage } from "../../sanitize-outbound-CE3MN0cD.js";
import { n as resolveIMessageGroupToolPolicy, r as imessageMessageActions, t as resolveIMessageGroupRequireMention } from "../../group-policy-C2Z7aFXp.js";
import { n as normalizeIMessageMessagingTarget, t as looksLikeIMessageTargetId } from "../../normalize-C-XskeTX.js";
import "../../config-api-BC6Tl5ua.js";
import { t as monitorIMessageProvider } from "../../monitor-DHkFKi7V.js";
import { t as sendMessageIMessage } from "../../send-C6YpaoF5.js";
//#region extensions/imessage/src/config-accessors.ts
function resolveIMessageConfigAllowFrom(params) {
	return (resolveIMessageAccount(params).config.allowFrom ?? []).map((entry) => String(entry));
}
function resolveIMessageConfigDefaultTo(params) {
	const defaultTo = resolveIMessageAccount(params).config.defaultTo;
	if (defaultTo == null) return;
	return defaultTo.trim() || void 0;
}
//#endregion
export { DEFAULT_ACCOUNT_ID, IMessageConfigSchema, PAIRING_APPROVED_MESSAGE, buildChannelConfigSchema, buildComputedAccountStatusSnapshot, chunkTextForOutbound, collectStatusIssuesFromLastError, formatTrimmedAllowFromEntries, getChatChannelMeta, imessageMessageActions, looksLikeIMessageTargetId, monitorIMessageProvider, normalizeIMessageMessagingTarget, probeIMessage, resolveChannelMediaMaxBytes, resolveIMessageConfigAllowFrom, resolveIMessageConfigDefaultTo, resolveIMessageGroupRequireMention, resolveIMessageGroupToolPolicy, sendMessageIMessage, setIMessageRuntime };
