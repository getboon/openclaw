// boon-core browser handoff client tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserHandoffApiError,
  pollBrowserHandoffStatus,
  requestBrowserLoginHandoff,
  requireBoonApiKey,
} from "./boon-core-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("requireBoonApiKey", () => {
  it("returns the trimmed BOON_API_KEY env value", () => {
    expect(requireBoonApiKey({ BOON_API_KEY: "  secret-key  " })).toBe("secret-key");
  });

  it("throws when BOON_API_KEY is missing", () => {
    expect(() => requireBoonApiKey({})).toThrow(/BOON_API_KEY/);
  });
});

describe("requestBrowserLoginHandoff", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts snake_case fields with a Bearer token and normalizes the response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: { handoff_token: "tok_123", live_view_url: "https://live.example/view" },
      }),
    );

    const result = await requestBrowserLoginHandoff({
      baseUrl: "https://app.getboon.ai/",
      apiKey: "test-key",
      site: "app.procore.com",
      loginUrl: "https://app.procore.com/login",
      reason: "login",
    });

    expect(result).toStrictEqual({
      handoffToken: "tok_123",
      liveViewUrl: "https://live.example/view",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://app.getboon.ai/api/v1/agent/browser_handoff/request");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toStrictEqual({
      site: "app.procore.com",
      login_url: "https://app.procore.com/login",
      reason: "login",
    });
  });

  it("throws a non-retryable error on 4xx without retrying", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: { code: "already_pending", message: "already pending" } }),
    );

    await expect(
      requestBrowserLoginHandoff({
        baseUrl: "https://app.getboon.ai",
        apiKey: "test-key",
        site: "app.procore.com",
      }),
    ).rejects.toMatchObject({
      name: "BrowserHandoffApiError",
      status: 409,
      retryable: false,
      code: "already_pending",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the response is missing required fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: {} }));

    await expect(
      requestBrowserLoginHandoff({
        baseUrl: "https://app.getboon.ai",
        apiKey: "test-key",
        site: "app.procore.com",
      }),
    ).rejects.toBeInstanceOf(BrowserHandoffApiError);
  });
});

describe("pollBrowserHandoffStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs with a query string and normalizes a ready status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: {
          status: "ready",
          profile_name: "handoff-app.procore.com",
          cdp_url: "wss://proxy/cdp",
        },
      }),
    );

    const result = await pollBrowserHandoffStatus({
      baseUrl: "https://app.getboon.ai",
      apiKey: "test-key",
      handoffToken: "tok 123",
    });

    expect(result).toStrictEqual({
      status: "ready",
      profileName: "handoff-app.procore.com",
      cdpUrl: "wss://proxy/cdp",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://app.getboon.ai/api/v1/agent/browser_handoff/status?handoff_token=tok%20123",
    );
    expect(init.method).toBe("GET");
  });

  it("throws when the status field is missing or invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { status: "unknown" } }));

    await expect(
      pollBrowserHandoffStatus({
        baseUrl: "https://app.getboon.ai",
        apiKey: "test-key",
        handoffToken: "tok_123",
      }),
    ).rejects.toBeInstanceOf(BrowserHandoffApiError);
  });
});
