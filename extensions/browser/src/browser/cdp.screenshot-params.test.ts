// Browser tests cover cdp.screenshot params plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withCdpSocket } from "./cdp.helpers.js";
import { captureScreenshot } from "./cdp.js";
import type { ResolvedBrowserProfile } from "./config.js";
import { shouldUsePlaywrightForScreenshot } from "./profile-capabilities.js";
import { VIEWPORT_MEASURE_TIMEOUT_MS } from "./screenshot-viewport.js";

const sentMessages = vi.hoisted(() => {
  const msgs: Array<{ method: string; params?: Record<string, unknown> }> = [];
  return msgs;
});

// Tracks whether emulation has been cleared so post-clear Runtime.evaluate
// can return different values for the "emulated tab" vs "non-emulated tab" tests.
const mockState = vi.hoisted(() => ({
  emulationCleared: false,
  emulatedTab: true,
  viewport: { w: 800, h: 600, dpr: 2, sw: 800, sh: 600 } as Record<string, unknown>,
  naturalViewport: { w: 1920, h: 1080, dpr: 1 },
  measuredViewport: { width: 1300, height: 900 } as unknown,
  measureFails: false,
  measureHangs: false,
}));

const VIEWPORT_MEASURE_EXPRESSION = "({ width: window.innerWidth, height: window.innerHeight })";

vi.mock("./cdp.helpers.js", () => ({
  withCdpSocket: vi.fn(
    async (
      _wsUrl: string,
      fn: (send: unknown) => Promise<unknown>,
      _opts?: { commandTimeoutMs?: number },
    ) => {
      const send = (method: string, params?: Record<string, unknown>) => {
        sentMessages.push({ method, params });
        if (method === "Page.captureScreenshot") {
          return Promise.resolve({ data: "AAAA" });
        }
        if (method === "Page.getLayoutMetrics") {
          return Promise.resolve({
            cssContentSize: { width: 1200, height: 3000 },
            contentSize: { width: 1200, height: 3000 },
          });
        }
        if (method === "Emulation.clearDeviceMetricsOverride") {
          mockState.emulationCleared = true;
          return Promise.resolve({});
        }
        if (method === "Emulation.setDeviceMetricsOverride") {
          mockState.emulationCleared = false;
          return Promise.resolve({});
        }
        if (method === "Runtime.evaluate") {
          if (params?.expression === VIEWPORT_MEASURE_EXPRESSION) {
            if (mockState.measureHangs) {
              return new Promise(() => {});
            }
            return mockState.measureFails
              ? Promise.reject(new Error("evaluate failed"))
              : Promise.resolve({ result: { value: mockState.measuredViewport } });
          }
          if (mockState.emulationCleared && mockState.emulatedTab) {
            return Promise.resolve({
              result: {
                value: mockState.naturalViewport,
              },
            });
          }
          return Promise.resolve({
            result: {
              value: mockState.viewport,
            },
          });
        }
        return Promise.resolve({});
      };
      return fn(send);
    },
  ),
  appendCdpPath: vi.fn(),
  fetchJson: vi.fn(),
  isLoopbackHost: vi.fn(),
  isWebSocketUrl: vi.fn(),
}));

vi.mock("./navigation-guard.js", () => ({
  assertBrowserNavigationAllowed: vi.fn(),
  withBrowserNavigationPolicy: vi.fn(() => ({})),
}));

const localProfile: ResolvedBrowserProfile = {
  name: "openclaw",
  cdpUrl: "http://127.0.0.1:18800",
  cdpPort: 18800,
  cdpHost: "127.0.0.1",
  cdpIsLoopback: true,
  color: "#FF4500",
  driver: "openclaw",
  headless: false,
  attachOnly: false,
};

beforeEach(() => {
  sentMessages.length = 0;
  mockState.emulationCleared = false;
  mockState.emulatedTab = true;
  mockState.viewport = { w: 800, h: 600, dpr: 2, sw: 800, sh: 600 };
  mockState.naturalViewport = { w: 1920, h: 1080, dpr: 1 };
  mockState.measuredViewport = { width: 1300, height: 900 };
  mockState.measureFails = false;
  mockState.measureHangs = false;
});

