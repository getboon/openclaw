// OCR page classifier tests run real clawpdf on small generated PDFs.
import { createEngine, type PdfEngine } from "clawpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyOcrPages } from "./ocr-pages.js";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const OCR_TEXT = "SCANNED SHEET A-101 FLOOR PLAN LEVEL ONE GENERAL NOTES AND KEYED NOTES";
const FULL_PAGE_IMAGE = `q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /Im1 Do Q`;

type PdfPageSpec = { content: string; form?: string; mediaBox?: string; rotate?: number };

// Builds an uncompressed PDF whose pages share one Helvetica font, one 2x2 gray
// image, and an optional page-sized form XObject. Offsets are computed so the xref is exact.
function buildPdf(pages: PdfPageSpec[]): Uint8Array {
  const objects: string[] = [];
  // Object 1 is the page tree, so the nth added object is number n + 1.
  const add = (body: string) => objects.push(body) + 1;
  const stream = (dict: string, data: string) =>
    `<< ${dict} /Length ${Buffer.byteLength(data, "latin1")} >>\nstream\n${data}\nendstream`;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const image = add(
    stream(
      "/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8",
      "@`@`",
    ),
  );
  const pageRefs = pages.map((page) => {
    const form = page.form
      ? add(
          stream(
            `/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Matrix [${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >>`,
            page.form,
          ),
        )
      : undefined;
    const content = add(stream("", page.content));
    const xobjects = `/Im1 ${image} 0 R${form ? ` /Fm1 ${form} 0 R` : ""}`;
    const mediaBox = page.mediaBox ?? `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`;
    const rotate = page.rotate === undefined ? "" : ` /Rotate ${page.rotate}`;
    return add(
      `<< /Type /Page /Parent 1 0 R /MediaBox [${mediaBox}]${rotate} /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << ${xobjects} >> >> >>`,
    );
  });
  const catalog = add("<< /Type /Catalog /Pages 1 0 R >>");
  const all = [
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...objects,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = all.map((body, index) => {
    const offset = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${all.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("classifyOcrPages", () => {
  let engine: PdfEngine;

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterAll(async () => {
    await engine.destroy();
  });

  it("flags only scanned pages that carry an invisible text layer", async () => {
    const pdf = await engine.open(
      buildPdf([
        { content: "BT /F1 12 Tf 72 720 Td (Visible vector text on a drawing sheet) Tj ET" },
        { content: `${FULL_PAGE_IMAGE} BT 3 Tr /F1 12 Tf 72 700 Td (${OCR_TEXT}) Tj ET` },
        { content: FULL_PAGE_IMAGE },
      ]),
    );
    try {
      expect(classifyOcrPages(pdf, engine, [1, 2, 3])).toEqual([2]);
    } finally {
      pdf.destroy();
    }
  });

  it("does not flag a full-page raster with visible vector text", async () => {
    const pdf = await engine.open(
      buildPdf([{ content: `${FULL_PAGE_IMAGE} BT /F1 12 Tf 72 700 Td (${OCR_TEXT}) Tj ET` }]),
    );
    try {
      expect(classifyOcrPages(pdf, engine, [1])).toEqual([]);
    } finally {
      pdf.destroy();
    }
  });

  it("flags invisible text on a rotated page with an offset media box", async () => {
    const pdf = await engine.open(
      buildPdf([
        {
          mediaBox: "-612 -396 612 396",
          rotate: 90,
          content: `q 1224 0 0 792 -612 -396 cm /Im1 Do Q BT 3 Tr /F1 12 Tf -500 0 Td (${OCR_TEXT}) Tj ET`,
        },
      ]),
    );
    try {
      expect(classifyOcrPages(pdf, engine, [1])).toEqual([1]);
    } finally {
      pdf.destroy();
    }
  });

  it("counts invisible text inside a form XObject", async () => {
    const pdf = await engine.open(
      buildPdf([
        {
          content: "q /Fm1 Do Q",
          form: `q 1 0 0 1 0 0 cm /Im1 Do Q BT 3 Tr /F1 0.02 Tf 0.1 0.5 Td (${OCR_TEXT}) Tj ET`,
        },
      ]),
    );
    try {
      expect(classifyOcrPages(pdf, engine, [1])).toEqual([1]);
    } finally {
      pdf.destroy();
    }
  });

  it("returns undefined when the PDFium object API is unavailable", async () => {
    const pdf = await engine.open(buildPdf([{ content: FULL_PAGE_IMAGE }]));
    try {
      expect(classifyOcrPages(pdf, {} as PdfEngine, [1])).toBeUndefined();
    } finally {
      pdf.destroy();
    }
  });

  it("treats a page that cannot be loaded as not OCR and classifies the rest", async () => {
    const pdf = await engine.open(
      buildPdf([
        { content: `${FULL_PAGE_IMAGE} BT 3 Tr /F1 12 Tf 72 700 Td (${OCR_TEXT}) Tj ET` },
        { content: FULL_PAGE_IMAGE },
        { content: FULL_PAGE_IMAGE },
      ]),
    );
    try {
      expect(classifyOcrPages(pdf, engine, [1, 5])).toEqual([1]);
    } finally {
      pdf.destroy();
    }
  });
});
