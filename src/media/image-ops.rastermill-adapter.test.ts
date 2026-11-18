// Raster image adapter tests cover image operation integration with RasterMill.
import { afterEach, describe, expect, it, vi } from "vitest";

describe("image ops Rastermill adapter", () => {
  afterEach(() => {
    vi.doUnmock("rastermill");
    vi.doUnmock("@silvia-odwyer/photon-node");
    vi.doUnmock("../infra/resolve-system-bin.js");
    vi.resetModules();
  });

  it("does not load Photon for Rastermill-backed operations", async () => {
    const encode = vi.fn(async () => ({ data: Buffer.from("jpeg") }));
    const photonModuleFactory = vi.fn(() => {
      throw new Error("Photon loaded eagerly");
    });

    vi.doMock("@silvia-odwyer/photon-node", photonModuleFactory);
    vi.doMock("rastermill", () => ({
      RastermillUnavailableError: class RastermillUnavailableError extends Error {
        causes = [];
      },
      createRastermill: vi.fn(() => ({ encode })),
      isRastermillUnavailableError: () => false,
      readImageMetadataFromHeader: vi.fn(() => ({ width: 1, height: 1 })),
      readImageProbeFromHeader: vi.fn(() => ({ width: 1, height: 1, format: "jpeg" })),
    }));

    const { resizeToJpeg } = await import("./image-ops.js");

    await expect(
      resizeToJpeg({ buffer: Buffer.from("input"), maxSide: 1, quality: 80 }),
    ).resolves.toEqual(Buffer.from("jpeg"));
    expect(photonModuleFactory).not.toHaveBeenCalled();
  });

  it("configures Rastermill with OpenClaw limits, temp root, and command resolution", async () => {
    const encode = vi.fn(async () => ({ data: Buffer.from("jpeg") }));
    const createRastermill = vi.fn((_options: unknown) => ({ encode }));
    const resolveSystemBin = vi.fn(() => "/usr/bin/tool");

    vi.doMock("rastermill", () => ({
      RastermillUnavailableError: class RastermillUnavailableError extends Error {
        causes = [];
      },
      createRastermill,
      isRastermillUnavailableError: () => false,
      readImageMetadataFromHeader: vi.fn(() => ({ width: 1, height: 1 })),
      readImageProbeFromHeader: vi.fn(() => ({ width: 1, height: 1, format: "png" })),
    }));
    vi.doMock("../infra/resolve-system-bin.js", () => ({
      resolveSystemBin,
    }));

    const { resizeToJpeg, MAX_IMAGE_INPUT_PIXELS, MAX_IMAGE_DECODE_PIXELS } =
      await import("./image-ops.js");

    await expect(
      resizeToJpeg({ buffer: Buffer.from("input"), maxSide: 1, quality: 80 }),
    ).resolves.toEqual(Buffer.from("jpeg"));

    // Input (decode) and output (final-image) budgets must stay distinct: a
    // shared value re-blocks downscaling any source image larger than the
    // output cap, since Rastermill rejects over-budget input before any
    // resize ever runs.
    expect(MAX_IMAGE_DECODE_PIXELS).toBeGreaterThan(MAX_IMAGE_INPUT_PIXELS);
    expect(createRastermill).toHaveBeenCalledWith({
      execution: "auto",
      limits: {
        inputPixels: MAX_IMAGE_DECODE_PIXELS,
        outputPixels: MAX_IMAGE_INPUT_PIXELS,
      },
      temp: expect.objectContaining({
        prefix: "openclaw-img-",
      }),
      commandResolver: expect.any(Function),
    });
    const options = createRastermill.mock.calls[0]?.[0] as {
      commandResolver: (command: string) => string | null;
      env?: unknown;
    };
    expect(options.env).toBeUndefined();
    expect(options.commandResolver("powershell")).toBe("/usr/bin/tool");
    expect(resolveSystemBin).toHaveBeenLastCalledWith("powershell", { trust: "strict" });
  });

  it("exposes Rastermill unavailable errors through the SDK alias", async () => {
    class RastermillUnavailableError extends Error {
      readonly causes = [new Error("missing backend")];
    }
    const createRastermill = vi.fn(() => ({
      encode: vi.fn(async () => {
        throw new RastermillUnavailableError("Image processor unavailable");
      }),
    }));

    vi.doMock("rastermill", () => ({
      RastermillUnavailableError,
      createRastermill,
      isRastermillUnavailableError: (error: unknown) => error instanceof RastermillUnavailableError,
      readImageMetadataFromHeader: vi.fn(() => ({ width: 1, height: 1 })),
      readImageProbeFromHeader: vi.fn(() => ({ width: 1, height: 1, format: "png" })),
    }));

    const { ImageProcessorUnavailableError, resizeToJpeg } = await import("./image-ops.js");

    await expect(
      resizeToJpeg({ buffer: Buffer.from("input"), maxSide: 1, quality: 80 }),
    ).rejects.toBeInstanceOf(ImageProcessorUnavailableError);
  });

  it("returns oriented bytes when EXIF metadata probe is unavailable but encode succeeds", async () => {
    const encoded = Buffer.from("oriented");
    const encode = vi.fn(async () => ({ data: encoded }));
    const probe = vi.fn(async () => null);

    vi.doMock("rastermill", () => ({
      RastermillUnavailableError: class RastermillUnavailableError extends Error {
        causes = [];
      },
      createRastermill: vi.fn(() => ({ encode, probe })),
      isRastermillUnavailableError: () => false,
      readImageMetadataFromHeader: vi.fn(() => ({ width: 1, height: 1 })),
      readImageProbeFromHeader: vi.fn(() => ({ width: 1, height: 1, format: "jpeg" })),
    }));

    const { normalizeExifOrientation } = await import("./image-ops.js");

    await expect(normalizeExifOrientation(Buffer.from("input"))).resolves.toEqual(encoded);
    expect(encode).toHaveBeenCalledWith(Buffer.from("input"), {
      format: "jpeg",
      autoOrient: true,
    });
  });

  it("recognizes a Rastermill input-too-large error as a decode-size failure", async () => {
    class RastermillError extends Error {
      readonly code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    }
    vi.doMock("rastermill", () => ({
      RastermillError,
      RastermillUnavailableError: class RastermillUnavailableError extends Error {
        causes = [];
      },
      createRastermill: vi.fn(() => ({ encode: vi.fn() })),
      isRastermillUnavailableError: () => false,
      readImageMetadataFromHeader: vi.fn(),
      readImageProbeFromHeader: vi.fn(),
    }));

    const { isImageTooLargeToDecodeError } = await import("./image-ops.js");

    // A source too large even for the raised MAX_IMAGE_DECODE_PIXELS ceiling.
    // Callers that load media directly (src/agents/tools/image-tool.ts) use
    // this to return a clear message instead of letting the raw dependency
    // error escape.
    const tooLarge = new RastermillError(
      "RASTERMILL_INPUT_TOO_LARGE",
      "Image dimensions exceed the 100,000,000 pixel input limit: 20000x20000 (400000000 pixels)",
    );
    expect(isImageTooLargeToDecodeError(tooLarge)).toBe(true);
    // A different Rastermill error code is not a size failure.
    expect(isImageTooLargeToDecodeError(new RastermillError("RASTERMILL_UNDECODABLE", "nope"))).toBe(
      false,
    );
    expect(isImageTooLargeToDecodeError(new Error("unrelated"))).toBe(false);
  });

  it("leaves EXIF normalization best-effort when Rastermill is unavailable", async () => {
    class RastermillUnavailableError extends Error {
      readonly causes = [new Error("missing backend")];
    }
    const source = Buffer.from("input");
    const encode = vi.fn(async () => {
      throw new RastermillUnavailableError("Image processor unavailable");
    });
    const probe = vi.fn(async () => ({ width: 1, height: 1, orientation: 6 }));

    vi.doMock("rastermill", () => ({
      RastermillUnavailableError,
      createRastermill: vi.fn(() => ({ encode, probe })),
      isRastermillUnavailableError: (error: unknown) => error instanceof RastermillUnavailableError,
      readImageMetadataFromHeader: vi.fn(() => ({ width: 1, height: 1 })),
      readImageProbeFromHeader: vi.fn(() => ({ width: 1, height: 1, format: "jpeg" })),
    }));

    const { normalizeExifOrientation } = await import("./image-ops.js");

    await expect(normalizeExifOrientation(source)).resolves.toBe(source);
  });
});