afterEach(() => {
  vi.useRealTimers();
});

function requireSentMessage(method: string) {
  const message = sentMessages.find((m) => m.method === method);
  if (!message) {
    throw new Error(`expected ${method} CDP message`);
  }
  return message;
}

describe("CDP screenshot params", () => {
  it("viewport screenshot omits fromSurface and captureBeyondViewport", async () => {
    await captureScreenshot({ wsUrl: "ws://localhost:9222/devtools/page/X", format: "png" });

    const call = requireSentMessage("Page.captureScreenshot");
    expect(call.params?.format).toBe("png");
    expect(call.params).not.toHaveProperty("fromSurface");
    expect(call.params).not.toHaveProperty("captureBeyondViewport");
    expect(call.params).not.toHaveProperty("clip");

    const emulationCalls = sentMessages.filter(
      (m) => m.method === "Emulation.setDeviceMetricsOverride",
    );
    expect(emulationCalls).toHaveLength(0);
  });

  it("uses the requested timeout as the raw CDP command timeout", async () => {
    await captureScreenshot({
      wsUrl: "ws://localhost:9222/devtools/page/X",
      format: "png",
      timeoutMs: 12_345,
    });

    const [wsUrl, sendCallback, options] =
      (withCdpSocket as unknown as { mock: { calls: Array<Array<unknown>> } }).mock.calls.at(-1) ??
      [];
    expect(wsUrl).toBe("ws://localhost:9222/devtools/page/X");
    expect(typeof sendCallback).toBe("function");
    expect(options).toEqual({ commandTimeoutMs: 12_345 });
  });

  it("fullPage on emulated tab: clears, detects drift, re-applies saved emulation", async () => {
    mockState.emulatedTab = true;

    await captureScreenshot({
      wsUrl: "ws://localhost:9222/devtools/page/X",
      format: "png",
      fullPage: true,
    });

    const setCalls = sentMessages.filter((m) => m.method === "Emulation.setDeviceMetricsOverride");
    expect(setCalls.length).toBe(2);
    const [firstSetCall, secondSetCall] = setCalls;
    if (!firstSetCall || !secondSetCall) {
      throw new Error("expected two viewport updates");
    }

    // Expand: uses saved DPR, mobile defaults to false
    expect(firstSetCall.params?.width).toBe(1200);
    expect(firstSetCall.params?.height).toBe(3000);
    expect(firstSetCall.params?.deviceScaleFactor).toBe(2);
    expect(firstSetCall.params?.mobile).toBe(false);

    // Clear is called first in the finally block
    requireSentMessage("Emulation.clearDeviceMetricsOverride");
    const captureCall = requireSentMessage("Page.captureScreenshot");
    expect(captureCall.params?.captureBeyondViewport).toBe(true);

    // Viewport drifted after clear → re-apply saved dimensions
    expect(secondSetCall.params?.width).toBe(800);
    expect(secondSetCall.params?.height).toBe(600);
    expect(secondSetCall.params?.deviceScaleFactor).toBe(2);
    expect(secondSetCall.params?.mobile).toBe(false);
    expect(secondSetCall.params?.screenWidth).toBe(800);
    expect(secondSetCall.params?.screenHeight).toBe(600);
  });

  it("fullPage on non-emulated tab: clears and does NOT re-apply emulation", async () => {
    mockState.emulatedTab = false;
    mockState.viewport = { w: 1920, h: 1080, dpr: 1, sw: 1920, sh: 1080 };
    mockState.naturalViewport = { w: 1920, h: 1080, dpr: 1 };

    await captureScreenshot({
      wsUrl: "ws://localhost:9222/devtools/page/X",
      format: "png",
      fullPage: true,
    });

    const setCalls = sentMessages.filter((m) => m.method === "Emulation.setDeviceMetricsOverride");
    // Only the expand call — no re-apply after clear
    expect(setCalls).toHaveLength(1);

    requireSentMessage("Emulation.clearDeviceMetricsOverride");
  });

  it("fullPage viewport dimensions never shrink below current innerWidth/Height", async () => {
    await captureScreenshot({ wsUrl: "ws://localhost:9222/devtools/page/X", fullPage: true });

    const expandCall = requireSentMessage("Emulation.setDeviceMetricsOverride");
    expect(Number(expandCall.params?.width)).toBeGreaterThanOrEqual(800);
    expect(Number(expandCall.params?.height)).toBeGreaterThanOrEqual(600);
  });
});

