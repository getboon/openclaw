import { j as resolveTimerTimeoutMs } from "./number-coercion-Crk_c9KW.js";
import { i as formatErrorMessage } from "./errors-eFp0F5lL.js";
import "./error-runtime-DvwXOTIL.js";
import "./number-runtime-CHdXliRa.js";
import { t as collectZalouserSecurityAuditFindings } from "./security-audit-DC5CKVvi.js";
import { a as listZaloGroupMembers, b as waitForZaloQrLogin, c as logoutZaloProfile, i as listZaloFriendsMatching, n as getZaloUserInfo, s as listZaloGroupsMatching, y as startZaloQrLogin } from "./zalo-js-D2igZDwv.js";
import { a as sendReactionZalouser, i as sendMessageZalouser } from "./send-D3Hyp6po.js";
//#region extensions/zalouser/src/probe.ts
async function probeZalouser(profile, timeoutMs) {
	try {
		const user = timeoutMs ? await Promise.race([getZaloUserInfo(profile), new Promise((resolve) => {
			setTimeout(() => resolve(null), resolveTimerTimeoutMs(timeoutMs, 1e3, 1e3));
		})]) : await getZaloUserInfo(profile);
		if (!user) return {
			ok: false,
			error: "Not authenticated"
		};
		return {
			ok: true,
			user
		};
	} catch (error) {
		return {
			ok: false,
			error: formatErrorMessage(error)
		};
	}
}
//#endregion
export { collectZalouserSecurityAuditFindings, getZaloUserInfo, listZaloFriendsMatching, listZaloGroupMembers, listZaloGroupsMatching, logoutZaloProfile, probeZalouser, sendMessageZalouser, sendReactionZalouser, startZaloQrLogin, waitForZaloQrLogin };
