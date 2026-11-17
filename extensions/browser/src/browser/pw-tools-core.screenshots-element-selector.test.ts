// Browser tests cover pw tools core.screenshots element selector plugin behavior.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_UPLOAD_DIR } from "./paths.js";
import {
  getPwToolsCoreSessionMocks,
  installPwToolsCoreTestHooks,
  setPwToolsCoreCurrentPage,
  setPwToolsCoreCurrentRefLocator,
} from "./pw-tools-core.test-harness.js";
import { VIEWPORT_MEASURE_TIMEOUT_MS } from "./screenshot-viewport.js";

installPwToolsCoreTestHooks();
const sessionMocks = getPwToolsCoreSessionMocks();
const mod = await import("./pw-tools-core.js");

function createFileChooserPageMocks() {
  const fileChooser = { setFiles: vi.fn(async () => {}) };
  const press = vi.fn(async () => {});
  const waitForEvent = vi.fn(async () => fileChooser);
  setPwToolsCoreCurrentPage({
    waitForEvent,
    keyboard: { press },
  });
  return { fileChooser, press, waitForEvent };
}

describe("pw-tools-core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("screenshots an element selector", async () => {
    const elementScreenshot = vi.fn(async () => Buffer.from("E"));
    const page = {
      locator: vi.fn(() => ({
        first: () => ({ screenshot: elementScreenshot }),
      })),
      screenshot: vi.fn(async () => Buffer.from("P")),
    };
    setPwToolsCoreCurrentPage(page);

    const res = await mod.takeScreenshotViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      element: "#main",
      type: "png",
      timeoutMs: 1234,
    });

    expect(res.buffer.toString()).toBe("E");
    expect(sessionMocks.getPageForTargetId).toHaveBeenCalled();
    expect(page.locator as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("#main");
    expect(elementScreenshot).toHaveBeenCalledWith({ type: "png", timeout: 1234 });
  });
  it("screenshots a ref locator", async () => {
    const refScreenshot = vi.fn(async () => Buffer.from("R"));
    setPwToolsCoreCurrentRefLocator({ screenshot: refScreenshot });
    const page = {
      locator: vi.fn(),
      screenshot: vi.fn(async () => Buffer.from("P")),
    };
    setPwToolsCoreCurrentPage(page);

    const res = await mod.takeScreenshotViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      ref: "76",
      type: "jpeg",
      timeoutMs: 2345,
    });

    expect(res.buffer.toString()).toBe("R");
    expect(sessionMocks.refLocator).toHaveBeenCalledWith(page, "76");
    expect(refScreenshot).toHaveBeenCalledWith({ type: "jpeg", timeout: 2345 });
  });
  it("rejects fullPage for element or ref screenshots", async () => {
    setPwToolsCoreCurrentRefLocator({ screenshot: vi.fn(async () => Buffer.from("R")) });
    setPwToolsCoreCurrentPage({
      locator: vi.fn(() => ({
        first: () => ({ screenshot: vi.fn(async () => Buffer.from("E")) }),
      })),
      screenshot: vi.fn(async () => Buffer.from("P")),
    });

    await expect(
      mod.takeScreenshotViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        element: "#x",
        fullPage: true,
      }),
    ).rejects.toThrow(/fullPage is not supported/i);

    await expect(
      mod.takeScreenshotViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        ref: "1",
        fullPage: true,
      }),
    ).rejects.toThrow(/fullPage is not supported/i);
  });
  it("measures the viewport after a plain viewport screenshot", async () => {
    const screenshot = vi.fn(async () => Buffer.from("P"));
    const evaluate = vi.fn(async () => ({ width: 1300, height: 900 }));
    setPwToolsCoreCurrentPage({ screenshot, evaluate });

    const res = await mod.takeScreenshotViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      type: "png",
    });

    expect(res.buffer.toString()).toBe("P");
    expect(res.viewport).toEqual({ width: 1300, height: 900 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.invocationCallOrder[0]).toBeGreaterThan(
      screenshot.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
  it("returns the plain screenshot without viewport when the measurement fails", async () => {
    setPwToolsCoreCurrentPage({
      screenshot: vi.fn(async () => Buffer.from("P")),
      evaluate: vi.fn(async () => {
        throw new Error("evaluate failed");
      }),
    });

    const res = await mod.takeScreenshotViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
    });

    expect(res.buffer.toString()).toBe("P");
    expect(res).not.toHaveProperty("viewport");
  });
  it("returns the plain screenshot without viewport when the measurement hangs", async () => {
    vi.useFakeTimers();
    try {
      setPwToolsCoreCurrentPage({
        screenshot: vi.fn(async () => Buffer.from("P")),
        evaluate: vi.fn(() => new Promise(() => {})),
      });

      const capture = mod.takeScreenshotViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
      });
      await vi.advanceTimersByTimeAsync(VIEWPORT_MEASURE_TIMEOUT_MS);
      const res = await capture;

      expect(res.buffer.toString()).toBe("P");
      expect(res).not.toHaveProperty("viewport");
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not measure the viewport for fullPage, ref, or element screenshots", async () => {
    const evaluate = vi.fn(async () => ({ width: 1300, height: 900 }));
    setPwToolsCoreCurrentRefLocator({ screenshot: vi.fn(async () => Buffer.from("R")) });
    setPwToolsCoreCurrentPage({
      evaluate,
      locator: vi.fn(() => ({
        first: () => ({ screenshot: vi.fn(async () => Buffer.from("E")) }),
      })),
      screenshot: vi.fn(async () => Buffer.from("P")),
    });
    const base = { cdpUrl: "http://127.0.0.1:18792", targetId: "T1" };

    const results = [
      await mod.takeScreenshotViaPlaywright({ ...base, fullPage: true }),
      await mod.takeScreenshotViaPlaywright({ ...base, ref: "76" }),
      await mod.takeScreenshotViaPlaywright({ ...base, element: "#main" }),
    ];

    for (const res of results) {
      expect(res).not.toHaveProperty("viewport");
    }
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("arms the next file chooser and sets files (default timeout)", async () => {
    const uploadPath = path.join(DEFAULT_UPLOAD_DIR, `vitest-upload-${crypto.randomUUID()}.txt`);
    await fs.mkdir(path.dirname(uploadPath), { recursive: true });
    await fs.writeFile(uploadPath, "fixture", "utf8");
    const canonicalUploadPath = await fs.realpath(uploadPath);
    const fileChooser = { setFiles: vi.fn(async () => {}) };
    const waitForEvent = vi.fn(async (_eventValue: string, _opts: unknown) => fileChooser);
    setPwToolsCoreCurrentPage({
      waitForEvent,
      keyboard: { press: vi.fn(async () => {}) },
    });

    try {
      await mod.armFileUploadViaPlaywright({
        cdpUrl: "http://127.0.0.1:18792",
        targetId: "T1",
        paths: [uploadPath],
      });

      // waitForEvent is awaited immediately; handler continues async.
      await Promise.resolve();

      expect(waitForEvent).toHaveBeenCalledWith("filechooser", {
        timeout: 120_000,
      });
      await vi.waitFor(() => {
        expect(fileChooser.setFiles).toHaveBeenCalledWith([canonicalUploadPath]);
      });
    } finally {
      await fs.rm(uploadPath, { force: true });
    }
  });
  it("revalidates file-chooser paths at use-time and cancels missing files", async () => {
    const missingPath = path.join(DEFAULT_UPLOAD_DIR, `vitest-missing-${crypto.randomUUID()}.txt`);
    const { fileChooser, press } = createFileChooserPageMocks();

    await mod.armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      targetId: "T1",
      paths: [missingPath],
    });
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(press).toHaveBeenCalledWith("Escape");
    });
    expect(fileChooser.setFiles).not.toHaveBeenCalled();
  });
  it("arms the next file chooser and escapes if no paths provided", async () => {
    const { fileChooser, press } = createFileChooserPageMocks();

    await mod.armFileUploadViaPlaywright({
      cdpUrl: "http://127.0.0.1:18792",
      paths: [],
    });
    await Promise.resolve();

    expect(fileChooser.setFiles).not.toHaveBeenCalled();
    expect(press).toHaveBeenCalledWith("Escape");
  });
});
