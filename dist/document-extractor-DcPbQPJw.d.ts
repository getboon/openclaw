//#region src/plugins/document-extractor-types.d.ts
/** Image extracted from a document page. */
type DocumentExtractedImage = {
  type: "image";
  data: string;
  mimeType: string;
};
type DocumentExtractionTruncationReason = "page_limit" | "text_limit" | "image_limit" | "image_error";
/** Page-level extraction accounting. Optional for third-party extractors. */
type DocumentExtractionCoverage = {
  documentPageCount: number;
  requestedPages: number[];
  pagesProcessed: number[];
  complete: boolean;
  textChars: number;
  textBytes: number;
  maxTextChars: number;
  truncationReasons: DocumentExtractionTruncationReason[];
};
/** Request passed to plugin document extractors. */
type DocumentExtractionRequest = {
  buffer: Buffer;
  mimeType: string;
  maxPages: number;
  maxPixels: number;
  minTextChars: number;
  password?: string;
  pageNumbers?: number[];
  onImageExtractionError?: (error: unknown) => void;
};
/** Text and image result returned by a document extractor. */
type DocumentExtractionResult = {
  text: string;
  images: DocumentExtractedImage[];
  coverage?: DocumentExtractionCoverage;
};
/** Plugin document extractor capability contract. */
type DocumentExtractorPlugin = {
  id: string;
  label: string;
  mimeTypes: readonly string[];
  autoDetectOrder?: number;
  extract: (request: DocumentExtractionRequest) => Promise<DocumentExtractionResult | null>;
};
//#endregion
export { DocumentExtractionTruncationReason as a, DocumentExtractionResult as i, DocumentExtractionCoverage as n, DocumentExtractorPlugin as o, DocumentExtractionRequest as r, DocumentExtractedImage as t };