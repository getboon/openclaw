import { c as shouldUseEnvHttpProxyForUrl } from "./proxy-env-B9aW4MXJ.js";
import { r as fetchWithSsrFGuard } from "./fetch-guard-CRd13cah.js";
import { t as withTrustedEnvProxyGuardedFetchMode } from "./fetch-runtime-CIdBUNED.js";
import "./ssrf-runtime-BEA0pv1w.js";
import { a as DEFAULT_FETCH_TIMEOUT_MS } from "./oauth.shared-BD6M390i.js";
//#region extensions/google/oauth.http.ts
async function fetchWithTimeout(url, init, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
	const guardedOptions = {
		url,
		init,
		timeoutMs
	};
	const { response, release } = await fetchWithSsrFGuard(shouldUseEnvHttpProxyForUrl(url) ? withTrustedEnvProxyGuardedFetchMode(guardedOptions) : guardedOptions);
	try {
		const body = await response.arrayBuffer();
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	} finally {
		await release();
	}
}
//#endregion
export { fetchWithTimeout as t };
