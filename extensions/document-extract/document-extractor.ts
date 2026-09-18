// Document Extract plugin module implements document extractor behavior.
import type { PdfDocument, PdfEngine, PdfImage } from "clawpdf";
import type {
  DocumentExtractedImage,
  DocumentExtractionCoverage,
  DocumentExtractionRequest,
  DocumentExtractionResult,
  DocumentExtractionTruncationReason,
  DocumentExtractorPlugin,
} from "openclaw/plugin-sdk/document-extractor";

const MAX_EXTRACTED_TEXT_CHARS = 200_000;
const MAX_RENDER_DIMENSION = 10_000;

let pdfEnginePromise: Promise<PdfEngine> | null = null;

async function loadPdfEngine(): Promise<PdfEngine> {
  if (!pdfEnginePromise) {
    pdfEnginePromise = import("clawpdf")
      .then(({ createEngine }) => createEngine())
      .catch((err: unknown) => {
        pdfEnginePromise = null;
        throw new Error("Dependency clawpdf is required for PDF extraction", {
          cause: err,
        });
      });
  }
  return pdfEnginePromise;
}

function toDocumentImage(image: PdfImage): DocumentExtractedImage {
  return {
    type: "image",
    data: Buffer.from(image.bytes).toString("base64"),
    mimeType: image.mimeType,
  };
}

function isPdfPasswordError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "password");
}

function pageRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function normalizedProcessedPages(
  result: { pagesProcessed?: number[]; truncated?: { text?: boolean; images?: boolean } },
  requestedPages: number[],
): number[] {
  if (Array.isArray(result.pagesProcessed)) {
    return result.pagesProcessed.filter((page) => requestedPages.includes(page));
  }
  return requestedPages;
}

function buildCoverage(params: {
  documentPageCount: number;
  requestedPages: number[];
  pagesProcessed: number[];
  text: string;
  textTruncated?: boolean;
  imageTruncated?: boolean;
  imageError?: boolean;
}): DocumentExtractionCoverage {
  const truncationReasons: DocumentExtractionTruncationReason[] = [];
  if (params.requestedPages.length < params.documentPageCount) {
    truncationReasons.push("page_limit");
  }
  if (params.textTruncated) {
    truncationReasons.push("text_limit");
  }
  if (params.imageTruncated) {
    truncationReasons.push("image_limit");
  }
  if (params.imageError) {
    truncationReasons.push("image_error");
  }
  const processed = [...new Set(params.pagesProcessed)].toSorted((a, b) => a - b);
  const processedSet = new Set(processed);
  const complete =
    truncationReasons.length === 0 &&
    params.requestedPages.length === params.documentPageCount &&
    params.requestedPages.every((page) => processedSet.has(page));
  return {
    documentPageCount: params.documentPageCount,
    requestedPages: params.requestedPages,
    pagesProcessed: processed,
    complete,
    textChars: params.text.length,
    textBytes: Buffer.byteLength(params.text),
    maxTextChars: MAX_EXTRACTED_TEXT_CHARS,
    truncationReasons,
  };
}

async function openPdfDocument(params: {
  engine: PdfEngine;
  input: Uint8Array;
  password?: string;
}): Promise<PdfDocument> {
  try {
    return params.password
      ? await params.engine.open(params.input, { password: params.password })
      : await params.engine.open(params.input);
  } catch (err) {
    if (isPdfPasswordError(err)) {
      throw new Error("PDF requires a password or password is incorrect.", { cause: err });
    }
    throw err;
  }
}

async function extractPdfContent(
  request: DocumentExtractionRequest,
): Promise<DocumentExtractionResult> {
  const engine = await loadPdfEngine();
  const pdf = await openPdfDocument({
    engine,
    // Buffer already is a Uint8Array; re-wrapping it copies the whole file and doubles peak memory.
    input: request.buffer,
    ...(request.password ? { password: request.password } : {}),
  });
  try {
    const pages = request.pageNumbers
      ? request.pageNumbers
          .filter((p) => Number.isInteger(p) && p >= 1 && p <= pdf.pageCount)
          .slice(0, request.maxPages)
      : undefined;
    const requestedPages = pages ?? pageRange(Math.min(pdf.pageCount, request.maxPages));
    const pageSelection = pages ? { pages } : { maxPages: request.maxPages };

    const textResult = await pdf.extract({
      mode: "text",
      ...pageSelection,
      maxTextChars: MAX_EXTRACTED_TEXT_CHARS,
    });
    const text = textResult.text;
    const textPages = normalizedProcessedPages(textResult, requestedPages);

    if (text.trim().length >= request.minTextChars) {
      return {
        text,
        images: [],
        coverage: buildCoverage({
          documentPageCount: pdf.pageCount,
          requestedPages,
          pagesProcessed: textPages,
          text,
          textTruncated: textResult.truncated?.text,
        }),
      };
    }

    try {
      const imageResult = await pdf.extract({
        mode: "images",
        ...pageSelection,
        image: {
          maxDimension: MAX_RENDER_DIMENSION,
          maxPixels: request.maxPixels,
          forms: true,
        },
      });
      const imagePages = normalizedProcessedPages(imageResult, requestedPages);
      return {
        text,
        images: imageResult.images.map(toDocumentImage),
        coverage: buildCoverage({
          documentPageCount: pdf.pageCount,
          requestedPages,
          pagesProcessed: [...textPages, ...imagePages],
          text,
          textTruncated: textResult.truncated?.text,
          imageTruncated: imageResult.truncated?.images,
        }),
      };
    } catch (err) {
      request.onImageExtractionError?.(err);
      return {
        text,
        images: [],
        coverage: buildCoverage({
          documentPageCount: pdf.pageCount,
          requestedPages,
          pagesProcessed: textPages,
          text,
          textTruncated: textResult.truncated?.text,
          imageError: true,
        }),
      };
    }
  } finally {
    pdf.destroy();
  }
}

export function createPdfDocumentExtractor(): DocumentExtractorPlugin {
  return {
    id: "pdf",
    label: "PDF",
    mimeTypes: ["application/pdf"],
    autoDetectOrder: 10,
    extract: extractPdfContent,
  };
}