describe("CDP screenshot viewport measurement", () => {
  const wsUrl = "ws://localhost:9222/devtools/page/X";

  function viewportMeasureCalls() {
    return sentMessages.filter(
      (m) =>
        m.method === "Runtime.evaluate" && m.params?.expression === VIEWPORT_MEASURE_EXPRESSION,
    );
  }

  it("measures the viewport after the capture on the same socket", async () => {
    const socketCallsBefore = vi.mocked(withCdpSocket).mock.calls.length;

    const result = await captureScreenshot({ wsUrl, format: "png" });

    expect(result.buffer).toEqual(Buffer.from("AAAA", "base64"));
    expect(result.viewport).toEqual({ width: 1300, height: 900 });
    expect(vi.mocked(withCdpSocket).mock.calls.length - socketCallsBefore).toBe(1);
    const captureIndex = sentMessages.findIndex((m) => m.method === "Page.captureScreenshot");
    const measureIndex = sentMessages.findIndex(
      (m) =>
        m.method === "Runtime.evaluate" && m.params?.expression === VIEWPORT_MEASURE_EXPRESSION,
    );
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(measureIndex).toBeGreaterThan(captureIndex);
    expect(sentMessages[measureIndex]?.params?.returnByValue).toBe(true);
  });

  it("does not measure the viewport for fullPage captures", async () => {
    const result = await captureScreenshot({ wsUrl, fullPage: true });

    expect(result.buffer).toEqual(Buffer.from("AAAA", "base64"));
    expect(result).not.toHaveProperty("viewport");
    expect(viewportMeasureCalls()).toHaveLength(0);
  });

  it("returns the screenshot without viewport when the measurement fails", async () => {
    mockState.measureFails = true;

    const result = await captureScreenshot({ wsUrl });

    expect(result.buffer).toEqual(Buffer.from("AAAA", "base64"));
    expect(result).not.toHaveProperty("viewport");
  });

  it("returns the screenshot without viewport when the measurement is invalid", async () => {
    mockState.measuredViewport = { width: 0, height: "900" };

    const result = await captureScreenshot({ wsUrl });

    expect(result.buffer).toEqual(Buffer.from("AAAA", "base64"));
    expect(result).not.toHaveProperty("viewport");
  });

  it("returns the screenshot without viewport when the measurement hangs", async () => {
    vi.useFakeTimers();
    mockState.measureHangs = true;

    const capture = captureScreenshot({ wsUrl });
    await vi.advanceTimersByTimeAsync(VIEWPORT_MEASURE_TIMEOUT_MS);
    const result = await capture;

    expect(result.buffer).toEqual(Buffer.from("AAAA", "base64"));
    expect(result).not.toHaveProperty("viewport");
  });
});

describe("shouldUsePlaywrightForScreenshot routing", () => {
  it("returns false for a normal viewport screenshot with wsUrl", () => {
    expect(shouldUsePlaywrightForScreenshot({ profile: localProfile, wsUrl: "ws://x" })).toBe(
      false,
    );
  });

  it("returns true when wsUrl is missing", () => {
    expect(shouldUsePlaywrightForScreenshot({ profile: localProfile })).toBe(true);
  });

  it("returns true when ref is specified", () => {
    expect(
      shouldUsePlaywrightForScreenshot({ profile: localProfile, wsUrl: "ws://x", ref: "btn-1" }),
    ).toBe(true);
  });

  it("returns true when element is specified", () => {
    expect(
      shouldUsePlaywrightForScreenshot({
        profile: localProfile,
        wsUrl: "ws://x",
        element: "#submit",
      }),
    ).toBe(true);
  });
});
