/** Image extracted from a document page. */
export type DocumentExtractedImage = {
  type: "image";
  data: string;
  mimeType: string;
};

export type DocumentExtractionTruncationReason =
  | "page_limit"
  | "text_limit"
  | "image_limit"
  | "image_error";

/** Page-level extraction accounting. Optional for third-party extractors. */
export type DocumentExtractionCoverage = {
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
export type DocumentExtractionRequest = {
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
export type DocumentExtractionResult = {
  text: string;
  images: DocumentExtractedImage[];
  coverage?: DocumentExtractionCoverage;
};

/** Plugin document extractor capability contract. */
export type DocumentExtractorPlugin = {
  id: string;
  label: string;
  mimeTypes: readonly string[];
  autoDetectOrder?: number;
  extract: (request: DocumentExtractionRequest) => Promise<DocumentExtractionResult | null>;
};

/** Registered document extractor with owning plugin id. */
export type PluginDocumentExtractorEntry = DocumentExtractorPlugin & {
  pluginId: string;
};
