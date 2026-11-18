// Browser tests cover the screenshot image-to-viewport scale note.
import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import { describe, expect, it, vi } from "vitest";
import { addScreenshotScaleNote, formatScreenshotScaleNote } from "./screenshot-scale-note.js";

const SCALED_NOTE =
  "[Screenshot scale: this image is 1200x831 px; the page viewport is 1300x900 CSS px. act kind=clickCoords takes viewport CSS px, not image px. Convert: x = image_x * 1.0833, y = image_y * 1.0830 (example: image point 600,416 -> x=650, y=451). Prefer snapshot refs when the target has one.]";

const IMAGE_DATA = Buffer.from("image-bytes").toString("base64");

function screenshotResult(
  content: AgentToolResult<unknown>["content"] = [
    { type: "image", data: IMAGE_DATA, mimeType: "image/png" },
  ],
): AgentToolResult<unknown> {
  return { content, details: { path: "/tmp/shot.png" } };
}

describe("formatScreenshotScaleNote", () => {
  it("maps a shrunk image back to viewport CSS pixels", () => {
    expect(
      formatScreenshotScaleNote({
        image: { width: 1200, height: 831 },
        viewport: { width: 1300, height: 900 },
      }),
    ).toBe(SCALED_NOTE);
  });

  it("returns undefined when the image matches the viewport", () => {
    expect(
      formatScreenshotScaleNote({
        image: { width: 1300, height: 900 },
        viewport: { width: 1300, height: 900 },
      }),
    ).toBeUndefined();
  });

  it("handles device-pixel-ratio images larger than the viewport", () => {
    const note = formatScreenshotScaleNote({
      image: { width: 1000, height: 800 },
      viewport: { width: 500, height: 400 },
    });

    expect(note).toContain("this image is 1000x800 px; the page viewport is 500x400 CSS px.");
    expect(note).toContain("x = image_x * 0.5000, y = image_y * 0.5000");
    expect(note).toContain("(example: image point 500,400 -> x=250, y=200)");
  });
});

describe("addScreenshotScaleNote", () => {
  const viewport = { width: 1300, height: 900 };
  const readScaledSize = async () => ({ width: 1200, height: 831 });

  it("inserts the note before the image block", async () => {
    const readImageSize = vi.fn(readScaledSize);
    const result = screenshotResult();

    const next = await addScreenshotScaleNote(result, viewport, readImageSize);

    expect(next.content).toEqual([
      { type: "text", text: SCALED_NOTE },
      { type: "image", data: IMAGE_DATA, mimeType: "image/png" },
    ]);
    expect(next.details).toBe(result.details);
    expect(result.content).toHaveLength(1);
    expect(readImageSize).toHaveBeenCalledWith(Buffer.from(IMAGE_DATA, "base64"));
  });

  it("keeps existing text before the note", async () => {
    const result = screenshotResult([
      { type: "text", text: "[browser screenshot vision failed: boom]" },
      { type: "image", data: IMAGE_DATA, mimeType: "image/png" },
    ]);

    const next = await addScreenshotScaleNote(result, viewport, readScaledSize);

    expect(next.content).toEqual([
      { type: "text", text: "[browser screenshot vision failed: boom]" },
      { type: "text", text: SCALED_NOTE },
      { type: "image", data: IMAGE_DATA, mimeType: "image/png" },
    ]);
  });

  it("returns the result unchanged without a viewport", async () => {
    const readImageSize = vi.fn(readScaledSize);
    const result = screenshotResult();

    expect(await addScreenshotScaleNote(result, undefined, readImageSize)).toBe(result);
    expect(readImageSize).not.toHaveBeenCalled();
  });

  it("returns the result unchanged without an image block", async () => {
    const result = screenshotResult([
      { type: "text", text: "[browser:screenshot] omitted image payload" },
    ]);

    expect(await addScreenshotScaleNote(result, viewport, readScaledSize)).toBe(result);
  });

  it("returns the result unchanged when the image size cannot be read", async () => {
    const result = screenshotResult();

    expect(
      await addScreenshotScaleNote(result, viewport, async () => {
        throw new Error("probe failed");
      }),
    ).toBe(result);
    expect(await addScreenshotScaleNote(result, viewport, async () => null)).toBe(result);
    expect(await addScreenshotScaleNote(result, viewport, async () => ({ width: 1200 }))).toBe(
      result,
    );
  });

  it("returns the result unchanged when the image matches the viewport", async () => {
    const result = screenshotResult();

    expect(await addScreenshotScaleNote(result, viewport, async () => viewport)).toBe(result);
  });
});
