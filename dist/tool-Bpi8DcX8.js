import { i as formatErrorMessage } from "./errors-eFp0F5lL.js";
import { t as createSubsystemLogger } from "./subsystem-CYwCorYs.js";
import { y as ssrfPolicyFromHttpBaseUrlAllowedHostname } from "./ssrf-CrFJ5rqR.js";
import { r as fetchWithSsrFGuard } from "./fetch-guard-CRd13cah.js";
import { n as retryAsync } from "./retry-Dbt2hk5K.js";
import "./error-runtime-DvwXOTIL.js";
import "./logging-core-CXejP4zV.js";
import "./ssrf-runtime-BEA0pv1w.js";
import { t as registerRemoteCdpBrowserProfile } from "./browser-profile-config-CfrdLPtI.js";
import "./retry-runtime-CMa_nkrh.js";
//#region extensions/browser-handoff/src/boon-core-client.ts
/**
* boon-core HTTP client for the browser handoff broker endpoints.
*
* Modeled on the existing agent->boon-core outbound pattern used by the
* anychat-boon-web channel transport (Bearer auth via BOON_API_KEY, snake_case
* wire format, `{ data }` / `{ error: { code, message } }` envelopes). That
* transport lives in a separate repo/package graph and cannot be imported
* directly by a bundled OpenClaw extension, so this is a thin, extension-local
* copy of the same wire contract rather than a shared dependency.
*/
var BrowserHandoffApiError = class extends Error {
	constructor(message, status, retryable, code) {
		super(message);
		this.name = "BrowserHandoffApiError";
		this.status = status;
		this.retryable = retryable;
		if (code !== void 0) this.code = code;
	}
};
/** Read the fleet-provisioned outbound bearer for agent->boon-core calls. */
function requireBoonApiKey(env = process.env) {
	const key = env.BOON_API_KEY?.trim();
	if (!key) throw new Error("browser-handoff: BOON_API_KEY env is required for boon-core calls");
	return key;
}
function buildUrl(baseUrl, path) {
	return `${baseUrl.replace(/\/$/, "")}${path}`;
}
async function extractError(res) {
	try {
		const err = (await res.json())?.error;
		if (err && typeof err === "object") return {
			...typeof err.code === "string" ? { code: err.code } : {},
			...typeof err.message === "string" ? { message: err.message } : {}
		};
	} catch {}
	return {};
}
/**
* Fetch via the shared SSRF-guarded wrapper (required for outbound
* channel/plugin runtime calls) and convert both HTTP error statuses and
* thrown network/SSRF errors into `BrowserHandoffApiError` so the retry
* predicate below can see them; a bare fetch rejection would otherwise never
* match `err instanceof BrowserHandoffApiError` and retry would be dead for
* the most common transient failure mode.
*/
async function guardedFetchOrWrapError(url, init, failureLabel) {
	try {
		return await fetchWithSsrFGuard({
			url,
			init,
			policy: ssrfPolicyFromHttpBaseUrlAllowedHostname(url),
			auditContext: "browser-handoff"
		});
	} catch (err) {
		if (init.signal?.aborted || err instanceof Error && err.name === "AbortError") throw err;
		if (err instanceof BrowserHandoffApiError) throw err;
		throw new BrowserHandoffApiError(`${failureLabel}: ${err instanceof Error ? err.message : String(err)}`, 0, true);
	}
}
async function postJson(params) {
	return await retryAsync(async () => {
		const { response: res, release } = await guardedFetchOrWrapError(params.url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${params.apiKey}`,
				"Content-Type": "application/json",
				"Idempotency-Key": params.idempotencyKey
			},
			body: JSON.stringify(params.body),
			...params.signal ? { signal: params.signal } : {}
		}, "browser-handoff request network error");
		try {
			if (res.status >= 400 && res.status < 500) {
				const { code, message } = await extractError(res);
				throw new BrowserHandoffApiError(message ?? `browser-handoff request rejected: ${res.status}`, res.status, false, code);
			}
			if (!res.ok) {
				const { code, message } = await extractError(res);
				throw new BrowserHandoffApiError(message ?? `browser-handoff request failed: ${res.status}`, res.status, true, code);
			}
			return await res.json();
		} finally {
			await release();
		}
	}, {
		attempts: 3,
		shouldRetry: (err) => err instanceof BrowserHandoffApiError && err.retryable
	});
}
async function getJson(params) {
	return await retryAsync(async () => {
		const { response: res, release } = await guardedFetchOrWrapError(params.url, {
			method: "GET",
			headers: { Authorization: `Bearer ${params.apiKey}` },
			...params.signal ? { signal: params.signal } : {}
		}, "browser-handoff status network error");
		try {
			if (res.status >= 400 && res.status < 500) {
				const { code, message } = await extractError(res);
				throw new BrowserHandoffApiError(message ?? `browser-handoff status rejected: ${res.status}`, res.status, false, code);
			}
			if (!res.ok) {
				const { code, message } = await extractError(res);
				throw new BrowserHandoffApiError(message ?? `browser-handoff status failed: ${res.status}`, res.status, true, code);
			}
			return await res.json();
		} finally {
			await release();
		}
	}, {
		attempts: 3,
		shouldRetry: (err) => err instanceof BrowserHandoffApiError && err.retryable
	});
}
/** Ask boon-core to mint a hosted browser session for the customer to sign into. */
async function requestBrowserLoginHandoff(params) {
	const idempotencyKey = crypto.randomUUID();
	const data = (await postJson({
		url: buildUrl(params.baseUrl, "/api/v1/agent/browser_handoff/request"),
		apiKey: params.apiKey,
		idempotencyKey,
		body: {
			site: params.site,
			...params.loginUrl ? { login_url: params.loginUrl } : {},
			...params.reason ? { reason: params.reason } : {}
		},
		...params.signal ? { signal: params.signal } : {}
	}))?.data;
	if (!data?.handoff_token || !data.live_view_url) throw new BrowserHandoffApiError("browser-handoff request response missing fields", 200, false);
	return {
		handoffToken: data.handoff_token,
		liveViewUrl: data.live_view_url
	};
}
/** Poll boon-core for whether the customer has finished signing in. */
async function pollBrowserHandoffStatus(params) {
	const body = await getJson({
		url: `${buildUrl(params.baseUrl, "/api/v1/agent/browser_handoff/status")}?handoff_token=${encodeURIComponent(params.handoffToken)}`,
		apiKey: params.apiKey,
		...params.signal ? { signal: params.signal } : {}
	});
	const status = body?.data?.status;
	if (status !== "pending" && status !== "ready" && status !== "failed") throw new BrowserHandoffApiError("browser-handoff status response missing/invalid status", 200, false);
	if (status === "ready" && !body?.data?.profile_name) throw new BrowserHandoffApiError("browser-handoff status response missing profile_name for ready status", 200, false);
	return {
		status,
		...body?.data?.profile_name ? { profileName: body.data.profile_name } : {},
		...body?.data?.cdp_url ? { cdpUrl: body.data.cdp_url } : {}
	};
}
//#endregion
//#region extensions/browser-handoff/src/state.ts
const BROWSER_HANDOFF_STATE_NAMESPACE = "handoffs";
const BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS = 14400 * 1e3;
/** Normalize a site identifier into a stable, case-insensitive state key. */
function browserHandoffStateKey(site) {
	return site.trim().toLowerCase();
}
/**
* Cron tag for this site's scheduled recheck turn. Cron tag names reject the
* `:` delimiter (reserved for its own name encoding). Base64url-encode the
* normalized site rather than substituting `:` for another character: a
* naive substitution collides (`example.com:8080` and `example.com-8080`
* would both produce the same tag), silently merging two sites' schedules.
*/
function browserHandoffScheduleTag(site) {
	return `handoff-${Buffer.from(browserHandoffStateKey(site)).toString("base64url")}`;
}
//#endregion
//#region extensions/browser-handoff/src/tool.ts
const FIRST_RECHECK_DELAY_MS = 3e4;
const MAX_RECHECK_DELAY_MS = 2 * 6e4;
const RECHECK_BACKOFF_MULTIPLIER = 2;
const MAX_TOTAL_WAIT_MS = 180 * 6e4;
function nextRecheckDelayMs(previousCheckCount) {
	const delay = FIRST_RECHECK_DELAY_MS * RECHECK_BACKOFF_MULTIPLIER ** previousCheckCount;
	return Math.min(delay, MAX_RECHECK_DELAY_MS);
}
const CLEAR_RECHECK_RETRY_ATTEMPTS = 3;
const log = createSubsystemLogger("browser-handoff");
function sleepBeforeRetry(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
/**
* Schedules the next durable status recheck for `site`, if a sessionKey is
* available. Best-effort: a scheduling failure (e.g. cron unavailable) must
* not fail the tool call itself — the model's own text guidance is still a
* valid, if less durable, fallback path. Returns whether scheduling actually
* happened, so callers can tell the model when automatic resume isn't live.
*
* `deliveryMode: "none"` keeps routine rechecks silent (no "still waiting"
* spam), which also suppresses the turn's own reply for a terminal outcome
* (ready/failed/expired) — the scheduled message text below explicitly tells
* the resumed model to use the `message` tool for those cases instead.
*
* Always clears any previously-scheduled recheck for this site first, so
* every call site is dedup-by-construction against stacking overlapping
* schedules (e.g. a manual status check racing the scheduled one). If that
* cleanup can't confirm the old job is gone, skip scheduling a replacement
* rather than risk two overlapping rechecks firing.
*
* Live-observed failure mode this message wording guards against: a resumed
* model can pattern-match "if it's still pending, end your turn without
* replying" against its OWN recent context (it just told the customer
* moments ago that sign-in hadn't come through) and skip the actual
* browser_handoff status call entirely, answering from memory instead of
* checking again -- silently breaking the whole recheck chain, since
* `handleStatus` (the only place that reschedules) never runs. The message
* is deliberately blunt about this: call the tool now, don't answer from
* memory, base the reply only on this turn's fresh result.
*/
async function scheduleRecheck(api, context, params) {
	const sessionKey = context.runSessionKey ?? context.sessionKey;
	if (!sessionKey) {
		log.warn(`site=${params.site} recheck not scheduled: no sessionKey/runSessionKey in context`);
		return false;
	}
	let cleared = false;
	for (let attempt = 1; attempt <= CLEAR_RECHECK_RETRY_ATTEMPTS; attempt++) {
		cleared = await clearScheduledRecheck(api, context, params.site);
		if (cleared || attempt === CLEAR_RECHECK_RETRY_ATTEMPTS) break;
		await sleepBeforeRetry(200);
	}
	if (!cleared) {
		log.warn(`site=${params.site} recheck not scheduled: could not confirm prior schedule cleared after ${CLEAR_RECHECK_RETRY_ATTEMPTS} attempts`);
		return false;
	}
	if (!await api.session.workflow.scheduleSessionTurn({
		sessionKey,
		message: [
			`Automated recheck — not a customer message. Whatever you already believe about`,
			`"${params.site}" from earlier in this conversation is stale by now; you have no current`,
			`information until you get a fresh answer. Your only job this turn is to call`,
			`browser_handoff with action="status" and site="${params.site}" and read its actual result —`,
			`do not skip this call or answer from memory.`,
			`This check runs silently: once you have that fresh result, if it says ready, failed, or`,
			`expired, use the message tool (action="send") to tell the customer now, before any other`,
			`tool call — a follow-up step like action=attach or the browser tool can still fail or hang,`,
			`and the customer must not be left with no reply because of that. If it says pending,`,
			`end your turn without sending anything — do not explain, do not apologize, just stop.`
		].join(" "),
		delayMs: params.delayMs,
		deleteAfterRun: true,
		tag: browserHandoffScheduleTag(params.site),
		deliveryMode: "none"
	})) {
		log.warn(`site=${params.site} recheck not scheduled: scheduleSessionTurn returned no job`);
		return false;
	}
	return true;
}
/**
* Best-effort cleanup once a handoff resolves — not a hard dependency: each
* recheck is already a one-shot (`deleteAfterRun: true`), so this only
* matters for the rare case of a schedule still in flight when the outcome
* lands some other way (e.g. a human-driven manual status check).
*
* Returns whether the site is now confirmed clear of scheduled rechecks
* (true when there was nothing to clear, or cleanup reported no failures),
* so `scheduleRecheck` can refuse to add a replacement it can't be sure is
* the only one.
*/
async function clearScheduledRecheck(api, context, site) {
	const sessionKey = context.runSessionKey ?? context.sessionKey;
	if (!sessionKey) return true;
	const legacySessionKey = context.runSessionKey && context.sessionKey && context.sessionKey !== sessionKey ? context.sessionKey : void 0;
	const tag = browserHandoffScheduleTag(site);
	return (await Promise.all([api.session.workflow.unscheduleSessionTurnsByTag({
		sessionKey,
		tag
	}), ...legacySessionKey ? [api.session.workflow.unscheduleSessionTurnsByTag({
		sessionKey: legacySessionKey,
		tag
	})] : []])).every((result) => result.failed === 0);
}
function textResult(text) {
	return {
		content: [{
			type: "text",
			text
		}],
		details: void 0
	};
}
function openHandoffStore(api) {
	return api.runtime.state.openKeyedStore({
		namespace: BROWSER_HANDOFF_STATE_NAMESPACE,
		maxEntries: 512,
		defaultTtlMs: BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS
	});
}
function requireBoonCoreBaseUrl(api) {
	const baseUrl = api.pluginConfig?.boonCoreBaseUrl;
	if (!baseUrl?.trim()) throw new Error("browser-handoff: plugins.entries.browser-handoff.config.boonCoreBaseUrl is not configured");
	return baseUrl.trim();
}
async function handleRequestLogin(api, params, context) {
	const handoff = await requestBrowserLoginHandoff({
		baseUrl: requireBoonCoreBaseUrl(api),
		apiKey: requireBoonApiKey(),
		site: params.site,
		...params.loginUrl ? { loginUrl: params.loginUrl } : {},
		...params.reason ? { reason: params.reason } : {}
	});
	const record = {
		site: params.site,
		handoffToken: handoff.handoffToken,
		status: "pending",
		createdAtMs: Date.now(),
		checkCount: 0
	};
	await openHandoffStore(api).register(browserHandoffStateKey(params.site), record);
	const followUp = await scheduleRecheck(api, context, {
		site: params.site,
		delayMs: FIRST_RECHECK_DELAY_MS
	}) ? `Do not enter credentials on their behalf. You'll be resumed automatically once they finish — you can end your turn now. If needed, you can also call this tool again with action=status and site="${params.site}" to check manually.` : `Do not enter credentials on their behalf. Automatic resume is not available right now, so you'll need to check back yourself — call this tool again with action=status and site="${params.site}" once the customer says they're done.`;
	return textResult([
		`Share this sign-in link with the customer so they can log in themselves (including any CAPTCHA/2FA):`,
		handoff.liveViewUrl,
		"",
		followUp
	].join("\n"));
}
async function handleStatus(api, params, context) {
	const baseUrl = requireBoonCoreBaseUrl(api);
	const apiKey = requireBoonApiKey();
	const store = openHandoffStore(api);
	const key = browserHandoffStateKey(params.site);
	const record = await store.lookup(key);
	if (!record) return textResult(`No pending login handoff found for "${params.site}". Call action=request_login first.`);
	const result = await pollBrowserHandoffStatus({
		baseUrl,
		apiKey,
		handoffToken: record.handoffToken
	});
	if (result.status === "pending") {
		const previousCheckCount = record.checkCount ?? 0;
		if (Date.now() - record.createdAtMs >= MAX_TOTAL_WAIT_MS) {
			await store.delete(key);
			await clearScheduledRecheck(api, context, params.site);
			return textResult(`The login link for "${params.site}" may have expired after too long without the customer finishing. Call action=request_login to send a fresh one.`);
		}
		const nextCheckCount = previousCheckCount + 1;
		await store.register(key, {
			...record,
			checkCount: nextCheckCount
		});
		const scheduled = await scheduleRecheck(api, context, {
			site: params.site,
			delayMs: nextRecheckDelayMs(nextCheckCount)
		});
		const stillWaiting = `Still waiting on the customer to finish signing in to "${params.site}".`;
		if (!scheduled) return textResult(`${stillWaiting} Automatic resume is not available right now, so check back yourself with action=status once the customer says they're done.`);
		return textResult(stillWaiting);
	}
	if (result.status === "failed") {
		await store.delete(key);
		await clearScheduledRecheck(api, context, params.site);
		return textResult(`The login handoff for "${params.site}" failed or expired. Call action=request_login to try again.`);
	}
	await clearScheduledRecheck(api, context, params.site);
	await store.register(key, {
		...record,
		status: "ready",
		...result.profileName ? { profileName: result.profileName } : {}
	});
	return textResult(`The customer finished signing in to "${params.site}". Use the message tool (action="send") to tell them now, before doing anything else. Only after that, call action=attach with the same site to finish setup.`);
}
/**
* The remote-CDP profile mechanism (Playwright's `connectOverCDP`) only ever
* derives auth from URL-embedded credentials, which become HTTP Basic auth —
* it has no way to attach a custom `Bearer` header. boon-core's
* `AgentBearerAuthentication` accepts the same token via `Basic
* base64(token:)`, so embedding it as URL userinfo (empty password) lets this
* one token authenticate through a client that structurally can't send a
* header. The resulting profile config is redacted via `redactCdpUrl`
* wherever it's displayed or logged.
*/
function withBearerAsBasicAuth(cdpUrl, apiKey) {
	const url = new URL(cdpUrl);
	url.username = apiKey.replaceAll("%", "%25");
	url.password = "";
	return url.toString();
}
async function handleAttach(api, params) {
	const baseUrl = requireBoonCoreBaseUrl(api);
	const apiKey = requireBoonApiKey();
	const store = openHandoffStore(api);
	const key = browserHandoffStateKey(params.site);
	const record = await store.lookup(key);
	if (!record || record.status !== "ready" || !record.profileName) return textResult(`No completed login handoff found for "${params.site}". Call action=status first to confirm the customer is done.`);
	const result = await pollBrowserHandoffStatus({
		baseUrl,
		apiKey,
		handoffToken: record.handoffToken
	});
	if (result.status !== "ready" || !result.cdpUrl) return textResult(`The login session for "${params.site}" is no longer ready to attach. Call action=status to recheck.`);
	const registration = await registerRemoteCdpBrowserProfile({
		name: record.profileName,
		cdpUrl: withBearerAsBasicAuth(result.cdpUrl, apiKey)
	});
	if (!registration.ok) return textResult(`Failed to register the browser profile for "${params.site}": ${registration.error}`);
	await store.delete(key);
	return textResult(`Done. Use the browser tool with profile="${registration.name}" to continue on "${params.site}".`);
}
/** Handle a Browser Login Handoff tool call. */
async function executeBrowserHandoffTool(api, params, context = {}) {
	try {
		if (params.action === "request_login") return await handleRequestLogin(api, params, context);
		if (params.action === "status") return await handleStatus(api, params, context);
		return await handleAttach(api, params);
	} catch (err) {
		return textResult(`browser-handoff error: ${formatErrorMessage(err)}`);
	}
}
function readAction(raw) {
	const action = raw.action;
	if (action === "request_login" || action === "status" || action === "attach") return action;
	throw new Error("browser_handoff: action must be one of \"request_login\", \"status\", \"attach\"");
}
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
function readSite(raw) {
	const site = typeof raw.site === "string" ? raw.site.trim() : "";
	if (!site) throw new Error("browser_handoff: site is required");
	if (!HOSTNAME_PATTERN.test(site)) throw new Error("browser_handoff: site must look like a hostname (e.g. \"app.example.com\")");
	return site;
}
function readOptionalString(raw, key) {
	const value = raw[key];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
/**
* Handle a raw tool-call args object, parsing it into `BrowserHandoffToolParams`.
*
* Parsing happens inside the same try/catch as the rest of the tool so a bad
* `action`/`site` produces the tool's normal `browser-handoff error:` text
* result instead of a raw thrown tool-call error.
*/
async function executeBrowserHandoffToolFromArgs(api, args, context = {}) {
	try {
		const raw = args && typeof args === "object" ? args : {};
		const loginUrl = readOptionalString(raw, "loginUrl");
		const reason = readOptionalString(raw, "reason");
		return await executeBrowserHandoffTool(api, {
			action: readAction(raw),
			site: readSite(raw),
			...loginUrl ? { loginUrl } : {},
			...reason ? { reason } : {}
		}, context);
	} catch (err) {
		return textResult(`browser-handoff error: ${formatErrorMessage(err)}`);
	}
}
//#endregion
export { executeBrowserHandoffToolFromArgs };
