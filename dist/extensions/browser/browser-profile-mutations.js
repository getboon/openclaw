import { i as formatErrorMessage } from "../../errors-eFp0F5lL.js";
import { t as parseBrowserHttpUrl } from "../../browser-config-9qHE2FW-.js";
import { n as resolveBrowserConfig } from "../../config-KRoM-e8x.js";
import "../../errors-BDkYGMz_.js";
import { n as deleteBrowserProfileConfig, t as createBrowserProfileConfig } from "../../config-mutations-f6J4fSZ3.js";
//#region extensions/browser/browser-profile-mutations.ts
/**
* Public surface for registering/removing a remote-CDP browser profile from a
* sibling plugin. `browser.profiles.*` is core-owned and `.strict()`, and the
* extensions boundary forbids importing another extension's `src/**` — this
* is the sanctioned seam (loaded via the plugin-sdk facade loader) instead of
* a direct cross-extension import.
*/
/**
* Register a remote-CDP browser profile (attach-only, no local launch) under
* `name`, replacing any existing profile with that name.
*
* Registration is create-only, but a re-attach after the prior session
* expired reuses the same profile name. `replaceExisting` overwrites in the
* same config mutation instead of deleting first: a failed replacement
* (invalid endpoint, exhausted ports) then leaves the old working profile in
* place rather than deleting it and returning an error with nothing left, and
* `browser.defaultProfile` is never touched either way.
*/
async function registerRemoteCdpBrowserProfile(params) {
	try {
		parseBrowserHttpUrl(params.cdpUrl, "browser_handoff cdpUrl");
	} catch (err) {
		return {
			ok: false,
			error: formatErrorMessage(err)
		};
	}
	try {
		if (!await createBrowserProfileConfig({
			name: params.name,
			resolved: resolveBrowserConfig(void 0, void 0),
			parsedCdpUrl: params.cdpUrl,
			driver: "existing-session",
			replaceExisting: true
		})) return {
			ok: false,
			error: "profile mutation returned no result"
		};
		return {
			ok: true,
			name: params.name
		};
	} catch (err) {
		return {
			ok: false,
			error: formatErrorMessage(err)
		};
	}
}
/** Remove a previously registered browser profile by name. */
async function unregisterRemoteCdpBrowserProfile(name) {
	await deleteBrowserProfileConfig(name);
}
//#endregion
export { registerRemoteCdpBrowserProfile, unregisterRemoteCdpBrowserProfile };
