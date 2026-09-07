// Browser Login Handoff tool implementation: request/status/attach against boon-core.
import { registerRemoteCdpBrowserProfile } from "openclaw/plugin-sdk/browser-profile-config";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginStateKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import {
  pollBrowserHandoffStatus,
  requestBrowserLoginHandoff,
  requireBoonApiKey,
} from "./boon-core-client.js";
import {
  BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS,
  BROWSER_HANDOFF_STATE_MAX_ENTRIES,
  BROWSER_HANDOFF_STATE_NAMESPACE,
  browserHandoffScheduleTag,
  browserHandoffStateKey,
  type BrowserHandoffRecord,
} from "./state.js";

export type BrowserHandoffToolParams = {
  action: "request_login" | "status" | "attach";
  site: string;
  loginUrl?: string;
  reason?: string;
};

/**
 * Trusted, host-provided context — never model-facing args. `sessionKey` is
 * what lets this tool schedule a durable resume; when it's unavailable (e.g.
 * a bare unit-test call), scheduling is skipped rather than failing, since
 * the tool's own text guidance already gives a model a manual fallback path.
 *
 * `sessionKey` may be a sandbox/policy key that was never itself persisted as
 * a transcript session (e.g. a direct-message peer key under a config that
 * collapses DMs to one shared main session) -- scheduling a resume against it
 * binds to a session that can never be resumed. `runSessionKey`, when present,
 * is the actual live run session and takes priority for scheduling.
 */
export type BrowserHandoffToolContext = {
  sessionKey?: string;
  runSessionKey?: string;
};

// Recheck backoff: fast at first (a human might finish a plain login in
// seconds), backing off because most of the wait is 2FA/CAPTCHA the human is
// actively doing, not something worth polling tightly for. The 30-minute cap
// matches the ticket's realistic "human got distracted or gave up" window,
// not Anchor's own 15-minute token expiry (that's boon-core's concern).
const FIRST_RECHECK_DELAY_MS = 30_000;
const MAX_RECHECK_DELAY_MS = 5 * 60_000;
const RECHECK_BACKOFF_MULTIPLIER = 2;
const MAX_TOTAL_WAIT_MS = 30 * 60_000;

