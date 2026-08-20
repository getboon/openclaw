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
  browserHandoffStateKey,
  type BrowserHandoffRecord,
} from "./state.js";

export type BrowserHandoffToolParams = {
  action: "request_login" | "status" | "attach";
  site: string;
  loginUrl?: string;
  reason?: string;
};

export type BrowserHandoffToolTextResult = { content: [{ type: "text"; text: string }] };

function textResult(text: string): BrowserHandoffToolTextResult {
  return { content: [{ type: "text", text }] };
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
  };
  await openHandoffStore(api).register(browserHandoffStateKey(params.site), record);

  return textResult(
    [
      `Share this sign-in link with the customer so they can log in themselves (including any CAPTCHA/2FA):`,
      handoff.liveViewUrl,
      "",
      "Do not enter credentials on their behalf. Once they say they're done, call this tool again " +
        `with action=status and site="${params.site}".`,
    ].join("\n"),
  );
}

async function handleStatus(
  api: OpenClawPluginApi,
  params: BrowserHandoffToolParams,
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
    return textResult(`Still waiting on the customer to finish signing in to "${params.site}".`);
  }
  if (result.status === "failed") {
    await store.delete(key);
    return textResult(
      `The login handoff for "${params.site}" failed or expired. Call action=request_login to try again.`,
    );
  }

  await store.register(key, {
    ...record,
    status: "ready",
    ...(result.profileName ? { profileName: result.profileName } : {}),
  });
  return textResult(
    `The customer finished signing in to "${params.site}". Call action=attach with the same site to finish setup.`,
  );
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
    cdpUrl: result.cdpUrl,
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
): Promise<BrowserHandoffToolTextResult> {
  try {
    if (params.action === "request_login") {
      return await handleRequestLogin(api, params);
    }
    if (params.action === "status") {
      return await handleStatus(api, params);
    }
    return await handleAttach(api, params);
  } catch (err) {
    return textResult(`browser-handoff error: ${formatErrorMessage(err)}`);
  }
}
