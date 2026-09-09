/**
 * pdf built-in tool.
 *
 * Loads local/web PDFs, extracts pages/text, and analyzes them with native or fallback media-understanding models.
 */
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import { Type } from "typebox";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { complete } from "../../llm/stream.js";
import type { Context } from "../../llm/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  classifyMediaReferenceSource,
  normalizeMediaReferenceSource,
} from "../../media/media-reference.js";
import { extractPdfContent, type PdfExtractedContent } from "../../media/pdf-extract.js";
import { loadWebMediaRaw } from "../../media/web-media.js";
import type {
  DocumentExtractionCoverage,
  DocumentExtractionTruncationReason,
} from "../../plugins/document-extractor-types.js";
import { resolveUserPath } from "../../utils.js";
import type { AuthProfileStore } from "../auth-profiles/types.js";
import { optionalFiniteNumberSchema } from "../schema/typebox.js";
import { readFiniteNumberParam, ToolInputError } from "./common.js";
import { coerceImageModelConfig, type ImageModelConfig } from "./image-tool.helpers.js";
import {
  applyImageModelConfigDefaults,
  buildTextToolResult,
  REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS,
  resolveModelFromRegistry,
  resolveMediaToolLocalRoots,
  resolveModelRuntimeApiKey,
  resolvePromptAndModelOverride,
  resolveRemoteMediaSsrfPolicy,
} from "./media-tool-shared.js";
import { hasToolModelConfig } from "./model-config.helpers.js";
import { anthropicAnalyzePdf, geminiAnalyzePdf } from "./pdf-native-providers.js";
import {
  coercePdfAssistantText,
  coercePdfModelConfig,
  parsePageRange,
  providerSupportsNativePdf,
  resolvePdfInputs,
  resolvePdfToolMaxTokens,
} from "./pdf-tool.helpers.js";
import { resolvePdfModelConfigForTool } from "./pdf-tool.model-config.js";
import {
  createSandboxBridgeReadFile,
  discoverAuthStorage,
  discoverModels,
  ensureOpenClawModelsJson,
  resolveSandboxedBridgeMediaPath,
  runWithImageModelFallback,
  type AnyAgentTool,
  type SandboxedBridgeMediaPathConfig,
  type SandboxFsBridge,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";

const DEFAULT_PROMPT = "Analyze this PDF document.";
const DEFAULT_MAX_PDFS = 10;
const DEFAULT_MAX_BYTES_MB = 10;
const DEFAULT_MAX_PAGES = 20;

const PDF_MIN_TEXT_CHARS = 200;
const PDF_MAX_PIXELS = 4_000_000;
const PDF_EXTRACTION_BATCH_PAGES = 10;

const log = createSubsystemLogger("agents/tools/pdf");

type PdfExtractionChunk = PdfExtractedContent & {
  filename: string;
  pdfIndex: number;
  chunkIndex: number;
};

type PdfCoverageSummary = DocumentExtractionCoverage & {
  filename: string;
};

/**
 * Largest base64 payload we will inline into ONE native-provider request, per provider.
 *
 * Three things this has to get right, each of which an earlier per-file raw-byte constant
 * got wrong:
 *
 * 1. These are caps on the *encoded* request, not on the file. base64 inflates 4/3, so the
 *    raw budget is 3/4 of the number here.
 * 2. Every PDF in the call goes into a SINGLE request — `pdf-native-providers.ts` builds one
 *    content array and one JSON body — so the budget is the SUM across pdfs, not each one.
 *    With DEFAULT_MAX_PDFS = 10 a per-file check is an order of magnitude too permissive.
 * 3. The cap is provider-specific, and the provider varies per fallback attempt, so this
 *    cannot be hoisted out of the `run` callback.
 *
 * Anything over routes through local extraction instead, whose cost is bounded by
 * pdfMaxPages rather than by file size. Above 384MB raw the encode is not merely wasteful
 * but impossible: V8 caps a string at 0x1fffffe8 (512MB) chars.
 *
 * anthropic 32MB is Anthropic's documented Messages request cap. google 20MB is Gemini's
 * documented inline-request limit and is NOT verified against a live 413; it is also the
 * default for any future native provider, being the tighter of the two.
 */
const NATIVE_INLINE_REQUEST_CAP_BYTES: Record<string, number> = {
  anthropic: 32 * 1024 * 1024,
  google: 20 * 1024 * 1024,
};
const NATIVE_INLINE_REQUEST_CAP_DEFAULT_BYTES = 20 * 1024 * 1024;

/** Whether every PDF in this call, base64-encoded into one request, fits the provider's cap. */
function canInlineNativePdfs(provider: string, pdfs: Array<{ buffer: Buffer }>): boolean {
  const rawBytes = pdfs.reduce((total, p) => total + p.buffer.byteLength, 0);
  const encodedBytes = Math.ceil(rawBytes / 3) * 4;
  const cap = NATIVE_INLINE_REQUEST_CAP_BYTES[provider] ?? NATIVE_INLINE_REQUEST_CAP_DEFAULT_BYTES;
  return encodedBytes <= cap;
}

/**
 * Hard ceiling on accepted PDF bytes, applied on top of pdfMaxBytesMb.
 *
 * PDFium runs in a WASM heap capped at 2GiB, and FPDF_LoadMemDocument copies the whole file
 * into it, so the file and its per-page working set have to share those 2GiB. Measured on
 * real bid sets: a 328MB set needs ~270MB of working set on top of the copy, while a 1.34GB
 * set loads but aborts mid-extraction with "Cannot enlarge memory, requested 2147487744
 * bytes, but the limit is 2147483648". 768MB leaves ~1.2GB of headroom, roughly 2x the worst
 * working set observed.
 *
 * ponytail: one global ceiling. Split it per tier if trial (1GB container) and paid (uncapped
 * EC2) need different answers -- note peak RSS runs ~2x file size, so the trial ceiling is
 * container RAM, not this.
 */
const PDF_MAX_BYTES_CEILING = 768 * 1024 * 1024;

export const PdfToolSchema = Type.Object({
  prompt: Type.Optional(Type.String()),
  pdf: Type.Optional(Type.String({ description: "One PDF path/URL." })),
  pdfs: Type.Optional(
    Type.Array(Type.String(), {
      description: "PDF paths/URLs; max 10.",
    }),
  ),
  pages: Type.Optional(
    Type.String({
      description: 'Pages, e.g. "1-5", "1,3,5-7"; default all.',
    }),
  ),
  password: Type.Optional(Type.String({ description: "Password for encrypted PDFs." })),
  model: Type.Optional(Type.String()),
  maxBytesMb: optionalFiniteNumberSchema({ exclusiveMinimum: 0 }),
});

function hasExplicitPdfToolModelConfig(config?: OpenClawConfig): boolean {
  return (
    hasToolModelConfig(coercePdfModelConfig(config)) ||
    hasToolModelConfig(coerceImageModelConfig(config))
  );
}

// ---------------------------------------------------------------------------
// Build context for extraction fallback path
// ---------------------------------------------------------------------------

const CODEX_PDF_INSTRUCTIONS =
  "Analyze the provided PDF content and answer the user's request accurately.";

function buildPdfExtractionContext(
  prompt: string,
  extractions: Array<PdfExtractedContent | PdfExtractionChunk>,
  model?: { api?: string },
): Context {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [];

  // Add extracted text and images
  for (const extraction of extractions) {
    if (extraction.text.trim()) {
      const extractionChunk = extraction as Partial<PdfExtractionChunk>;
      const pages = extraction.coverage?.pagesProcessed;
      const pageLabel = pages?.length ? ` pages ${formatPageRanges(pages)}` : "";
      const filenameLabel = extractionChunk.filename ? ` ${extractionChunk.filename}` : "";
      const label =
        extractions.length > 1 || filenameLabel || pageLabel
          ? `[PDF${filenameLabel}${pageLabel} text]\n`
          : "[PDF text]\n";
      content.push({ type: "text", text: label + extraction.text });
    }
    for (const img of extraction.images) {
      content.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }

  // Add the user prompt
  content.push({ type: "text", text: prompt });

  const systemPrompt =
    model?.api === "openai-chatgpt-responses" ? CODEX_PDF_INSTRUCTIONS : undefined;

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: [{ role: "user", content, timestamp: Date.now() }],
  };
}

function pageRange(start: number, end: number): number[] {
  if (end < start) {
    return [];
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function formatPageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return "none";
  }
  const ranges: string[] = [];
  let start = sorted[0];
  let end = start;
  for (const page of sorted.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

function aggregatePdfCoverage(params: {
  filename: string;
  chunks: PdfExtractionChunk[];
  maxPages: number;
  requestedPages?: number[];
}): PdfCoverageSummary | undefined {
  const coverages = params.chunks.flatMap((chunk) => (chunk.coverage ? [chunk.coverage] : []));
  const first = coverages[0];
  if (!first) {
    return undefined;
  }
  const documentPageCount = first.documentPageCount;
  const requestedPages =
    params.requestedPages ??
    pageRange(1, Math.min(documentPageCount, Math.max(0, params.maxPages)));
  const pagesProcessed = [
    ...new Set(coverages.flatMap((coverage) => coverage.pagesProcessed)),
  ].toSorted((a, b) => a - b);
  const processedSet = new Set(pagesProcessed);
  const truncationReasons = [
    ...new Set(
      coverages
        .flatMap((coverage) => coverage.truncationReasons)
        .filter((reason) => reason !== "page_limit"),
    ),
  ] as DocumentExtractionTruncationReason[];
  if (requestedPages.length < documentPageCount) {
    truncationReasons.unshift("page_limit");
  }
  const coverageComplete =
    truncationReasons.length === 0 &&
    requestedPages.length === documentPageCount &&
    requestedPages.every((page) => processedSet.has(page));
  return {
    filename: params.filename,
    documentPageCount,
    requestedPages,
    pagesProcessed,
    complete: coverageComplete,
    textChars: coverages.reduce((total, coverage) => total + coverage.textChars, 0),
    textBytes: coverages.reduce((total, coverage) => total + coverage.textBytes, 0),
    maxTextChars: coverages.reduce((total, coverage) => total + coverage.maxTextChars, 0),
    truncationReasons,
  };
}

function buildCoverageInstruction(coverage: readonly PdfCoverageSummary[]): string {
  if (coverage.length === 0) {
    return [
      "PDF coverage accounting is unavailable for these extraction results.",
      "You must not claim that a sheet, discipline, term, or item is absent from the document.",
    ].join("\n");
  }
  const lines = coverage.map((entry) => {
    const processed = formatPageRanges(entry.pagesProcessed);
    return entry.complete
      ? `${entry.filename}: all ${entry.documentPageCount} pages were processed (${processed}).`
      : `${entry.filename}: only pages ${processed} of ${entry.documentPageCount} were processed.`;
  });
  const incomplete = coverage.some((entry) => !entry.complete);
  return [
    "PDF coverage accounting:",
    ...lines,
    incomplete
      ? "Coverage is incomplete. You must not claim that a sheet, discipline, term, or item is absent from the document; state that unprocessed pages were not checked."
      : "Coverage is complete across the requested documents.",
  ].join("\n");
}

function formatCoverageResultText(text: string, coverage: readonly PdfCoverageSummary[]): string {
  const lines = coverage.map((entry) => {
    const processed = formatPageRanges(entry.pagesProcessed);
    return entry.complete
      ? `PDF coverage: processed pages ${processed} of ${entry.documentPageCount}.`
      : `⚠️ Partial PDF read: processed pages ${processed} of ${entry.documentPageCount}. Do not infer that omitted sheets or terms are absent.`;
  });
  return `${lines.join("\n")}\n\n${text}`;
}

// ---------------------------------------------------------------------------
// Run PDF prompt with model fallback
// ---------------------------------------------------------------------------

type PdfSandboxConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

async function runPdfPrompt(params: {
  cfg?: OpenClawConfig;
  agentDir: string;
  workspaceDir?: string;
  pdfModelConfig: ImageModelConfig;
  modelOverride?: string;
  prompt: string;
  pdfs: Array<{ buffer: Buffer; filename: string }>;
  password?: string;
  pageNumbers?: number[];
  getExtractions: () => Promise<{
    chunks: PdfExtractionChunk[];
    coverage: PdfCoverageSummary[];
  }>;
}): Promise<{
  text: string;
  provider: string;
  model: string;
  native: boolean;
  attempts: Array<{ provider: string; model: string; error: string }>;
  coverage?: PdfCoverageSummary[];
}> {
  const effectiveCfg = applyImageModelConfigDefaults(params.cfg, params.pdfModelConfig);

  const modelsOptions = params.workspaceDir ? { workspaceDir: params.workspaceDir } : undefined;
  await ensureOpenClawModelsJson(effectiveCfg, params.agentDir, modelsOptions);
  const authStorage = discoverAuthStorage(params.agentDir);
  const modelRegistry = discoverModels(authStorage, params.agentDir, modelsOptions);

  let extractionCache: {
    chunks: PdfExtractionChunk[];
    coverage: PdfCoverageSummary[];
  } | null = null;
  const getExtractions = async (): Promise<{
    chunks: PdfExtractionChunk[];
    coverage: PdfCoverageSummary[];
  }> => {
    if (!extractionCache) {
      extractionCache = await params.getExtractions();
    }
    return extractionCache;
  };

  const result = await runWithImageModelFallback({
    cfg: effectiveCfg,
    modelOverride: params.modelOverride,
    run: async (provider, modelId) => {
      const model = resolveModelFromRegistry({ modelRegistry, provider, modelId });
      const apiKey = await resolveModelRuntimeApiKey({
        model,
        cfg: effectiveCfg,
        agentDir: params.agentDir,
        authStorage,
      });

      // Evaluated per attempt: the cap is provider-specific and the provider varies down
      // the fallback chain. Over it, the native branch is skipped entirely and this same
      // run falls through to extraction below, so the base64 is never built.
      if (providerSupportsNativePdf(provider) && canInlineNativePdfs(provider, params.pdfs)) {
        if (params.password) {
          throw new Error(
            `password is not supported with native PDF providers (${provider}/${modelId}). Remove password, or use a non-native model for encrypted PDFs.`,
          );
        }
        if (params.pageNumbers && params.pageNumbers.length > 0) {
          throw new Error(
            `pages is not supported with native PDF providers (${provider}/${modelId}). Remove pages, or use a non-native model for page filtering.`,
          );
        }

        const pdfs = params.pdfs.map((p) => ({
          base64: p.buffer.toString("base64"),
          filename: p.filename,
        }));

        if (provider === "anthropic") {
          const text = await anthropicAnalyzePdf({
            apiKey,
            modelId,
            prompt: params.prompt,
            pdfs,
            maxTokens: resolvePdfToolMaxTokens(model.maxTokens),
            baseUrl: model.baseUrl,
          });
          return { text, provider, model: modelId, native: true };
        }

        if (provider === "google") {
          const text = await geminiAnalyzePdf({
            apiKey,
            modelId,
            prompt: params.prompt,
            pdfs,
            baseUrl: model.baseUrl,
          });
          return { text, provider, model: modelId, native: true };
        }
      }

      const extractionResult = await getExtractions();
      const extractions = extractionResult.chunks;
      const hasImages = extractions.some((e) => e.images.length > 0);
      const analyzeExtractions = async (
        selectedExtractions: PdfExtractionChunk[],
        analysisPrompt: string,
      ): Promise<string> => {
        const compatibleExtractions =
          hasImages && !model.input?.includes("image")
            ? selectedExtractions.map((extraction) => ({
                ...extraction,
                images: [],
              }))
            : selectedExtractions;
        const context = buildPdfExtractionContext(analysisPrompt, compatibleExtractions, model);
        const message = await complete(model, context, {
          apiKey,
          maxTokens: resolvePdfToolMaxTokens(model.maxTokens),
        });
        return coercePdfAssistantText({ message, provider, model: modelId });
      };
      if (hasImages && !model.input?.includes("image")) {
        const hasText = extractions.some((e) => e.text.trim().length > 0);
        if (!hasText) {
          throw new Error(
            `Model ${provider}/${modelId} does not support images and PDF has no extractable text.`,
          );
        }
      }
      if (extractions.length <= 1) {
        const text = await analyzeExtractions(extractions, params.prompt);
        return {
          text,
          provider,
          model: modelId,
          native: false,
          coverage: extractionResult.coverage,
        };
      }

      const chunkSummaries: PdfExtractionChunk[] = [];
      for (const extraction of extractions) {
        const chunkCoverage = extraction.coverage;
        const chunkPrompt = [
          params.prompt,
          chunkCoverage
            ? `This pass covers only pages ${formatPageRanges(chunkCoverage.pagesProcessed)} of ${chunkCoverage.documentPageCount}.`
            : "This pass covers only one bounded chunk of the PDF.",
          "Return grounded findings and page references from this chunk only. Do not make document-wide absence claims.",
        ].join("\n\n");
        const chunkText = await analyzeExtractions([extraction], chunkPrompt);
        chunkSummaries.push({
          ...extraction,
          text: chunkText,
          images: [],
        });
      }
      const synthesisPrompt = [
        params.prompt,
        buildCoverageInstruction(extractionResult.coverage),
      ].join("\n\n");
      const text = await analyzeExtractions(chunkSummaries, synthesisPrompt);
      return {
        text,
        provider,
        model: modelId,
        native: false,
        coverage: extractionResult.coverage,
      };
    },
  });

  return {
    text: result.result.text,
    provider: result.result.provider,
    model: result.result.model,
    native: result.result.native,
    attempts: result.attempts.map((a) => ({
      provider: a.provider,
      model: a.model,
      error: a.error,
    })),
    ...(result.result.coverage ? { coverage: result.result.coverage } : {}),
  };
}

// ---------------------------------------------------------------------------
// PDF tool factory
// ---------------------------------------------------------------------------

export function createPdfTool(options?: {
  config?: OpenClawConfig;
  agentDir?: string;
  authProfileStore?: AuthProfileStore;
  workspaceDir?: string;
  sandbox?: PdfSandboxConfig;
  fsPolicy?: ToolFsPolicy;
  /**
   * Avoid resolving auto PDF-provider/model candidates while registering the
   * tool. The concrete PDF model is still resolved before execution.
   */
  deferAutoModelResolution?: boolean;
}): AnyAgentTool | null {
  const agentDir = options?.agentDir?.trim();
  const hasExplicitModelConfig = hasExplicitPdfToolModelConfig(options?.config);
  if (!agentDir) {
    if (hasExplicitModelConfig) {
      throw new Error("createPdfTool requires agentDir when enabled");
    }
    return null;
  }

  const shouldDeferAutoModelResolution =
    options?.deferAutoModelResolution === true && !hasExplicitModelConfig;
  const registrationPdfModelConfig = shouldDeferAutoModelResolution
    ? null
    : resolvePdfModelConfigForTool({
        cfg: options?.config,
        agentDir,
        workspaceDir: options?.workspaceDir,
        authStore: options?.authProfileStore,
      });
  if (!registrationPdfModelConfig && !shouldDeferAutoModelResolution) {
    return null;
  }

  const maxBytesMbDefault = (
    options?.config?.agents?.defaults as Record<string, unknown> | undefined
  )?.pdfMaxBytesMb;
  const maxPagesDefault = (options?.config?.agents?.defaults as Record<string, unknown> | undefined)
    ?.pdfMaxPages;
  const configuredMaxBytesMb =
    typeof maxBytesMbDefault === "number" && Number.isFinite(maxBytesMbDefault)
      ? maxBytesMbDefault
      : DEFAULT_MAX_BYTES_MB;
  const configuredMaxPages =
    typeof maxPagesDefault === "number" && Number.isFinite(maxPagesDefault)
      ? Math.floor(maxPagesDefault)
      : DEFAULT_MAX_PAGES;

  const description =
    "Analyze PDFs with model. Anthropic/Google native PDF when supported; else text/image extraction. Use pdf for one, pdfs for max 10; prompt says what to inspect.";
  const remoteMediaSsrfPolicy = resolveRemoteMediaSsrfPolicy(options?.config);

  return {
    label: "PDF",
    name: "pdf",
    description,
    parameters: PdfToolSchema,
    execute: async (_toolCallId, args) => {
      const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};

      // MARK: - Normalize pdf + pdfs input
      const pdfInputs = resolvePdfInputs(record);

      // Enforce max PDFs cap
      if (pdfInputs.length > DEFAULT_MAX_PDFS) {
        return {
          content: [
            {
              type: "text",
              text: `Too many PDFs: ${pdfInputs.length} provided, maximum is ${DEFAULT_MAX_PDFS}. Please reduce the number.`,
            },
          ],
          details: { error: "too_many_pdfs", count: pdfInputs.length, max: DEFAULT_MAX_PDFS },
        };
      }

      const { prompt: promptRaw, modelOverride } = resolvePromptAndModelOverride(
        record,
        DEFAULT_PROMPT,
      );
      const maxBytesMb =
        readFiniteNumberParam(record, "maxBytesMb", {
          min: 0,
          minExclusive: true,
          message: "maxBytesMb must be greater than 0",
        }) ?? configuredMaxBytesMb;
      const maxBytes = Math.min(Math.floor(maxBytesMb * 1024 * 1024), PDF_MAX_BYTES_CEILING);

      // Parse page range
      const pagesRaw = normalizeOptionalString(record.pages);
      const password = typeof record.password === "string" ? record.password : undefined;

      const pdfModelConfig =
        registrationPdfModelConfig ??
        resolvePdfModelConfigForTool({
          cfg: options?.config,
          agentDir,
          workspaceDir: options?.workspaceDir,
          authStore: options?.authProfileStore,
        });
      if (!pdfModelConfig) {
        throw new ToolInputError("No PDF model configured.");
      }

      const sandboxConfig: SandboxedBridgeMediaPathConfig | null =
        options?.sandbox && options.sandbox.root.trim()
          ? {
              root: options.sandbox.root.trim(),
              bridge: options.sandbox.bridge,
              workspaceOnly: options.fsPolicy?.workspaceOnly === true,
            }
          : null;

      // MARK: - Load each PDF
      const loadedPdfs: Array<{
        buffer: Buffer;
        filename: string;
        resolvedPath: string;
        rewrittenFrom?: string;
      }> = [];

      for (const pdfRaw of pdfInputs) {
        const trimmed = normalizeMediaReferenceSource(pdfRaw);
        const refInfo = classifyMediaReferenceSource(trimmed);
        const { isHttpUrl } = refInfo;

        if (refInfo.hasUnsupportedScheme) {
          return {
            content: [
              {
                type: "text",
                text: `Unsupported PDF reference: ${pdfRaw}. Use a file path, file:// URL, or http(s) URL.`,
              },
            ],
            details: { error: "unsupported_pdf_reference", pdf: pdfRaw },
          };
        }

        if (sandboxConfig && isHttpUrl) {
          throw new Error("Sandboxed PDF tool does not allow remote URLs.");
        }

        const resolvedPdf = (() => {
          if (sandboxConfig) {
            return trimmed;
          }
          if (trimmed.startsWith("~")) {
            return resolveUserPath(trimmed);
          }
          return trimmed;
        })();

        const resolvedPathInfo: { resolved: string; rewrittenFrom?: string } = sandboxConfig
          ? await resolveSandboxedBridgeMediaPath({
              sandbox: sandboxConfig,
              mediaPath: resolvedPdf,
              inboundFallbackDir: "media/inbound",
            })
          : {
              resolved: resolvedPdf.startsWith("file://")
                ? resolvedPdf.slice("file://".length)
                : resolvedPdf,
            };
        const localRoots = resolveMediaToolLocalRoots(
          options?.workspaceDir,
          {
            workspaceOnly: options?.fsPolicy?.workspaceOnly === true,
          },
          [resolvedPathInfo.resolved],
        );

        const media = sandboxConfig
          ? await loadWebMediaRaw(resolvedPathInfo.resolved, {
              maxBytes,
              sandboxValidated: true,
              readFile: createSandboxBridgeReadFile({ sandbox: sandboxConfig, maxBytes }),
            })
          : await loadWebMediaRaw(resolvedPathInfo.resolved, {
              maxBytes,
              localRoots,
              ...(isHttpUrl ? { readIdleTimeoutMs: REMOTE_MEDIA_READ_IDLE_TIMEOUT_MS } : {}),
              ssrfPolicy: remoteMediaSsrfPolicy,
            });

        if (media.kind !== "document") {
          // Check MIME type more specifically
          const ct = normalizeLowercaseStringOrEmpty(media.contentType);
          if (!ct.includes("pdf") && !ct.includes("application/pdf")) {
            throw new Error(`Expected PDF but got ${media.contentType ?? media.kind}: ${pdfRaw}`);
          }
        }

        const filename =
          media.fileName ??
          (isHttpUrl
            ? (new URL(trimmed).pathname.split("/").pop() ?? "document.pdf")
            : "document.pdf");

        loadedPdfs.push({
          buffer: media.buffer,
          filename,
          resolvedPath: resolvedPathInfo.resolved,
          ...(resolvedPathInfo.rewrittenFrom
            ? { rewrittenFrom: resolvedPathInfo.rewrittenFrom }
            : {}),
        });
      }

      const pageNumbers = pagesRaw ? parsePageRange(pagesRaw, configuredMaxPages) : undefined;

      const getExtractions = async (): Promise<{
        chunks: PdfExtractionChunk[];
        coverage: PdfCoverageSummary[];
      }> => {
        const chunks: PdfExtractionChunk[] = [];
        const coverage: PdfCoverageSummary[] = [];
        for (const [pdfIndex, pdf] of loadedPdfs.entries()) {
          const firstRequestedPages = pageNumbers
            ? pageNumbers.slice(0, PDF_EXTRACTION_BATCH_PAGES)
            : pageRange(1, Math.min(PDF_EXTRACTION_BATCH_PAGES, configuredMaxPages));
          let documentPageCount: number | undefined;
          let nextChunkIndex = 0;
          const extractBatch = async (requestedPages: number[]): Promise<PdfExtractionChunk[]> => {
            const extracted = await extractPdfContent({
              buffer: pdf.buffer,
              maxPages: requestedPages.length,
              maxPixels: PDF_MAX_PIXELS,
              minTextChars: PDF_MIN_TEXT_CHARS,
              ...(password ? { password } : {}),
              pageNumbers: requestedPages,
              config: options?.config,
            });
            documentPageCount ??= extracted.coverage?.documentPageCount;
            if (
              requestedPages.length > 1 &&
              extracted.coverage?.truncationReasons.includes("text_limit")
            ) {
              const midpoint = Math.ceil(requestedPages.length / 2);
              const left = await extractBatch(requestedPages.slice(0, midpoint));
              const right = await extractBatch(requestedPages.slice(midpoint));
              return [...left, ...right];
            }
            return [
              {
                ...extracted,
                filename: pdf.filename,
                pdfIndex,
                chunkIndex: nextChunkIndex++,
              },
            ];
          };
          if (firstRequestedPages.length > 0) {
            chunks.push(...(await extractBatch(firstRequestedPages)));
          }
          if (documentPageCount !== undefined) {
            const allRequestedPages =
              pageNumbers ??
              pageRange(1, Math.min(documentPageCount, Math.max(0, configuredMaxPages)));
            for (
              let offset = PDF_EXTRACTION_BATCH_PAGES;
              offset < allRequestedPages.length;
              offset += PDF_EXTRACTION_BATCH_PAGES
            ) {
              chunks.push(
                ...(await extractBatch(
                  allRequestedPages.slice(offset, offset + PDF_EXTRACTION_BATCH_PAGES),
                )),
              );
            }
          }
          const pdfChunks = chunks.filter((chunk) => chunk.pdfIndex === pdfIndex);
          const summary = aggregatePdfCoverage({
            filename: pdf.filename,
            chunks: pdfChunks,
            maxPages: configuredMaxPages,
            ...(pageNumbers ? { requestedPages: pageNumbers } : {}),
          });
          if (summary) {
            coverage.push(summary);
          }
        }
        return { chunks, coverage };
      };

      const result = await runPdfPrompt({
        cfg: options?.config,
        agentDir,
        ...(options?.workspaceDir ? { workspaceDir: options.workspaceDir } : {}),
        pdfModelConfig,
        modelOverride,
        prompt: promptRaw,
        pdfs: loadedPdfs.map((p) => ({ buffer: p.buffer, filename: p.filename })),
        ...(password ? { password } : {}),
        pageNumbers,
        getExtractions,
      });

      const pdfDetails =
        loadedPdfs.length === 1
          ? {
              pdf: loadedPdfs[0].resolvedPath,
              ...(loadedPdfs[0].rewrittenFrom
                ? { rewrittenFrom: loadedPdfs[0].rewrittenFrom }
                : {}),
            }
          : {
              pdfs: loadedPdfs.map((p) =>
                Object.assign(
                  { pdf: p.resolvedPath },
                  p.rewrittenFrom ? { rewrittenFrom: p.rewrittenFrom } : {},
                ),
              ),
            };

      if (!result.coverage || result.coverage.length === 0) {
        return buildTextToolResult(result, { native: result.native, ...pdfDetails });
      }
      const partial = result.coverage.some((entry) => !entry.complete);
      if (partial) {
        for (const entry of result.coverage.filter((coverageEntry) => !coverageEntry.complete)) {
          log.warn("pdf_coverage_partial", {
            filename: entry.filename,
            documentPageCount: entry.documentPageCount,
            pagesProcessed: entry.pagesProcessed,
            lastPageProcessed: entry.pagesProcessed.at(-1),
            truncationReasons: entry.truncationReasons,
            textChars: entry.textChars,
            textBytes: entry.textBytes,
            maxTextChars: entry.maxTextChars,
          });
        }
      }
      return buildTextToolResult(
        { ...result, text: formatCoverageResultText(result.text, result.coverage) },
        {
          native: result.native,
          ...pdfDetails,
          status: partial ? "partial" : "ok",
          coverage: result.coverage,
        },
      );
    },
  };
}
