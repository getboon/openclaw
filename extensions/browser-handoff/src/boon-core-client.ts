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
import { retryAsync } from "openclaw/plugin-sdk/retry-runtime";

export type BrowserHandoffRequestResult = {
  handoffToken: string;
  liveViewUrl: string;
};

export type BrowserHandoffStatusResult = {
  status: "pending" | "ready" | "failed";
  profileName?: string;
  cdpUrl?: string;
};

export class BrowserHandoffApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code?: string;
  constructor(message: string, status: number, retryable: boolean, code?: string) {
    super(message);
    this.name = "BrowserHandoffApiError";
    this.status = status;
    this.retryable = retryable;
    if (code !== undefined) this.code = code;
  }
}

/** Read the fleet-provisioned outbound bearer for agent->boon-core calls. */
export function requireBoonApiKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.BOON_API_KEY?.trim();
  if (!key) {
    throw new Error("browser-handoff: BOON_API_KEY env is required for boon-core calls");
  }
  return key;
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function extractError(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    const err = body?.error;
    if (err && typeof err === "object") {
      return {
        ...(typeof err.code === "string" ? { code: err.code } : {}),
        ...(typeof err.message === "string" ? { message: err.message } : {}),
      };
    }
  } catch {
    // body may not be JSON; fall through
  }
  return {};
}

/**
 * Run a fetch and convert both HTTP error statuses and thrown network errors
 * (DNS/connection failures, resets) into `BrowserHandoffApiError` so the retry
 * predicate below can see them; a bare fetch rejection would otherwise never
 * match `err instanceof BrowserHandoffApiError` and retry would be dead for
 * the most common transient failure mode.
 */
async function fetchOrWrapNetworkError(
  url: string,
  init: RequestInit,
  failureLabel: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof BrowserHandoffApiError) {
      throw err;
    }
    throw new BrowserHandoffApiError(
      `${failureLabel}: ${err instanceof Error ? err.message : String(err)}`,
      0,
      true,
    );
  }
}

async function postJson(params: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await retryAsync(
    async () => {
      const res = await fetchOrWrapNetworkError(
        params.url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": params.idempotencyKey,
          },
          body: JSON.stringify(params.body),
          ...(params.signal ? { signal: params.signal } : {}),
        },
        "browser-handoff request network error",
      );
      if (res.status >= 400 && res.status < 500) {
        const { code, message } = await extractError(res);
        throw new BrowserHandoffApiError(
          message ?? `browser-handoff request rejected: ${res.status}`,
          res.status,
          false,
          code,
        );
      }
      if (!res.ok) {
        const { code, message } = await extractError(res);
        throw new BrowserHandoffApiError(
          message ?? `browser-handoff request failed: ${res.status}`,
          res.status,
          true,
          code,
        );
      }
      return await res.json();
    },
    {
      attempts: 3,
      shouldRetry: (err) => err instanceof BrowserHandoffApiError && err.retryable,
    },
  );
}

async function getJson(params: {
  url: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await retryAsync(
    async () => {
      const res = await fetchOrWrapNetworkError(
        params.url,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${params.apiKey}` },
          ...(params.signal ? { signal: params.signal } : {}),
        },
        "browser-handoff status network error",
      );
      if (res.status >= 400 && res.status < 500) {
        const { code, message } = await extractError(res);
        throw new BrowserHandoffApiError(
          message ?? `browser-handoff status rejected: ${res.status}`,
          res.status,
          false,
          code,
        );
      }
      if (!res.ok) {
        const { code, message } = await extractError(res);
        throw new BrowserHandoffApiError(
          message ?? `browser-handoff status failed: ${res.status}`,
          res.status,
          true,
          code,
        );
      }
      return await res.json();
    },
    {
      attempts: 3,
      shouldRetry: (err) => err instanceof BrowserHandoffApiError && err.retryable,
    },
  );
}

/** Ask boon-core to mint a hosted browser session for the customer to sign into. */
export async function requestBrowserLoginHandoff(params: {
  baseUrl: string;
  apiKey: string;
  site: string;
  loginUrl?: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<BrowserHandoffRequestResult> {
  // Stable across retries within this call so a 5xx retry cannot mint a
  // second handoff on boon-core's side.
  const idempotencyKey = crypto.randomUUID();
  const body = (await postJson({
    url: buildUrl(params.baseUrl, "/api/v1/agent/browser_handoff/request"),
    apiKey: params.apiKey,
    idempotencyKey,
    body: {
      site: params.site,
      ...(params.loginUrl ? { login_url: params.loginUrl } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
    },
    ...(params.signal ? { signal: params.signal } : {}),
  })) as { data?: { handoff_token?: string; live_view_url?: string } };

  const data = body?.data;
  if (!data?.handoff_token || !data.live_view_url) {
    throw new BrowserHandoffApiError("browser-handoff request response missing fields", 200, false);
  }
  return { handoffToken: data.handoff_token, liveViewUrl: data.live_view_url };
}

/** Poll boon-core for whether the customer has finished signing in. */
export async function pollBrowserHandoffStatus(params: {
  baseUrl: string;
  apiKey: string;
  handoffToken: string;
  signal?: AbortSignal;
}): Promise<BrowserHandoffStatusResult> {
  const url = `${buildUrl(params.baseUrl, "/api/v1/agent/browser_handoff/status")}?handoff_token=${encodeURIComponent(params.handoffToken)}`;
  const body = (await getJson({
    url,
    apiKey: params.apiKey,
    ...(params.signal ? { signal: params.signal } : {}),
  })) as { data?: { status?: string; profile_name?: string; cdp_url?: string } };

  const status = body?.data?.status;
  if (status !== "pending" && status !== "ready" && status !== "failed") {
    throw new BrowserHandoffApiError(
      "browser-handoff status response missing/invalid status",
      200,
      false,
    );
  }
  // A ready status with no profile name would silently produce a handoff
  // record that handleAttach can never actually attach; treat that as an
  // invalid response rather than reporting success.
  if (status === "ready" && !body?.data?.profile_name) {
    throw new BrowserHandoffApiError(
      "browser-handoff status response missing profile_name for ready status",
      200,
      false,
    );
  }
  return {
    status,
    ...(body?.data?.profile_name ? { profileName: body.data.profile_name } : {}),
    ...(body?.data?.cdp_url ? { cdpUrl: body.data.cdp_url } : {}),
  };
}
