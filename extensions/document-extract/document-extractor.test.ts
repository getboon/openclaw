// Document Extract tests cover document extractor plugin behavior.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { createEngineMock, openPdfMock, pdfDocument } = vi.hoisted(() => ({
  createEngineMock: vi.fn(),
  openPdfMock: vi.fn(),
  pdfDocument: {
    pageCount: 2,
    extract: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock("clawpdf", () => ({
  createEngine: createEngineMock,
}));

import { createPdfDocumentExtractor } from "./document-extractor.js";

function request(overrides = {}) {
  return {
    buffer: Buffer.from("%PDF-1.4"),
    mimeType: "application/pdf",
    maxPages: 2,
    maxPixels: 100,
    minTextChars: 10,
    ...overrides,
  };
}

describe("PDF document extractor", () => {
  afterAll(() => {
    vi.doUnmock("clawpdf");
    vi.resetModules();
  });

  beforeEach(() => {
    createEngineMock.mockResolvedValue({ open: openPdfMock });
    openPdfMock.mockReset();
    openPdfMock.mockResolvedValue(pdfDocument);
    pdfDocument.pageCount = 2;
    pdfDocument.extract.mockReset();
    pdfDocument.destroy.mockReset();
  });

  it("declares PDF support", () => {
    const extractor = createPdfDocumentExtractor();
    const { extract, ...descriptor } = extractor;
    expect(extract).toBeInstanceOf(Function);
    expect(descriptor).toEqual({
      id: "pdf",
      label: "PDF",
      mimeTypes: ["application/pdf"],
      autoDetectOrder: 10,
    });
  });

  it("hands the request buffer to clawpdf without copying it", async () => {
    // Buffer already is a Uint8Array; re-wrapping it would double peak memory on a
    // multi-hundred-megabyte set, which is the whole cost of opening one.
    pdfDocument.extract.mockResolvedValue({ text: "x".repeat(50), images: [] });
    const req = request();
    await createPdfDocumentExtractor().extract(req);
    const [input] = openPdfMock.mock.calls[0] as [Uint8Array];
    expect(input).toBe(req.buffer);
  });

  it("extracts text first and renders fallback images through clawpdf", async () => {
    pdfDocument.extract.mockResolvedValueOnce({ text: "", images: [] }).mockResolvedValueOnce({
      text: "",
      images: [
        {
          type: "image",
          bytes: Uint8Array.from(Buffer.from("png")),
          mimeType: "image/png",
          page: 1,
          width: 10,
          height: 10,
        },
      ],
    });
    const extractor = createPdfDocumentExtractor();

    const result = await extractor.extract(request());

    if (!result) {
      throw new Error("Expected PDF extraction result");
    }
    expect(openPdfMock).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(pdfDocument.extract).toHaveBeenNthCalledWith(1, {
      mode: "text",
      maxPages: 2,
      maxTextChars: 200_000,
    });
    expect(pdfDocument.extract).toHaveBeenNthCalledWith(2, {
      mode: "images",
      maxPages: 2,
      image: {
        maxDimension: 10_000,
        maxPixels: 100,
        forms: true,
      },
    });
    expect(result).toEqual({
      text: "",
      images: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
      coverage: {
        documentPageCount: 2,
        requestedPages: [1, 2],
        pagesProcessed: [1, 2],
        complete: true,
        textChars: 0,
        textBytes: 0,
        maxTextChars: 200_000,
        truncationReasons: [],
      },
    });
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
  });

  it("skips image fallback when enough text is extracted", async () => {
    pdfDocument.extract.mockResolvedValueOnce({
      text: "enough text",
      images: [],
      pagesProcessed: [1, 2],
      truncated: { text: false, images: false },
    });
    const extractor = createPdfDocumentExtractor();

    const result = await extractor.extract(request({ minTextChars: 5 }));

    expect(result).toEqual({
      text: "enough text",
      images: [],
      coverage: {
        documentPageCount: 2,
        requestedPages: [1, 2],
        pagesProcessed: [1, 2],
        complete: true,
        textChars: 11,
        textBytes: 11,
        maxTextChars: 200_000,
        truncationReasons: [],
      },
    });
    expect(pdfDocument.extract).toHaveBeenCalledTimes(1);
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact clawpdf truncation boundary", async () => {
    pdfDocument.pageCount = 59;
    pdfDocument.extract.mockResolvedValueOnce({
      text: "x".repeat(200_000),
      images: [],
      pagesProcessed: Array.from({ length: 17 }, (_, index) => index + 1),
      truncated: { text: true, images: false },
    });

    const result = await createPdfDocumentExtractor().extract(
      request({ maxPages: 20, minTextChars: 5 }),
    );

    expect(result?.coverage).toEqual({
      documentPageCount: 59,
      requestedPages: Array.from({ length: 20 }, (_, index) => index + 1),
      pagesProcessed: Array.from({ length: 17 }, (_, index) => index + 1),
      complete: false,
      textChars: 200_000,
      textBytes: 200_000,
      maxTextChars: 200_000,
      truncationReasons: ["page_limit", "text_limit"],
    });
  });

  it("opens encrypted PDFs with the request password", async () => {
    pdfDocument.extract.mockResolvedValueOnce({ text: "enough text", images: [] });
    const extractor = createPdfDocumentExtractor();

    await extractor.extract(request({ password: "secret" }));

    expect(openPdfMock).toHaveBeenCalledWith(expect.any(Uint8Array), { password: "secret" });
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
  });

  it("normalizes clawpdf password errors", async () => {
    openPdfMock.mockRejectedValueOnce(
      Object.assign(new Error("bad password"), { code: "password" }),
    );
    const extractor = createPdfDocumentExtractor();

    await expect(extractor.extract(request({ password: "wrong" }))).rejects.toThrow(
      "PDF requires a password or password is incorrect.",
    );
    expect(pdfDocument.destroy).not.toHaveBeenCalled();
  });

  it("filters selected pages before passing them to clawpdf", async () => {
    pdfDocument.extract
      .mockResolvedValueOnce({ text: "", images: [] })
      .mockResolvedValueOnce({ text: "", images: [] });
    const extractor = createPdfDocumentExtractor();

    await extractor.extract(request({ pageNumbers: [3, 2, 0, 1], maxPages: 2 }));

    expect(pdfDocument.extract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pages: [2, 1] }),
    );
    expect(pdfDocument.extract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pages: [2, 1] }),
    );
  });

  it("reports image fallback failures and returns extracted text", async () => {
    const onImageExtractionError = vi.fn();
    const failure = new Error("render failed");
    pdfDocument.extract
      .mockResolvedValueOnce({ text: "short", images: [] })
      .mockRejectedValueOnce(failure);
    const extractor = createPdfDocumentExtractor();

    const result = await extractor.extract(request({ onImageExtractionError }));

    expect(result).toEqual({
      text: "short",
      images: [],
      coverage: expect.objectContaining({
        complete: false,
        truncationReasons: ["image_error"],
      }),
    });
    expect(onImageExtractionError).toHaveBeenCalledWith(failure);
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
  });
});
