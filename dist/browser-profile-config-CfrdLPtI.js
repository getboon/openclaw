import { a as tryLoadActivatedBundledPluginPublicSurfaceModuleSync, t as canLoadActivatedBundledPluginPublicSurface } from "./facade-runtime-DTvFghsu.js";
//#region src/plugin-sdk/browser-profile-config.ts
/**
* Public SDK facade for registering a remote-CDP browser profile owned by the
* bundled `browser` plugin, for use by sibling plugins that need to hand a
* browser tool an attach-only session (e.g. after a login handoff).
*/
let cachedBrowserProfileMutationSurface;
function loadBrowserProfileMutationSurface() {
	const request = {
		dirName: "browser",
		artifactBasename: "browser-profile-mutations.js"
	};
	if (!canLoadActivatedBundledPluginPublicSurface(request)) return null;
	if (!cachedBrowserProfileMutationSurface) cachedBrowserProfileMutationSurface = tryLoadActivatedBundledPluginPublicSurfaceModuleSync(request) ?? void 0;
	return cachedBrowserProfileMutationSurface ?? null;
}
/** Register a remote-CDP browser profile when the browser plugin is active. */
async function registerRemoteCdpBrowserProfile(params) {
	const surface = loadBrowserProfileMutationSurface();
	if (!surface) return {
		ok: false,
		error: "browser plugin is not active"
	};
	return await surface.registerRemoteCdpBrowserProfile(params);
}
/** Remove a previously registered browser profile when the browser plugin is active. */
async function unregisterRemoteCdpBrowserProfile(name) {
	const surface = loadBrowserProfileMutationSurface();
	if (!surface) return;
	await surface.unregisterRemoteCdpBrowserProfile(name);
}
//#endregion
export { unregisterRemoteCdpBrowserProfile as n, registerRemoteCdpBrowserProfile as t };
