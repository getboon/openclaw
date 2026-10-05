// Document Extract plugin module detects scanned pages by their invisible OCR text layer.
import type { PdfDocument, PdfEngine } from "clawpdf";

// PDF text render modes 3 (invisible) and 7 (clip only) paint no glyphs.
const INVISIBLE_RENDER_MODES = new Set([3, 7]);
const MIN_OCR_TEXT_CHARS = 50;
const MIN_INVISIBLE_TEXT_SHARE = 0.3;
// Classifies from a prefix of very large text layers to bound per-page cost.
const MAX_CHARS_PER_PAGE = 500_000;

// clawpdf exposes these PDFium bindings only on its engine module, not on the public types.
// The feature check below degrades to "no OCR info" if they change.
const PDFIUM_FUNCTIONS = {
  loadTextPage: "_FPDFText_LoadPage",
  closeTextPage: "_FPDFText_ClosePage",
  countChars: "_FPDFText_CountChars",
  getCharTextObject: "_FPDFText_GetTextObject",
  getTextRenderMode: "_FPDFTextObj_GetTextRenderMode",
} as const;

type PdfiumTextFunctions = {
  loadTextPage: (page: number) => number;
  closeTextPage: (textPage: number) => void;
  countChars: (textPage: number) => number;
  getCharTextObject: (textPage: number, index: number) => number;
  getTextRenderMode: (object: number) => number;
};

type PdfiumTextApi = PdfiumTextFunctions & {
  withLoadedPage: <T>(pageNumber: number, callback: (page: number) => T) => T;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveTextApi(document: PdfDocument, engine: PdfEngine): PdfiumTextApi | undefined {
  const engineRecord: unknown = engine;
  const documentRecord: unknown = document;
  if (!isRecord(engineRecord) || !isRecord(documentRecord)) {
    return undefined;
  }
  const { module } = engineRecord;
  const { withLoadedPage } = documentRecord;
  if (!isRecord(module) || typeof withLoadedPage !== "function") {
    return undefined;
  }
  const functions: Record<string, unknown> = {};
  for (const [name, exportName] of Object.entries(PDFIUM_FUNCTIONS)) {
    if (typeof module[exportName] !== "function") {
      return undefined;
    }
    functions[name] = module[exportName];
  }
  return {
    ...(functions as PdfiumTextFunctions),
    withLoadedPage: (pageNumber, callback) => withLoadedPage.call(document, pageNumber, callback),
  };
}

function isOcrPage(api: PdfiumTextApi, page: number): boolean {
  const textPage = api.loadTextPage(page);
  if (!textPage) {
    return false;
  }
  try {
    const charCount = Math.min(api.countChars(textPage), MAX_CHARS_PER_PAGE);
    const invisibleByObject = new Map<number, boolean>();
    let totalChars = 0;
    let invisibleChars = 0;
    for (let index = 0; index < charCount; index++) {
      const object = api.getCharTextObject(textPage, index);
      // PDFium-generated spaces and line breaks have no text object.
      if (!object) {
        continue;
      }
      let invisible = invisibleByObject.get(object);
      if (invisible === undefined) {
        invisible = INVISIBLE_RENDER_MODES.has(api.getTextRenderMode(object));
        invisibleByObject.set(object, invisible);
      }
      totalChars++;
      if (invisible) {
        invisibleChars++;
      }
    }
    return (
      totalChars >= MIN_OCR_TEXT_CHARS && invisibleChars / totalChars >= MIN_INVISIBLE_TEXT_SHARE
    );
  } finally {
    api.closeTextPage(textPage);
  }
}

/** Returns the pages that carry an invisible OCR text layer, or undefined when classification is unavailable. */
export function classifyOcrPages(
  document: PdfDocument,
  engine: PdfEngine,
  pages: readonly number[],
): number[] | undefined {
  try {
    const api = resolveTextApi(document, engine);
    if (!api) {
      return undefined;
    }
    return pages.filter((pageNumber) =>
      api.withLoadedPage(pageNumber, (page) => isOcrPage(api, page)),
    );
  } catch {
    return undefined;
  }
}
