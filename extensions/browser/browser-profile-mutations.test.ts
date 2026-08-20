// Browser Profile Mutations facade tests.
import { beforeEach, describe, expect, it, vi } from "vitest";

const createBrowserProfileConfigMock = vi.hoisted(() => vi.fn());
const deleteBrowserProfileConfigMock = vi.hoisted(() => vi.fn());

vi.mock("./src/browser/config-mutations.js", () => ({
  createBrowserProfileConfig: createBrowserProfileConfigMock,
  deleteBrowserProfileConfig: deleteBrowserProfileConfigMock,
}));

import {
  registerRemoteCdpBrowserProfile,
  unregisterRemoteCdpBrowserProfile,
} from "./browser-profile-mutations.js";

describe("registerRemoteCdpBrowserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a malformed cdpUrl before touching config", async () => {
    const result = await registerRemoteCdpBrowserProfile({
      name: "handoff-example.com",
      cdpUrl: "wss://example.com:0",
    });
    expect(result.ok).toBe(false);
    expect(deleteBrowserProfileConfigMock).not.toHaveBeenCalled();
    expect(createBrowserProfileConfigMock).not.toHaveBeenCalled();
  });

  it("replaces atomically (replaceExisting: true) instead of deleting first, to support replace-on-reattach", async () => {
    createBrowserProfileConfigMock.mockResolvedValue({ cdpUrl: "wss://proxy.example/cdp" });

    const result = await registerRemoteCdpBrowserProfile({
      name: "handoff-example.com",
      cdpUrl: "wss://proxy.example/cdp",
    });

    expect(result).toStrictEqual({ ok: true, name: "handoff-example.com" });
    expect(deleteBrowserProfileConfigMock).not.toHaveBeenCalled();
    expect(createBrowserProfileConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "handoff-example.com", replaceExisting: true }),
    );
  });

  it("leaves the existing profile untouched when the replacement mutation fails", async () => {
    createBrowserProfileConfigMock.mockRejectedValue(new Error("boom"));

    const result = await registerRemoteCdpBrowserProfile({
      name: "handoff-example.com",
      cdpUrl: "wss://proxy.example/cdp",
    });

    expect(result).toStrictEqual({ ok: false, error: "boom" });
    // No compensating delete on failure: createBrowserProfileConfig's own
    // mutateConfigFile call never wrote anything, so nothing needs undoing.
    expect(deleteBrowserProfileConfigMock).not.toHaveBeenCalled();
  });
});

describe("unregisterRemoteCdpBrowserProfile", () => {
  it("delegates to deleteBrowserProfileConfig", async () => {
    await unregisterRemoteCdpBrowserProfile("handoff-example.com");
    expect(deleteBrowserProfileConfigMock).toHaveBeenCalledWith("handoff-example.com");
  });
});
