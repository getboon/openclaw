// Input file HEIC conversion tests cover the pre-decode pixel guard.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const detectMimeMock = vi.fn();
const convertHeicToJpegMock = vi.fn();
const readImageMetadataFromHeaderMock = vi.fn();

vi.mock("@openclaw/media-core/mime", () => ({
  detectMime: (...args: unknown[]) => detectMimeMock(...args),
}));

vi.mock("./media-services.js", () => ({
  convertHeicToJpeg: (...args: unknown[]) => convertHeicToJpegMock(...args),
  MAX_IMAGE_INPUT_PIXELS: 25_000_000,
  readImageMetadataFromHeader: (...args: unknown[]) => readImageMetadataFromHeaderMock(...args),
}));

let extractImageContentFromSource: typeof import("./input-files.js").extractImageContentFromSource;

beforeAll(async () => {
  ({ extractImageContentFromSource } = await import("./input-files.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  detectMimeMock.mockResolvedValue("image/heic");
});

function limits() {
  return {
    allowUrl: false,
    allowedMimes: new Set(["image/heic", "image/heif"]),
    maxBytes: 10 * 1024 * 1024,
    maxRedirects: 0,
    timeoutMs: 1,
  };
}

describe("extractImageContentFromSource HEIC pixel guard", () => {
  it("rejects an oversized HEIC source without decoding it", async () => {
    readImageMetadataFromHeaderMock.mockReturnValueOnce({ width: 9000, height: 6000 });

    await expect(
      extractImageContentFromSource(
        { type: "base64", data: Buffer.from("heic-bytes").toString("base64"), mediaType: "image/heic" },
        limits(),
      ),
    ).rejects.toThrow("Image dimensions exceed the 25,000,000 pixel limit: 9000x6000");

    expect(convertHeicToJpegMock).not.toHaveBeenCalled();
  });

  it("still converts a HEIC source within the pixel limit", async () => {
    readImageMetadataFromHeaderMock.mockReturnValueOnce({ width: 3000, height: 2000 });
    convertHeicToJpegMock.mockResolvedValueOnce(Buffer.from("jpeg-bytes"));

    const result = await extractImageContentFromSource(
      { type: "base64", data: Buffer.from("heic-bytes").toString("base64"), mediaType: "image/heic" },
      limits(),
    );

    expect(convertHeicToJpegMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      type: "image",
      data: Buffer.from("jpeg-bytes").toString("base64"),
      mimeType: "image/jpeg",
    });
  });

  it("still converts a HEIC source when header metadata is unavailable", async () => {
    readImageMetadataFromHeaderMock.mockReturnValueOnce(null);
    convertHeicToJpegMock.mockResolvedValueOnce(Buffer.from("jpeg-bytes"));

    await extractImageContentFromSource(
      { type: "base64", data: Buffer.from("heic-bytes").toString("base64"), mediaType: "image/heic" },
      limits(),
    );

    expect(convertHeicToJpegMock).toHaveBeenCalledTimes(1);
  });
});
