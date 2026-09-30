import { s as stringEnum } from "../../typebox-DgGB_BUb.js";
import { t as definePluginEntry } from "../../plugin-entry-BZpzqykQ.js";
import "../../channel-actions-CrwyzGhL.js";
import { Type } from "typebox";
/** Provider-compatible Browser Login Handoff tool argument schema. */
const BrowserHandoffToolSchema = Type.Object({
	action: stringEnum([
		"request_login",
		"status",
		"attach"
	]),
	site: Type.String({ description: "Stable identifier for the target site (e.g. a hostname like \"app.procore.com\"). Used to key the handoff and the resulting reusable browser profile." }),
	loginUrl: Type.Optional(Type.String({ description: "request_login only: the URL the agent was on when it hit the login/CAPTCHA/2FA wall." })),
	reason: Type.Optional(Type.String({ description: "request_login only: why a human is needed, e.g. \"login\", \"captcha\", \"2fa\", \"session_expired\"." }))
});
//#endregion
//#region extensions/browser-handoff/index.ts
function createBrowserHandoffTool(api, sessionKey, runSessionKey) {
	return {
		label: "Browser Login Handoff",
		name: "browser_handoff",
		description: [
			"Hand off login, CAPTCHA, or 2FA on a login-walled site to the customer instead of dead-ending.",
			"The customer signs in themselves via a hosted browser session link; never enter credentials here.",
			"action=request_login: mint a sign-in link for `site` and share it with the customer. You'll be",
			"resumed automatically once they finish — you don't need to wait or re-check yourself.",
			"action=status: check whether the customer finished signing in.",
			"action=attach: once status is ready, register the resulting session as a reusable browser profile.",
			"After attach, use the browser tool with profile=<name> from the attach reply to continue on that site."
		].join(" "),
		parameters: BrowserHandoffToolSchema,
		execute: async (_toolCallId, args) => {
			const { executeBrowserHandoffToolFromArgs } = await import("../../tool-Bpi8DcX8.js");
			return await executeBrowserHandoffToolFromArgs(api, args, {
				sessionKey,
				runSessionKey
			});
		}
	};
}
var browser_handoff_default = definePluginEntry({
	id: "browser-handoff",
	name: "Browser Login Handoff",
	description: "Hand off login/CAPTCHA/2FA on a login-walled site to the customer via a hosted browser session.",
	register(api) {
		api.registerTool(((ctx) => createBrowserHandoffTool(api, ctx.sessionKey, ctx.runSessionKey)));
	}
});
//#endregion
export { browser_handoff_default as default };
