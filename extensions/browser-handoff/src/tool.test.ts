// Browser Login Handoff tool orchestration tests.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenKeyedStoreOptions } from "openclaw/plugin-sdk/plugin-state-runtime";
import {
  createPluginStateKeyedStoreForTests,
  resetPluginStateStoreForTests,
} from "openclaw/plugin-sdk/plugin-state-test-runtime";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestBrowserLoginHandoffMock = vi.hoisted(() => vi.fn());
const pollBrowserHandoffStatusMock = vi.hoisted(() => vi.fn());
const registerRemoteCdpBrowserProfileMock = vi.hoisted(() => vi.fn());

vi.mock("./boon-core-client.js", () => ({
  requestBrowserLoginHandoff: requestBrowserLoginHandoffMock,
  pollBrowserHandoffStatus: pollBrowserHandoffStatusMock,
  requireBoonApiKey: () => "test-key",
}));

vi.mock("openclaw/plugin-sdk/browser-profile-config", () => ({
  registerRemoteCdpBrowserProfile: registerRemoteCdpBrowserProfileMock,
}));

import { executeBrowserHandoffTool, executeBrowserHandoffToolFromArgs } from "./tool.js";

describe("browser-handoff tool", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    resetPluginStateStoreForTests();
    vi.clearAllMocks();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-handoff-"));
    env = { ...process.env, OPENCLAW_STATE_DIR: stateDir };
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  function openStore<T>(options: OpenKeyedStoreOptions) {
    return createPluginStateKeyedStoreForTests<T>("browser-handoff", {
      ...options,
      env: options.env ?? env,
    });
  }

  function createApi() {
    return createTestPluginApi({
      pluginConfig: { boonCoreBaseUrl: "https://app.getboon.ai" },
      runtime: {
        state: { openKeyedStore: openStore },
      } as never,
    });
  }

  it("request_login mints a handoff and persists pending state", async () => {
    requestBrowserLoginHandoffMock.mockResolvedValue({
      handoffToken: "tok_123",
      liveViewUrl: "https://live.example/view",
    });

    const result = await executeBrowserHandoffTool(createApi(), {
      action: "request_login",
      site: "App.Procore.com",
      reason: "captcha",
    });

    expect(result.content[0].text).toContain("https://live.example/view");
    expect(requestBrowserLoginHandoffMock).toHaveBeenCalledWith(
      expect.objectContaining({ site: "App.Procore.com", reason: "captcha" }),
    );
  });

  it("status reports pending, then ready once boon-core confirms", async () => {
    requestBrowserLoginHandoffMock.mockResolvedValue({
      handoffToken: "tok_123",
      liveViewUrl: "https://live.example/view",
    });
    const api = createApi();
    await executeBrowserHandoffTool(api, { action: "request_login", site: "example.com" });

    pollBrowserHandoffStatusMock.mockResolvedValue({ status: "pending" });
    const pendingResult = await executeBrowserHandoffTool(api, {
      action: "status",
      site: "example.com",
    });
    expect(pendingResult.content[0].text).toContain("Still waiting");

    pollBrowserHandoffStatusMock.mockResolvedValue({
      status: "ready",
      profileName: "handoff-example.com",
    });
    const readyResult = await executeBrowserHandoffTool(api, {
      action: "status",
      site: "example.com",
    });
    expect(readyResult.content[0].text).toContain("finished signing in");
  });

  it("status with no prior request_login tells the caller to start one", async () => {
    const result = await executeBrowserHandoffTool(createApi(), {
      action: "status",
      site: "never-requested.com",
    });
    expect(result.content[0].text).toContain("request_login first");
  });

  it("attach registers the browser profile and clears handoff state", async () => {
    requestBrowserLoginHandoffMock.mockResolvedValue({
      handoffToken: "tok_123",
      liveViewUrl: "https://live.example/view",
    });
    const api = createApi();
    await executeBrowserHandoffTool(api, { action: "request_login", site: "example.com" });

    pollBrowserHandoffStatusMock.mockResolvedValue({
      status: "ready",
      profileName: "handoff-example.com",
    });
    await executeBrowserHandoffTool(api, { action: "status", site: "example.com" });

    pollBrowserHandoffStatusMock.mockResolvedValue({
      status: "ready",
      profileName: "handoff-example.com",
      cdpUrl: "wss://proxy/cdp",
    });
    registerRemoteCdpBrowserProfileMock.mockResolvedValue({
      ok: true,
      name: "handoff-example.com",
    });

    const attachResult = await executeBrowserHandoffTool(api, {
      action: "attach",
      site: "example.com",
    });
    expect(attachResult.content[0].text).toContain('profile="handoff-example.com"');
    expect(registerRemoteCdpBrowserProfileMock).toHaveBeenCalledWith({
      name: "handoff-example.com",
      cdpUrl: "wss://proxy/cdp",
    });

    const secondAttach = await executeBrowserHandoffTool(api, {
      action: "attach",
      site: "example.com",
    });
    expect(secondAttach.content[0].text).toContain("No completed login handoff found");
  });

  it("surfaces boon-core errors without throwing", async () => {
    requestBrowserLoginHandoffMock.mockRejectedValue(new Error("boon-core unreachable"));
    const result = await executeBrowserHandoffTool(createApi(), {
      action: "request_login",
      site: "example.com",
    });
    expect(result.content[0].text).toContain("browser-handoff error");
    expect(result.content[0].text).toContain("boon-core unreachable");
  });
});

describe("executeBrowserHandoffToolFromArgs", () => {
  beforeEach(() => {
    resetPluginStateStoreForTests();
    vi.clearAllMocks();
  });

  it("returns the same error-text format as a handler failure instead of throwing", async () => {
    const result = await executeBrowserHandoffToolFromArgs(createTestPluginApi({}), {
      action: "not-a-real-action",
      site: "example.com",
    });
    expect(result.content[0].text).toContain("browser-handoff error");
    expect(result.content[0].text).toContain("action must be one of");
  });

  it("rejects a missing site the same way", async () => {
    const result = await executeBrowserHandoffToolFromArgs(createTestPluginApi({}), {
      action: "status",
    });
    expect(result.content[0].text).toContain("browser-handoff error");
    expect(result.content[0].text).toContain("site is required");
  });
});
