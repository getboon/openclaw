// Document Extract tests cover document extractor plugin behavior.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { classifyOcrPagesMock, createEngineMock, openPdfMock, pdfDocument } = vi.hoisted(() => ({
  classifyOcrPagesMock: vi.fn(),
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

vi.mock("./ocr-pages.js", () => ({
  classifyOcrPages: classifyOcrPagesMock,
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
    classifyOcrPagesMock.mockReset();
  });

  function pngImage(page: number, width = 10, height = 10) {
    return {
      bytes: Uint8Array.from(Buffer.from("png")),
      mimeType: "image/png",
      page,
      width,
      height,
    };
  }

  describe("OCR page images", () => {
    const textResult = {
      text: "enough text from an OCR layer",
      images: [],
      pagesProcessed: [1, 2, 3],
      truncated: { text: false, images: false },
    };

    beforeEach(() => {
      pdfDocument.pageCount = 3;
    });

    it("renders images only for OCR pages on the text path", async () => {
      classifyOcrPagesMock.mockReturnValue([2, 3]);
      pdfDocument.extract.mockResolvedValueOnce(textResult).mockResolvedValueOnce({
        text: "",
        images: [pngImage(2, 2366, 1690)],
        pagesProcessed: [2],
        truncated: { text: false, images: true },
      });

      const result = await createPdfDocumentExtractor().extract(
        request({ maxPages: 3, minTextChars: 5, ocrPageImages: true }),
      );

      const engine = await createEngineMock.mock.results[0]?.value;
      expect(classifyOcrPagesMock).toHaveBeenCalledWith(pdfDocument, engine, [1, 2, 3]);
      expect(pdfDocument.extract).toHaveBeenNthCalledWith(2, {
        mode: "images",
        pages: [2, 3],
        image: { maxDimension: 10_000, maxPixels: 100, forms: true },
      });
      expect(result?.images).toEqual([{ type: "image", data: "cG5n", mimeType: "image/png" }]);
      expect(result?.coverage).toEqual(
        expect.objectContaining({
          complete: true,
          truncationReasons: [],
          ocrPages: [2, 3],
          ocrImagePages: [2],
        }),
      );
    });

    it("drops OCR page images below the readable size", async () => {
      classifyOcrPagesMock.mockReturnValue([1, 2]);
      pdfDocument.extract.mockResolvedValueOnce(textResult).mockResolvedValueOnce({
        text: "",
        images: [pngImage(1, 2366, 1690), pngImage(2, 45, 32)],
        pagesProcessed: [1, 2],
        truncated: { text: false, images: false },
      });

      const result = await createPdfDocumentExtractor().extract(
        request({ maxPages: 3, minTextChars: 5, ocrPageImages: true }),
      );

      expect(result?.images).toHaveLength(1);
      expect(result?.coverage).toEqual(
        expect.objectContaining({ ocrPages: [1, 2], ocrImagePages: [1] }),
      );
    });

    it("keeps OCR labels when OCR page rendering fails", async () => {
      classifyOcrPagesMock.mockReturnValue([2]);
      pdfDocument.extract
        .mockResolvedValueOnce(textResult)
        .mockRejectedValueOnce(new Error("render failed"));

      const result = await createPdfDocumentExtractor().extract(
        request({ maxPages: 3, minTextChars: 5, ocrPageImages: true }),
      );

      expect(result?.images).toEqual([]);
      expect(result?.coverage).toEqual(
        expect.objectContaining({ complete: true, truncationReasons: [], ocrPages: [2] }),
      );
      expect(result?.coverage).not.toHaveProperty("ocrImagePages");
    });

    it("does not classify pages without the opt-in", async () => {
      pdfDocument.extract.mockResolvedValueOnce(textResult);

      const result = await createPdfDocumentExtractor().extract(
        request({ maxPages: 3, minTextChars: 5 }),
      );

      expect(classifyOcrPagesMock).not.toHaveBeenCalled();
      expect(pdfDocument.extract).toHaveBeenCalledTimes(1);
      expect(result?.images).toEqual([]);
      expect(result?.coverage).not.toHaveProperty("ocrPages");
    });

    it("extracts normally when OCR classification is unavailable", async () => {
      classifyOcrPagesMock.mockReturnValue(undefined);
      pdfDocument.extract.mockResolvedValueOnce(textResult);

      const result = await createPdfDocumentExtractor().extract(
        request({ maxPages: 3, minTextChars: 5, ocrPageImages: true }),
      );

      expect(pdfDocument.extract).toHaveBeenCalledTimes(1);
      expect(result?.text).toBe(textResult.text);
      expect(result?.images).toEqual([]);
      expect(result?.coverage).not.toHaveProperty("ocrPages");
      expect(result?.coverage).not.toHaveProperty("ocrImagePages");
    });
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

  it("returns empty coverage without extracting when no selected page exists", async () => {
    const result = await createPdfDocumentExtractor().extract(
      request({ pageNumbers: [3, 4], maxPages: 2 }),
    );

    expect(result).toEqual({
      text: "",
      images: [],
      coverage: {
        documentPageCount: 2,
        requestedPages: [],
        pagesProcessed: [],
        complete: false,
        textChars: 0,
        textBytes: 0,
        maxTextChars: 200_000,
        truncationReasons: ["page_limit"],
      },
    });
    expect(pdfDocument.extract).not.toHaveBeenCalled();
    expect(pdfDocument.destroy).toHaveBeenCalledTimes(1);
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
