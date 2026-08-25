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

  function createApi(overrides: Record<string, unknown> = {}) {
    return createTestPluginApi({
      pluginConfig: { boonCoreBaseUrl: "https://app.getboon.ai" },
      runtime: {
        state: { openKeyedStore: openStore },
      } as never,
      ...overrides,
    });
  }

  const sessionKey = "agent:main:slack:thread-1";

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

  describe("durable resume via scheduleSessionTurn", () => {
    it("request_login schedules a session turn to check status automatically", async () => {
      requestBrowserLoginHandoffMock.mockResolvedValue({
        handoffToken: "tok_123",
        liveViewUrl: "https://live.example/view",
      });
      const scheduleSessionTurn = vi.fn().mockResolvedValue({ id: "job_1" });

      await executeBrowserHandoffTool(
        createApi({ scheduleSessionTurn }),
        { action: "request_login", site: "example.com" },
        { sessionKey },
      );

      expect(scheduleSessionTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionKey,
          delayMs: 30_000,
          deleteAfterRun: true,
          tag: "handoff-example.com",
          deliveryMode: "none",
        }),
      );
      expect(scheduleSessionTurn.mock.calls[0][0].message).toContain("example.com");
    });

    it("does not attempt to schedule when no sessionKey is available", async () => {
      requestBrowserLoginHandoffMock.mockResolvedValue({
        handoffToken: "tok_123",
        liveViewUrl: "https://live.example/view",
      });
      const scheduleSessionTurn = vi.fn();

      await executeBrowserHandoffTool(createApi({ scheduleSessionTurn }), {
        action: "request_login",
        site: "example.com",
      });

      expect(scheduleSessionTurn).not.toHaveBeenCalled();
    });

    it("status reschedules another check, with a longer delay, when still pending", async () => {
      requestBrowserLoginHandoffMock.mockResolvedValue({
        handoffToken: "tok_123",
        liveViewUrl: "https://live.example/view",
      });
      const scheduleSessionTurn = vi.fn().mockResolvedValue({ id: "job_1" });
      const api = createApi({ scheduleSessionTurn });
      await executeBrowserHandoffTool(
        api,
        { action: "request_login", site: "example.com" },
        { sessionKey },
      );
      const firstDelayMs = scheduleSessionTurn.mock.calls[0][0].delayMs;

      pollBrowserHandoffStatusMock.mockResolvedValue({ status: "pending" });
      await executeBrowserHandoffTool(
        api,
        { action: "status", site: "example.com" },
        { sessionKey },
      );

      expect(scheduleSessionTurn).toHaveBeenCalledTimes(2);
      const secondDelayMs = scheduleSessionTurn.mock.calls[1][0].delayMs;
      expect(secondDelayMs).toBeGreaterThan(firstDelayMs);
      expect(scheduleSessionTurn.mock.calls[1][0].tag).toBe("handoff-example.com");
    });

    it("stops rescheduling and clears the handoff once the max wait has elapsed", async () => {
      vi.useFakeTimers();
      try {
        requestBrowserLoginHandoffMock.mockResolvedValue({
          handoffToken: "tok_123",
          liveViewUrl: "https://live.example/view",
        });
        const scheduleSessionTurn = vi.fn().mockResolvedValue({ id: "job_1" });
        const api = createApi({ scheduleSessionTurn });
        await executeBrowserHandoffTool(
          api,
          { action: "request_login", site: "example.com" },
          { sessionKey },
        );
        scheduleSessionTurn.mockClear();

        vi.advanceTimersByTime(31 * 60_000); // past the 30-minute max wait
        pollBrowserHandoffStatusMock.mockResolvedValue({ status: "pending" });
        const result = await executeBrowserHandoffTool(
          api,
          { action: "status", site: "example.com" },
          { sessionKey },
        );

        expect(result.content[0].text).toContain("may have expired");
        expect(scheduleSessionTurn).not.toHaveBeenCalled();

        const again = await executeBrowserHandoffTool(api, {
          action: "status",
          site: "example.com",
        });
        expect(again.content[0].text).toContain("request_login first");
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not reschedule and clears the schedule tag once the customer has signed in", async () => {
      requestBrowserLoginHandoffMock.mockResolvedValue({
        handoffToken: "tok_123",
        liveViewUrl: "https://live.example/view",
      });
      const scheduleSessionTurn = vi.fn().mockResolvedValue({ id: "job_1" });
      const unscheduleSessionTurnsByTag = vi.fn().mockResolvedValue({ removed: 1, failed: 0 });
      const api = createApi({ scheduleSessionTurn, unscheduleSessionTurnsByTag });
      await executeBrowserHandoffTool(
        api,
        { action: "request_login", site: "example.com" },
        { sessionKey },
      );
      scheduleSessionTurn.mockClear();

      pollBrowserHandoffStatusMock.mockResolvedValue({
        status: "ready",
        profileName: "handoff-example.com",
      });
      await executeBrowserHandoffTool(
        api,
        { action: "status", site: "example.com" },
        { sessionKey },
      );

      expect(scheduleSessionTurn).not.toHaveBeenCalled();
      expect(unscheduleSessionTurnsByTag).toHaveBeenCalledWith({
        sessionKey,
        tag: "handoff-example.com",
      });
    });

    it("does not reschedule and clears the schedule tag once the handoff fails", async () => {
      requestBrowserLoginHandoffMock.mockResolvedValue({
        handoffToken: "tok_123",
        liveViewUrl: "https://live.example/view",
      });
      const scheduleSessionTurn = vi.fn().mockResolvedValue({ id: "job_1" });
      const unscheduleSessionTurnsByTag = vi.fn().mockResolvedValue({ removed: 1, failed: 0 });
      const api = createApi({ scheduleSessionTurn, unscheduleSessionTurnsByTag });
      await executeBrowserHandoffTool(
        api,
        { action: "request_login", site: "example.com" },
        { sessionKey },
      );
      scheduleSessionTurn.mockClear();

      pollBrowserHandoffStatusMock.mockResolvedValue({ status: "failed" });
      await executeBrowserHandoffTool(
        api,
        { action: "status", site: "example.com" },
        { sessionKey },
      );

      expect(scheduleSessionTurn).not.toHaveBeenCalled();
      expect(unscheduleSessionTurnsByTag).toHaveBeenCalledWith({
        sessionKey,
        tag: "handoff-example.com",
      });
    });
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
