// Browser tests cover screenshot viewport validation.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureBrowserViewport,
  toBrowserViewportSize,
  VIEWPORT_MEASURE_TIMEOUT_MS,
} from "./screenshot-viewport.js";

describe("toBrowserViewportSize", () => {
  it("accepts positive finite width and height", () => {
    expect(toBrowserViewportSize({ width: 1300, height: 900 })).toEqual({
      width: 1300,
      height: 900,
    });
  });

  it("rounds fractional sides to integers", () => {
    expect(toBrowserViewportSize({ width: 1300.4, height: 899.6 })).toEqual({
      width: 1300,
      height: 900,
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 1300],
    ["string", "1300x900"],
    ["array", [1300, 900]],
    ["missing height", { width: 1300 }],
    ["NaN width", { width: Number.NaN, height: 900 }],
    ["Infinity height", { width: 1300, height: Number.POSITIVE_INFINITY }],
    ["zero width", { width: 0, height: 900 }],
    ["negative height", { width: 1300, height: -1 }],
    ["rounds below one", { width: 0.4, height: 900 }],
    ["string sides", { width: "1300", height: "900" }],
  ])("rejects %s", (_name, value) => {
    expect(toBrowserViewportSize(value)).toBeUndefined();
  });
});

describe("measureBrowserViewport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the validated viewport from the read", async () => {
    await expect(
      measureBrowserViewport(async () => ({ width: 1300.4, height: 900 })),
    ).resolves.toEqual({ width: 1300, height: 900 });
  });

  it("returns undefined for an invalid read value", async () => {
    await expect(
      measureBrowserViewport(async () => ({ width: 0, height: 900 })),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the read rejects", async () => {
    await expect(
      measureBrowserViewport(async () => {
        throw new Error("evaluate failed");
      }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined when the read hangs past the timeout", async () => {
    vi.useFakeTimers();
    const measured = measureBrowserViewport(() => new Promise<unknown>(() => {}));

    await vi.advanceTimersByTimeAsync(VIEWPORT_MEASURE_TIMEOUT_MS);

    await expect(measured).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer when the read settles first", async () => {
    vi.useFakeTimers();

    await expect(
      measureBrowserViewport(async () => ({ width: 1300, height: 900 })),
    ).resolves.toEqual({ width: 1300, height: 900 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