function nextRecheckDelayMs(previousCheckCount: number): number {
  const delay = FIRST_RECHECK_DELAY_MS * RECHECK_BACKOFF_MULTIPLIER ** previousCheckCount;
  return Math.min(delay, MAX_RECHECK_DELAY_MS);
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
async function scheduleRecheck(
  api: OpenClawPluginApi,
  context: BrowserHandoffToolContext,
  params: { site: string; delayMs: number },
): Promise<boolean> {
  const sessionKey = context.runSessionKey ?? context.sessionKey;
  if (!sessionKey) {
    return false;
  }
  const cleared = await clearScheduledRecheck(api, context, params.site);
  if (!cleared) {
    return false;
  }
  const job = await api.session.workflow.scheduleSessionTurn({
    sessionKey,
    message: [
      `Automated recheck — not a customer message. Whatever you already believe about`,
      `"${params.site}" from earlier in this conversation is stale by now; you have no current`,
      `information until you get a fresh answer. Your only job this turn is to call`,
      `browser_handoff with action="status" and site="${params.site}" and read its actual result —`,
      `do not skip this call or answer from memory.`,
      `This check runs silently: once you have that fresh result, if it says ready, failed, or`,
      `expired, use the message tool (action="send") to tell the customer now; if it says pending,`,
      `end your turn without sending anything — do not explain, do not apologize, just stop.`,
    ].join(" "),
    delayMs: params.delayMs,
    deleteAfterRun: true,
    tag: browserHandoffScheduleTag(params.site),
    deliveryMode: "none",
  });
  return Boolean(job);
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
async function clearScheduledRecheck(
  api: OpenClawPluginApi,
  context: BrowserHandoffToolContext,
  site: string,
): Promise<boolean> {
  const sessionKey = context.runSessionKey ?? context.sessionKey;
  if (!sessionKey) {
    return true;
  }
  // A recheck scheduled before runSessionKey started taking priority over
  // sessionKey is tagged under the legacy sessionKey. Clear both so a job
  // from before that transition can't outlive this cleanup and overlap the
  // newly scheduled live-session check.
  const legacySessionKey =
    context.runSessionKey && context.sessionKey && context.sessionKey !== sessionKey
      ? context.sessionKey
      : undefined;
  const tag = browserHandoffScheduleTag(site);
  const results = await Promise.all([
    api.session.workflow.unscheduleSessionTurnsByTag({ sessionKey, tag }),
    ...(legacySessionKey
      ? [api.session.workflow.unscheduleSessionTurnsByTag({ sessionKey: legacySessionKey, tag })]
      : []),
  ]);
  return results.every((result) => result.failed === 0);
}

export type BrowserHandoffToolTextResult = {
  content: [{ type: "text"; text: string }];
  details: undefined;
};

function textResult(text: string): BrowserHandoffToolTextResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function openHandoffStore(api: OpenClawPluginApi): PluginStateKeyedStore<BrowserHandoffRecord> {
  return api.runtime.state.openKeyedStore<BrowserHandoffRecord>({
    namespace: BROWSER_HANDOFF_STATE_NAMESPACE,
    maxEntries: BROWSER_HANDOFF_STATE_MAX_ENTRIES,
    defaultTtlMs: BROWSER_HANDOFF_STATE_DEFAULT_TTL_MS,
  });
}

function requireBoonCoreBaseUrl(api: OpenClawPluginApi): string {
  const baseUrl = (api.pluginConfig as { boonCoreBaseUrl?: string } | undefined)?.boonCoreBaseUrl;
  if (!baseUrl?.trim()) {
    throw new Error(
      "browser-handoff: plugins.entries.browser-handoff.config.boonCoreBaseUrl is not configured",
    );
  }
  return baseUrl.trim();
}

async function handleRequestLogin(
  api: OpenClawPluginApi,
  params: BrowserHandoffToolParams,
  context: BrowserHandoffToolContext,
): Promise<BrowserHandoffToolTextResult> {
  const baseUrl = requireBoonCoreBaseUrl(api);
  const apiKey = requireBoonApiKey();
  const handoff = await requestBrowserLoginHandoff({
    baseUrl,
    apiKey,
    site: params.site,
    ...(params.loginUrl ? { loginUrl: params.loginUrl } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  });

  const record: BrowserHandoffRecord = {
    site: params.site,
    handoffToken: handoff.handoffToken,
    status: "pending",
    createdAtMs: Date.now(),
    checkCount: 0,
  };
  await openHandoffStore(api).register(browserHandoffStateKey(params.site), record);
  const scheduled = await scheduleRecheck(api, context, {
    site: params.site,
    delayMs: FIRST_RECHECK_DELAY_MS,
  });

  const followUp = scheduled
    ? "Do not enter credentials on their behalf. You'll be resumed automatically once they finish " +
      `— you can end your turn now. If needed, you can also call this tool again with action=status ` +
      `and site="${params.site}" to check manually.`
    : "Do not enter credentials on their behalf. Automatic resume is not available right now, so " +
      `you'll need to check back yourself — call this tool again with action=status and ` +
      `site="${params.site}" once the customer says they're done.`;

  return textResult(
    [
      `Share this sign-in link with the customer so they can log in themselves (including any CAPTCHA/2FA):`,
      handoff.liveViewUrl,
      "",
      followUp,
    ].join("\n"),
  );
}

async function handleStatus(
  api: OpenClawPluginApi,
  params: BrowserHandoffToolParams,
  context: BrowserHandoffToolContext,
): Promise<BrowserHandoffToolTextResult> {
  const baseUrl = requireBoonCoreBaseUrl(api);
  const apiKey = requireBoonApiKey();
  const store = openHandoffStore(api);
  const key = browserHandoffStateKey(params.site);
  const record = await store.lookup(key);
  if (!record) {
    return textResult(
      `No pending login handoff found for "${params.site}". Call action=request_login first.`,
    );
  }

  const result = await pollBrowserHandoffStatus({
    baseUrl,
    apiKey,
    handoffToken: record.handoffToken,
  });

  if (result.status === "pending") {
    const previousCheckCount = record.checkCount ?? 0;
    if (Date.now() - record.createdAtMs >= MAX_TOTAL_WAIT_MS) {
      await store.delete(key);
      await clearScheduledRecheck(api, context, params.site);
      return textResult(
        `The login link for "${params.site}" may have expired after too long without the customer ` +
          "finishing. Call action=request_login to send a fresh one.",
      );
    }
    const nextCheckCount = previousCheckCount + 1;
    await store.register(key, { ...record, checkCount: nextCheckCount });
    const scheduled = await scheduleRecheck(api, context, {
      site: params.site,
      delayMs: nextRecheckDelayMs(nextCheckCount),
    });
    const stillWaiting = `Still waiting on the customer to finish signing in to "${params.site}".`;
    if (!scheduled) {
      // No durable recheck is queued (no sessionKey, or cleanup couldn't confirm
      // the old one is gone) — say so explicitly, since a silently-resumed turn
      // that just reads "still waiting" would otherwise end its turn assuming
      // it'll be woken again, stranding the handoff with no future check.
      return textResult(
        `${stillWaiting} Automatic resume is not available right now, so check back yourself with ` +
          `action=status once the customer says they're done.`,
      );
    }
    return textResult(stillWaiting);
  }
  if (result.status === "failed") {
    await store.delete(key);
    await clearScheduledRecheck(api, context, params.site);
    return textResult(
      `The login handoff for "${params.site}" failed or expired. Call action=request_login to try again.`,
    );
  }

  await clearScheduledRecheck(api, context, params.site);
  await store.register(key, {
    ...record,
    status: "ready",
    ...(result.profileName ? { profileName: result.profileName } : {}),
  });
  return textResult(
    `The customer finished signing in to "${params.site}". Call action=attach with the same site to finish setup.`,
  );
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
function withBearerAsBasicAuth(cdpUrl: string, apiKey: string): string {
  const url = new URL(cdpUrl);
  // The username setter doesn't escape a literal "%" — left as-is, a key
  // like "ab%41cd" would decode back as "abAcd" (a different, wrong value)
  // instead of throwing, since "%41" alone is a valid escape. Escaping "%"
  // to "%25" first guarantees one decode round-trips to the original key.
  url.username = apiKey.replaceAll("%", "%25");
  url.password = "";
  return url.toString();
}

async function handleAttach(
  api: OpenClawPluginApi,
  params: BrowserHandoffToolParams,
): Promise<BrowserHandoffToolTextResult> {
  const baseUrl = requireBoonCoreBaseUrl(api);
  const apiKey = requireBoonApiKey();
  const store = openHandoffStore(api);
  const key = browserHandoffStateKey(params.site);
  const record = await store.lookup(key);
  if (!record || record.status !== "ready" || !record.profileName) {
    return textResult(
      `No completed login handoff found for "${params.site}". Call action=status first to confirm the customer is done.`,
    );
  }

  const result = await pollBrowserHandoffStatus({
    baseUrl,
    apiKey,
    handoffToken: record.handoffToken,
  });
  if (result.status !== "ready" || !result.cdpUrl) {
    return textResult(
      `The login session for "${params.site}" is no longer ready to attach. Call action=status to recheck.`,
    );
  }

  const registration = await registerRemoteCdpBrowserProfile({
    name: record.profileName,
    cdpUrl: withBearerAsBasicAuth(result.cdpUrl, apiKey),
  });
  if (!registration.ok) {
    return textResult(
      `Failed to register the browser profile for "${params.site}": ${registration.error}`,
    );
  }

  await store.delete(key);
  return textResult(
    `Done. Use the browser tool with profile="${registration.name}" to continue on "${params.site}".`,
  );
}

/** Handle a Browser Login Handoff tool call. */
export async function executeBrowserHandoffTool(
  api: OpenClawPluginApi,
  params: BrowserHandoffToolParams,
  context: BrowserHandoffToolContext = {},
): Promise<BrowserHandoffToolTextResult> {
  try {
    if (params.action === "request_login") {
      return await handleRequestLogin(api, params, context);
    }
    if (params.action === "status") {
      return await handleStatus(api, params, context);
    }
    return await handleAttach(api, params);
  } catch (err) {
    return textResult(`browser-handoff error: ${formatErrorMessage(err)}`);
  }
}

function readAction(raw: Record<string, unknown>): "request_login" | "status" | "attach" {
  const action = raw.action;
  if (action === "request_login" || action === "status" || action === "attach") {
    return action;
  }
  throw new Error('browser_handoff: action must be one of "request_login", "status", "attach"');
}

// Model-supplied, and gets interpolated directly into scheduled-turn and
// reply prompt text (schedule-recheck's message, the request_login reply,
// status/error text) -- a value containing quotes, newlines, or
// instruction-like text there is a prompt-injection surface. `site` is
// documented as a hostname (e.g. "app.procore.com"), so reject anything
// that isn't shaped like one, rather than trying to escape it at every
// interpolation site.
// `(?=.{1,253}$)` bounds the TOTAL length (the real DNS hostname limit) --
// without it, each label is individually capped at 63 characters but an
// arbitrary number of valid labels could still produce an unbounded
// string, which then gets embedded in prompts and used to build state/
// schedule keys.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function readSite(raw: Record<string, unknown>): string {
  const site = typeof raw.site === "string" ? raw.site.trim() : "";
  if (!site) {
    throw new Error("browser_handoff: site is required");
  }
  if (!HOSTNAME_PATTERN.test(site)) {
    throw new Error('browser_handoff: site must look like a hostname (e.g. "app.example.com")');
  }
  return site;
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Handle a raw tool-call args object, parsing it into `BrowserHandoffToolParams`.
 *
 * Parsing happens inside the same try/catch as the rest of the tool so a bad
 * `action`/`site` produces the tool's normal `browser-handoff error:` text
 * result instead of a raw thrown tool-call error.
 */
export async function executeBrowserHandoffToolFromArgs(
  api: OpenClawPluginApi,
  args: unknown,
  context: BrowserHandoffToolContext = {},
): Promise<BrowserHandoffToolTextResult> {
  try {
    const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const loginUrl = readOptionalString(raw, "loginUrl");
    const reason = readOptionalString(raw, "reason");
    return await executeBrowserHandoffTool(
      api,
      {
        action: readAction(raw),
        site: readSite(raw),
        ...(loginUrl ? { loginUrl } : {}),
        ...(reason ? { reason } : {}),
      },
      context,
    );
  } catch (err) {
    return textResult(`browser-handoff error: ${formatErrorMessage(err)}`);
  }
}
