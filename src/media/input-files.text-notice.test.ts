// Input file text-notice tests cover the marker for text that stops before the file ends.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentExtractionCoverage } from "../plugins/document-extractor-types.js";

const extractPdfContentMock = vi.fn();
const detectMimeMock = vi.fn();

vi.mock("./pdf-extract.js", () => ({
  extractPdfContent: (...args: unknown[]) => extractPdfContentMock(...args),
}));

vi.mock("@openclaw/media-core/mime", () => ({
  detectMime: (...args: unknown[]) => detectMimeMock(...args),
}));

let extractFileContentFromSource: typeof import("./input-files.js").extractFileContentFromSource;

beforeAll(async () => {
  ({ extractFileContentFromSource } = await import("./input-files.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  detectMimeMock.mockResolvedValue(undefined);
});

const MAX_CHARS = 100;

function limits() {
  return {
    allowUrl: false,
    allowedMimes: new Set(["text/plain", "application/pdf"]),
    maxBytes: 1024 * 1024,
    maxChars: MAX_CHARS,
    maxRedirects: 0,
    timeoutMs: 1,
    pdf: { maxPages: 120, maxPixels: 1, minTextChars: 1 },
  };
}

function coverage(overrides: Partial<DocumentExtractionCoverage> = {}): DocumentExtractionCoverage {
  return {
    documentPageCount: 243,
    requestedPages: Array.from({ length: 120 }, (_, index) => index + 1),
    pagesProcessed: Array.from({ length: 120 }, (_, index) => index + 1),
    complete: false,
    textChars: 0,
    textBytes: 0,
    maxTextChars: 0,
    truncationReasons: ["page_limit"],
    ...overrides,
  };
}

async function extractText(text: string) {
  return await extractFileContentFromSource({
    source: {
      type: "base64",
      data: Buffer.from(text).toString("base64"),
      mediaType: "text/plain",
      filename: "notes.txt",
    },
    limits: limits(),
  });
}

async function extractPdf(text: string, pdfCoverage?: DocumentExtractionCoverage) {
  extractPdfContentMock.mockResolvedValueOnce({
    text,
    images: [],
    ...(pdfCoverage ? { coverage: pdfCoverage } : {}),
  });
  return await extractFileContentFromSource({
    source: {
      type: "base64",
      data: Buffer.from("%PDF-1.4").toString("base64"),
      mediaType: "application/pdf",
      filename: "spec.pdf",
    },
    limits: limits(),
  });
}

describe("extractFileContentFromSource text notice", () => {
  it("marks text-file text cut at maxChars with the shown and total counts", async () => {
    const result = await extractText("x".repeat(250));
    expect(result.text).toHaveLength(MAX_CHARS);
    expect(result.textNotice).toBe(
      "[Incomplete text: it stops after 100 of 250 characters of this file. Read the rest from the file before you say what the file contains or lacks.]",
    );
  });

  it.each([MAX_CHARS, 40])("keeps text-file text of %i characters without a notice", async (n) => {
    const result = await extractText("y".repeat(n));
    expect(result.text).toBe("y".repeat(n));
    expect(result.textNotice).toBeUndefined();
  });

  it("marks PDF text that covers only some pages", async () => {
    const result = await extractPdf("short text", coverage());
    expect(result.text).toBe("short text");
    expect(result.textNotice).toBe(
      "[Incomplete text: it covers 120 of the 243 pages of this PDF. Read the other pages from the file before you say what the document contains or lacks.]",
    );
  });

  it("marks PDF text that stops at the extractor text limit without a page count", async () => {
    const result = await extractPdf(
      "short text",
      coverage({
        documentPageCount: 108,
        requestedPages: Array.from({ length: 108 }, (_, i) => i + 1),
        pagesProcessed: Array.from({ length: 108 }, (_, i) => i + 1),
        truncationReasons: ["text_limit"],
      }),
    );
    expect(result.textNotice).toBe(
      "[Incomplete text: only part of this 108-page PDF was extracted. Read the rest from the file before you say what the document contains or lacks.]",
    );
  });

  it("marks PDF text cut at maxChars with the page count", async () => {
    const result = await extractPdf(
      "z".repeat(1234),
      coverage({ documentPageCount: 108, truncationReasons: [], complete: true }),
    );
    expect(result.text).toHaveLength(MAX_CHARS);
    expect(result.textNotice).toBe(
      "[Incomplete text: it stops after 100 of 1234 extracted characters, part-way through this 108-page PDF. Read the rest from the file before you say what the document contains or lacks.]",
    );
  });

  it("marks PDF text cut at maxChars without coverage", async () => {
    const result = await extractPdf("z".repeat(150));
    expect(result.textNotice).toBe(
      "[Incomplete text: it stops after 100 of 150 extracted characters, part-way through this PDF. Read the rest from the file before you say what the document contains or lacks.]",
    );
  });

  it.each([
    { label: "image_limit only", reasons: ["image_limit"] as const },
    { label: "image_error only", reasons: ["image_error"] as const },
    { label: "no reasons", reasons: [] as const },
  ])("adds no notice for PDF coverage with $label", async ({ reasons }) => {
    const allPages = Array.from({ length: 243 }, (_, index) => index + 1);
    const result = await extractPdf(
      "short text",
      coverage({
        requestedPages: allPages,
        pagesProcessed: allPages,
        complete: reasons.length === 0,
        truncationReasons: [...reasons],
      }),
    );
    expect(result.textNotice).toBeUndefined();
  });

  it("marks a page-cut PDF that used page images without a page count", async () => {
    extractPdfContentMock.mockResolvedValueOnce({
      text: "",
      images: [{ type: "image", data: "aGk=", mimeType: "image/png" }],
      coverage: coverage(),
    });
    const result = await extractFileContentFromSource({
      source: {
        type: "base64",
        data: Buffer.from("%PDF-1.4").toString("base64"),
        mediaType: "application/pdf",
        filename: "scan.pdf",
      },
      limits: limits(),
    });
    expect(result.textNotice).toBe(
      "[Incomplete text: only part of this 243-page PDF was extracted. Read the rest from the file before you say what the document contains or lacks.]",
    );
  });

  it("adds no notice for complete PDF text without coverage", async () => {
    const result = await extractPdf("short text");
    expect(result.textNotice).toBeUndefined();
  });
});
