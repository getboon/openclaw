import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type { BrowserViewportSize } from "./screenshot-viewport.js";

type ImageSize = { width: number; height: number };

/** Builds the model-facing note that maps screenshot image pixels to viewport CSS pixels. */
export function formatScreenshotScaleNote(params: {
  image: ImageSize;
  viewport: BrowserViewportSize;
}): string | undefined {
  const { image, viewport } = params;
  if (image.width === viewport.width && image.height === viewport.height) {
    return undefined;
  }
  const sx = viewport.width / image.width;
  const sy = viewport.height / image.height;
  const ix = Math.round(image.width / 2);
  const iy = Math.round(image.height / 2);
  const cx = Math.round(ix * sx);
  const cy = Math.round(iy * sy);
  return `[Screenshot scale: this image is ${image.width}x${image.height} px; the page viewport is ${viewport.width}x${viewport.height} CSS px. act kind=clickCoords takes viewport CSS px, not image px. Convert: x = image_x * ${sx.toFixed(4)}, y = image_y * ${sy.toFixed(4)} (example: image point ${ix},${iy} -> x=${cx}, y=${cy}). Prefer snapshot refs when the target has one.]`;
}

async function readImageBlockSize(
  data: string,
  readImageSize: (buffer: Buffer) => Promise<{ width?: number; height?: number } | null>,
): Promise<ImageSize | undefined> {
  try {
    const size = await readImageSize(Buffer.from(data, "base64"));
    return size?.width && size.height ? { width: size.width, height: size.height } : undefined;
  } catch {
    return undefined;
  }
}

/** Inserts the scale note before the first image block of a screenshot tool result. */
export async function addScreenshotScaleNote<T extends AgentToolResult<unknown>>(
  result: T,
  viewport: BrowserViewportSize | undefined,
  readImageSize: (buffer: Buffer) => Promise<{ width?: number; height?: number } | null>,
): Promise<T> {
  if (!viewport) {
    return result;
  }
  const imageIndex = result.content.findIndex(
    (block) => block.type === "image" && typeof block.data === "string",
  );
  if (imageIndex < 0) {
    return result;
  }
  const imageBlock = result.content[imageIndex];
  if (imageBlock?.type !== "image") {
    return result;
  }
  const image = await readImageBlockSize(imageBlock.data, readImageSize);
  const note = image ? formatScreenshotScaleNote({ image, viewport }) : undefined;
  if (!note) {
    return result;
  }
  return {
    ...result,
    content: [
      ...result.content.slice(0, imageIndex),
      { type: "text", text: note },
      ...result.content.slice(imageIndex),
    ],
  };
}
