// PDF tool tests cover model discovery, input validation, managed inbound refs,
// native document providers, extraction fallback, and model-facing schema.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import * as pdfExtractModule from "../../media/pdf-extract.js";
import * as webMedia from "../../media/web-media.js";
import { withEnvAsync } from "../../test-utils/env.js";
import * as modelDiscovery from "../agent-model-discovery.js";
import type { AuthProfileStore } from "../auth-profiles/types.js";
import * as modelAuth from "../model-auth.js";
import * as modelsConfig from "../models-config.js";
import * as pdfNativeProviders from "./pdf-native-providers.js";
import * as pdfModelConfigModule from "./pdf-tool.model-config.js";
import { resetPdfToolAuthEnv, withTempPdfAgentDir } from "./pdf-tool.test-support.js";

const completeMock = vi.hoisted(() => vi.fn());

vi.mock("../../llm/stream.js", async () => {
  const actual = await vi.importActual<typeof import("../../llm/stream.js")>("../../llm/stream.js");
  return {
    ...actual,
    complete: completeMock,
  };
});

type PdfToolModule = typeof import("./pdf-tool.js");
let createPdfTool: PdfToolModule["createPdfTool"];
let PdfToolSchema: PdfToolModule["PdfToolSchema"];

async function loadCreatePdfTool() {
  if (!createPdfTool || !PdfToolSchema) {
    ({ createPdfTool, PdfToolSchema } = await import("./pdf-tool.js"));
  }
  return createPdfTool;
}

const ANTHROPIC_PDF_MODEL = "anthropic/claude-opus-4-6";
const OPENAI_PDF_MODEL = "openai/gpt-5.4-mini";
const CODEX_PDF_MODEL = "openai/gpt-5.4";
const FAKE_PDF_MEDIA = {
  kind: "document",
  buffer: Buffer.from("%PDF-1.4 fake"),
  contentType: "application/pdf",
  fileName: "doc.pdf",
} as const;

function requirePdfTool(
  tool: Awaited<ReturnType<typeof loadCreatePdfTool>> extends (...args: any[]) => infer R
    ? R
    : never,
) {
  expect(typeof tool?.execute).toBe("function");
  if (!tool) {
    throw new Error("expected pdf tool");
  }
  return tool;
}

type PdfToolInstance = ReturnType<typeof requirePdfTool>;

async function withConfiguredPdfTool(
  run: (tool: PdfToolInstance, agentDir: string) => Promise<void>,
) {
  await withTempPdfAgentDir(async (agentDir) => {
    const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
    const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));
    await run(tool, agentDir);
  });
}

function withPdfModel(primary: string): OpenClawConfig {
  return {
    agents: { defaults: { pdfModel: { primary } } },
  } as OpenClawConfig;
}

function withDefaultModel(primary: string): OpenClawConfig {
  return {
    agents: { defaults: { model: { primary } } },
  } as OpenClawConfig;
}

function expectFields(value: unknown, expected: Record<string, unknown>): void {
  if (!value || typeof value !== "object") {
    throw new Error("expected fields object");
  }
  const record = value as Record<string, unknown>;
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(record[key], key).toEqual(expectedValue);
  }
}

function firstMockCall(mock: { mock: { calls: unknown[][] } }, label: string): unknown[] {
  const call = mock.mock.calls.at(0);
  if (!call) {
    throw new Error(`expected ${label} to be called`);
  }
  return call;
}

function firstCompletionContext(): { systemPrompt?: string } | undefined {
  const [, context] = firstMockCall(completeMock, "complete") as [
    unknown,
    { systemPrompt?: string } | undefined,
  ];
  return context;
}

async function stubPdfToolInfra(
  agentDir: string,
  params?: {
    mockLoad?: boolean;
    provider?: string;
    input?: string[];
    api?: string;
    modelFound?: boolean;
  },
) {
  // Keep PDF tool tests focused on orchestration; provider discovery, auth, and
  // remote media loading are replaced with narrow spies at the module boundary.
  const loadSpy = vi.spyOn(webMedia, "loadWebMediaRaw");
  if (params?.mockLoad !== false) {
    loadSpy.mockResolvedValue(FAKE_PDF_MEDIA as never);
  }

  vi.spyOn(modelDiscovery, "discoverAuthStorage").mockReturnValue({
    setRuntimeApiKey: vi.fn(),
  } as never);
  const find =
    params?.modelFound === false
      ? () => null
      : () =>
          ({
            provider: params?.provider ?? "anthropic",
            api:
              params?.api ??
              (params?.provider === "openai"
                ? "openai-chatgpt-responses"
                : params?.provider === "openai"
                  ? "openai-responses"
                  : "anthropic-messages"),
            maxTokens: 8192,
            input: params?.input ?? ["text", "document"],
          }) as never;
  vi.spyOn(modelDiscovery, "discoverModels").mockReturnValue({ find } as never);

  vi.spyOn(modelsConfig, "ensureOpenClawModelsJson").mockResolvedValue({
    agentDir,
    wrote: false,
  });

  vi.spyOn(modelAuth, "getApiKeyForModel").mockResolvedValue({ apiKey: "test-key" } as never);
  vi.spyOn(modelAuth, "requireApiKey").mockReturnValue("test-key");

  return { loadSpy };
}

async function withManagedInboundPdf(
  run: (params: { stateDir: string; mediaId: string; mediaPath: string }) => Promise<void>,
) {
  // Managed inbound PDFs live under state and may be addressed by claim-check
  // IDs or absolute paths even when workspace-only policy is active.
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pdf-managed-inbound-"));
  const inboundDir = path.join(stateDir, "media", "inbound");
  const mediaId = "claim-check-test.pdf";
  const mediaPath = path.join(inboundDir, mediaId);
  await fs.mkdir(inboundDir, { recursive: true });
  await fs.writeFile(mediaPath, FAKE_PDF_MEDIA.buffer);
  try {
    await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
      await run({ stateDir, mediaId, mediaPath });
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("createPdfTool", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    resetPdfToolAuthEnv();
    completeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = priorFetch;
  });

  it("returns null without agentDir and no explicit config", async () => {
    expect((await loadCreatePdfTool())()).toBeNull();
  });

  it("throws when agentDir missing but explicit config present", async () => {
    const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
    const createTool = await loadCreatePdfTool();
    expect(() => createTool({ config: cfg })).toThrow("requires agentDir");
  });

  it("creates tool when a PDF model is configured", async () => {
    await withConfiguredPdfTool(async (tool) => {
      expect(tool.name).toBe("pdf");
      expect(tool.label).toBe("PDF");
      expect(tool.description).toContain("Analyze PDFs");
    });
  });

  it("defers automatic model config resolution during registration (#76644)", async () => {
    const resolveSpy = vi.spyOn(pdfModelConfigModule, "resolvePdfModelConfigForTool");
    const cfg = withDefaultModel("openai/gpt-5.4");
    const authProfileStore = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "test-key",
        },
      },
    } satisfies AuthProfileStore;
    const createTool = await loadCreatePdfTool();
    await withTempPdfAgentDir(async (agentDir) => {
      expect(
        createTool({
          config: cfg,
          agentDir,
          authProfileStore,
          deferAutoModelResolution: true,
        })?.name,
      ).toBe("pdf");
      expect(resolveSpy).not.toHaveBeenCalled();
    });
    resolveSpy.mockRestore();
  });

  it("keeps explicit model config resolution eager even when automatic resolution is deferred", async () => {
    const resolveSpy = vi.spyOn(pdfModelConfigModule, "resolvePdfModelConfigForTool");
    const createTool = await loadCreatePdfTool();
    await withTempPdfAgentDir(async (agentDir) => {
      expect(
        createTool({
          config: withPdfModel(ANTHROPIC_PDF_MODEL),
          agentDir,
          deferAutoModelResolution: true,
        })?.name,
      ).toBe("pdf");
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });
    resolveSpy.mockRestore();
  });

  it("resolves deferred model config on execution before loading PDFs", async () => {
    const resolveSpy = vi
      .spyOn(pdfModelConfigModule, "resolvePdfModelConfigForTool")
      .mockReturnValue(null);
    const loadSpy = vi.spyOn(webMedia, "loadWebMediaRaw");
    const createTool = await loadCreatePdfTool();
    const cfg = withDefaultModel("openai/gpt-5.4");
    await withTempPdfAgentDir(async (agentDir) => {
      const tool = requirePdfTool(
        createTool({
          config: cfg,
          agentDir,
          deferAutoModelResolution: true,
        }),
      );
      await expect(
        tool.execute("t1", {
          prompt: "summarize",
          pdf: "/tmp/doc.pdf",
        }),
      ).rejects.toThrow("No PDF model configured.");
    });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });

  it("rejects when no pdf input provided", async () => {
    await withConfiguredPdfTool(async (tool) => {
      await expect(tool.execute("t1", { prompt: "test" })).rejects.toThrow("pdf required");
    });
  });

  it("rejects too many PDFs", async () => {
    await withConfiguredPdfTool(async (tool) => {
      const manyPdfs = Array.from({ length: 15 }, (_, i) => `/tmp/doc${i}.pdf`);
      const result = await tool.execute("t1", { prompt: "test", pdfs: manyPdfs });
      expectFields(result.details, { error: "too_many_pdfs" });
    });
  });

  it("rejects invalid maxBytesMb before loading PDFs", async () => {
    await withConfiguredPdfTool(async (tool) => {
      const loadSpy = vi.spyOn(webMedia, "loadWebMediaRaw");

      await expect(
        tool.execute("t1", {
          prompt: "test",
          pdf: "/tmp/doc.pdf",
          maxBytesMb: 0,
        }),
      ).rejects.toThrow("maxBytesMb must be greater than 0");
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  it("passes validated maxBytesMb to PDF loading", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, {
        provider: "anthropic",
        input: ["text", "document"],
      });
      vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
        maxBytesMb: "0.5",
      });

      const [, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
      expectFields(loadOptions, { maxBytes: 524_288 });
    });
  });

  it("clamps a configured pdfMaxBytesMb down to the engine ceiling", async () => {
    // The fleet configures 1024MB, which PDFium's 2GiB WASM heap cannot honor.
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, { provider: "anthropic" });
      vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
      const cfg = {
        agents: { defaults: { pdfModel: { primary: ANTHROPIC_PDF_MODEL }, pdfMaxBytesMb: 1024 } },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", { prompt: "summarize", pdf: "/tmp/doc.pdf" });

      const [, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
      expectFields(loadOptions, { maxBytes: 768 * 1024 * 1024 });
    });
  });

  it("processes a PDF past the V8 base64 ceiling without encoding it", async () => {
    // 385MiB is over the hard 384MB limit: base64 inflates 4/3 and V8 caps a string at
    // 0x1fffffe8 chars, so any toString("base64") on this buffer throws rather than
    // merely wasting memory. allocUnsafe leaves the pages untouched, so the fixture is
    // cheap unless something actually reads it.
    const oversized = Buffer.allocUnsafe(385 * 1024 * 1024);
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, { provider: "anthropic" });
      loadSpy.mockResolvedValue({
        kind: "document",
        buffer: oversized,
        contentType: "application/pdf",
        fileName: "compiled-bid-set.pdf",
      } as never);
      const nativeSpy = vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf");
      const extractSpy = vi
        .spyOn(pdfExtractModule, "extractPdfContent")
        .mockResolvedValue({ text: "Sheet index", images: [] });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "bid set summary" }],
      } as never);
      const toStringSpy = vi.spyOn(Buffer.prototype, "toString");

      const cfg = {
        agents: {
          defaults: { pdfModel: { primary: ANTHROPIC_PDF_MODEL }, pdfMaxBytesMb: 512 },
        },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "list the sheets",
        pdf: "/tmp/compiled-bid-set.pdf",
      });

      // Native inline is skipped, so the run completes through local extraction.
      expect(result.content).toEqual([{ type: "text", text: "bid set summary" }]);
      expectFields(result.details, { native: false });
      expect(nativeSpy).not.toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalledTimes(1);

      // No allocation proportional to the file: nothing base64-encodes the PDF bytes.
      const encodedFileSized = toStringSpy.mock.calls.some((args, index) => {
        // contexts, not instances: vitest documents `instances` as receivers from `new`,
        // and this needs the `this` of each call.
        const target = toStringSpy.mock.contexts[index] as Buffer | undefined;
        return args[0] === "base64" && (target?.byteLength ?? 0) > 64 * 1024 * 1024;
      });
      expect(encodedFileSized).toBe(false);
    });
  });

  it("skips native inline when several PDFs each fit the cap but their one request does not", async () => {
    // All PDFs in a call share ONE provider request, so the budget is their combined
    // encoded size. 3 x 12MiB raw = 36MiB -> 48MiB base64, over anthropic's 32MB request
    // cap, while every individual file is far under it. A per-file check passes this and
    // builds a 48MiB string; the aggregate check must not.
    const perFile = Buffer.allocUnsafe(12 * 1024 * 1024);
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, { provider: "anthropic" });
      loadSpy.mockResolvedValue({
        kind: "document",
        buffer: perFile,
        contentType: "application/pdf",
        fileName: "sheet.pdf",
      } as never);
      const nativeSpy = vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf");
      const extractSpy = vi
        .spyOn(pdfExtractModule, "extractPdfContent")
        .mockResolvedValue({ text: "Sheet index", images: [] });
      completeMock.mockResolvedValue({
        stopReason: "stop",
        content: [{ type: "text", text: "combined summary" }],
      } as never);

      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "list the sheets",
        pdfs: ["/tmp/a.pdf", "/tmp/b.pdf", "/tmp/c.pdf"],
      });

      expect(result.content).toEqual([{ type: "text", text: "combined summary" }]);
      expectFields(result.details, { native: false });
      expect(nativeSpy).not.toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalledTimes(3);
    });
  });

  it("respects fsPolicy.workspaceOnly for non-sandbox pdf paths", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pdf-ws-"));
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pdf-out-"));
      try {
        const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
        const tool = requirePdfTool(
          (await loadCreatePdfTool())({
            config: cfg,
            agentDir,
            workspaceDir,
            fsPolicy: { workspaceOnly: true },
          }),
        );

        const outsidePdf = path.join(outsideDir, "secret.pdf");
        await fs.writeFile(outsidePdf, "%PDF-1.4 fake");

        await expect(tool.execute("t1", { prompt: "test", pdf: outsidePdf })).rejects.toThrow(
          /not under an allowed directory/i,
        );
      } finally {
        await fs.rm(workspaceDir, { recursive: true, force: true });
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("rejects unsupported scheme references", async () => {
    await withConfiguredPdfTool(async (tool) => {
      const result = await tool.execute("t1", {
        prompt: "test",
        pdf: "ftp://example.com/doc.pdf",
      });
      expectFields(result.details, { error: "unsupported_pdf_reference" });
    });
  });

  it("resolves media://inbound PDF refs", async () => {
    await withManagedInboundPdf(async ({ mediaId }) => {
      await withTempPdfAgentDir(async (agentDir) => {
        const { loadSpy } = await stubPdfToolInfra(agentDir, {
          mockLoad: false,
          provider: "anthropic",
          input: ["text", "document"],
        });
        vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
        const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
        const tool = requirePdfTool(
          (await loadCreatePdfTool())({
            config: cfg,
            agentDir,
            fsPolicy: { workspaceOnly: true },
          }),
        );

        const result = await tool.execute("t1", {
          prompt: "summarize",
          pdf: `media://inbound/${mediaId}`,
        });

        const [loadRef, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
        expect(loadRef).toBe(`media://inbound/${mediaId}`);
        expectFields(loadOptions, { localRoots: [] });
        expect(result.content).toEqual([{ type: "text", text: "native summary" }]);
        expectFields(result.details, {
          native: true,
          model: ANTHROPIC_PDF_MODEL,
        });
      });
    });
  });

  it("passes web_fetch SSRF policy when loading remote PDFs", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, {
        provider: "anthropic",
        input: ["text", "document"],
      });
      vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
      const cfg: OpenClawConfig = {
        ...withPdfModel(ANTHROPIC_PDF_MODEL),
        tools: {
          web: {
            fetch: {
              ssrfPolicy: { allowRfc2544BenchmarkRange: true },
            },
          },
        },
      };
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "summarize",
        pdf: "http://198.18.0.153/doc.pdf",
      });

      const [loadRef, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
      expect(loadRef).toBe("http://198.18.0.153/doc.pdf");
      expectFields(loadOptions, {
        readIdleTimeoutMs: 120_000,
        ssrfPolicy: { allowRfc2544BenchmarkRange: true },
      });
    });
  });

  it("passes the shared remote read idle timeout when loading remote PDFs", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      const { loadSpy } = await stubPdfToolInfra(agentDir, {
        provider: "anthropic",
        input: ["text", "document"],
      });
      vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "summarize",
        pdf: "https://example.com/stalled.pdf",
      });

      const [loadRef, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
      expect(loadRef).toBe("https://example.com/stalled.pdf");
      expectFields(loadOptions, {
        readIdleTimeoutMs: 120_000,
      });
    });
  });

  it("allows managed inbound absolute PDF paths when workspaceOnly is enabled", async () => {
    await withManagedInboundPdf(async ({ mediaPath }) => {
      await withTempPdfAgentDir(async (agentDir) => {
        const { loadSpy } = await stubPdfToolInfra(agentDir, {
          mockLoad: false,
          provider: "anthropic",
          input: ["text", "document"],
        });
        vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
        const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
        const tool = requirePdfTool(
          (await loadCreatePdfTool())({
            config: cfg,
            agentDir,
            fsPolicy: { workspaceOnly: true },
          }),
        );

        await tool.execute("t1", {
          prompt: "summarize",
          pdf: mediaPath,
        });

        const [loadRef, loadOptions] = firstMockCall(loadSpy, "loadWebMediaRaw");
        expect(loadRef).toBe(mediaPath);
        expect(loadOptions).toBeTypeOf("object");
      });
    });
  });

  it("uses native PDF path without eager extraction", async () => {
    // Document-capable providers receive the PDF bytes directly; extraction is
    // reserved for text-only model paths.
    await withTempPdfAgentDir(async (agentDir) => {
      const workspaceDir = path.join(agentDir, "workspace");
      await stubPdfToolInfra(agentDir, { provider: "anthropic", input: ["text", "document"] });
      vi.spyOn(pdfNativeProviders, "anthropicAnalyzePdf").mockResolvedValue("native summary");
      const extractSpy = vi.spyOn(pdfExtractModule, "extractPdfContent");
      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool(
        (await loadCreatePdfTool())({ config: cfg, agentDir, workspaceDir }),
      );

      const result = await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
      });

      const ensureModelsJsonMock = vi.mocked(modelsConfig.ensureOpenClawModelsJson);
      const [modelsConfigArg, modelsAgentDir, modelsOptions] = firstMockCall(
        ensureModelsJsonMock,
        "ensureOpenClawModelsJson",
      );
      expectFields(
        (modelsConfigArg as { agents?: { defaults?: unknown } } | undefined)?.agents?.defaults,
        {
          pdfModel: { primary: ANTHROPIC_PDF_MODEL },
        },
      );
      expect(modelsAgentDir).toBe(agentDir);
      expect(modelsOptions).toEqual({ workspaceDir });
      expect(modelDiscovery.discoverModels).toHaveBeenCalledWith(expect.anything(), agentDir, {
        workspaceDir,
      });
      expect(extractSpy).not.toHaveBeenCalled();
      expect(result.content).toEqual([{ type: "text", text: "native summary" }]);
      expectFields(result.details, {
        native: true,
        model: ANTHROPIC_PDF_MODEL,
      });
    });
  });

  it("rejects pages parameter for native PDF providers", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, { provider: "anthropic", input: ["text", "document"] });
      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await expect(
        tool.execute("t1", {
          prompt: "summarize",
          pdf: "/tmp/doc.pdf",
          pages: "1-2",
        }),
      ).rejects.toThrow("pages is not supported with native PDF providers");
    });
  });

  it("rejects password parameter for native PDF providers", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, { provider: "anthropic", input: ["text", "document"] });
      const cfg = withPdfModel(ANTHROPIC_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await expect(
        tool.execute("t1", {
          prompt: "summarize",
          pdf: "/tmp/doc.pdf",
          password: "secret",
        }),
      ).rejects.toThrow("password is not supported with native PDF providers");
    });
  });

  it("uses extraction fallback for non-native models", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-responses",
        input: ["text"],
      });
      const extractSpy = vi.spyOn(pdfExtractModule, "extractPdfContent").mockResolvedValue({
        text: "Extracted content",
        images: [],
      });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "fallback summary" }],
      } as never);

      const cfg = withPdfModel(OPENAI_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
      });

      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(result.content).toEqual([{ type: "text", text: "fallback summary" }]);
      expectFields(result.details, {
        native: false,
        model: OPENAI_PDF_MODEL,
      });
      expect(firstCompletionContext()?.systemPrompt).toBeUndefined();
    });
  });

  it("reads a 59-page PDF in bounded batches and reports complete coverage", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-responses",
        input: ["text"],
      });
      const extractSpy = vi
        .spyOn(pdfExtractModule, "extractPdfContent")
        .mockImplementation(async ({ pageNumbers }) => {
          const requestedPages = pageNumbers ?? [];
          return {
            text: `Sheets ${requestedPages.at(0)}-${requestedPages.at(-1)}`,
            images: [],
            coverage: {
              documentPageCount: 59,
              requestedPages,
              pagesProcessed: requestedPages,
              complete: requestedPages.length === 59,
              textChars: 20,
              textBytes: 20,
              maxTextChars: 200_000,
              truncationReasons: requestedPages.length === 59 ? [] : ["page_limit"],
            },
          };
        });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "E4.101 and S-301 are present." }],
      } as never);

      const cfg = {
        agents: {
          defaults: {
            pdfModel: { primary: OPENAI_PDF_MODEL },
            pdfMaxPages: 120,
          },
        },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "List every discipline and sheet.",
        pdf: "/tmp/merged-set.pdf",
      });

      expect(extractSpy).toHaveBeenCalledTimes(6);
      expect(extractSpy.mock.calls.map(([args]) => args.pageNumbers)).toEqual([
        Array.from({ length: 10 }, (_, index) => index + 1),
        Array.from({ length: 10 }, (_, index) => index + 11),
        Array.from({ length: 10 }, (_, index) => index + 21),
        Array.from({ length: 10 }, (_, index) => index + 31),
        Array.from({ length: 10 }, (_, index) => index + 41),
        Array.from({ length: 9 }, (_, index) => index + 51),
      ]);
      expect(completeMock).toHaveBeenCalledTimes(7);
      expect(result.content).toEqual([
        {
          type: "text",
          text: expect.stringContaining("PDF coverage: processed pages 1-59 of 59."),
        },
      ]);
      expectFields(result.details, {
        native: false,
        status: "ok",
        coverage: [
          expect.objectContaining({
            documentPageCount: 59,
            pagesProcessed: Array.from({ length: 59 }, (_, index) => index + 1),
            complete: true,
            truncationReasons: [],
          }),
        ],
      });
    });
  });

  it("splits a dense batch when the extractor hits the text limit", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-responses",
        input: ["text"],
      });
      const extractSpy = vi
        .spyOn(pdfExtractModule, "extractPdfContent")
        .mockImplementation(async ({ pageNumbers }) => {
          const requestedPages = pageNumbers ?? [];
          const textLimited = requestedPages.length === 10;
          return {
            text: `Sheets ${requestedPages.at(0)}-${requestedPages.at(-1)}`,
            images: [],
            coverage: {
              documentPageCount: 12,
              requestedPages,
              pagesProcessed: textLimited ? requestedPages.slice(0, 7) : requestedPages,
              complete: !textLimited && requestedPages.length === 12,
              textChars: textLimited ? 200_000 : 20,
              textBytes: textLimited ? 200_000 : 20,
              maxTextChars: 200_000,
              truncationReasons: textLimited ? ["text_limit"] : ["page_limit"],
            },
          };
        });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "All requested sheets were reviewed." }],
      } as never);

      const cfg = {
        agents: {
          defaults: {
            pdfModel: { primary: OPENAI_PDF_MODEL },
            pdfMaxPages: 120,
          },
        },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "List every sheet.",
        pdf: "/tmp/dense-set.pdf",
      });

      expect(extractSpy.mock.calls.map(([args]) => args.pageNumbers)).toEqual([
        Array.from({ length: 10 }, (_, index) => index + 1),
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12],
      ]);
      expectFields(result.details, {
        status: "ok",
        coverage: [
          expect.objectContaining({
            documentPageCount: 12,
            pagesProcessed: Array.from({ length: 12 }, (_, index) => index + 1),
            complete: true,
            truncationReasons: [],
          }),
        ],
      });
    });
  });

  it("surfaces a partial read and forbids document-wide absence claims", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-responses",
        input: ["text"],
      });
      vi.spyOn(pdfExtractModule, "extractPdfContent").mockImplementation(
        async ({ pageNumbers }) => {
          const requestedPages = pageNumbers ?? [];
          return {
            text: "A-series sheets only",
            images: [],
            coverage: {
              documentPageCount: 59,
              requestedPages,
              pagesProcessed: requestedPages,
              complete: false,
              textChars: 20,
              textBytes: 20,
              maxTextChars: 200_000,
              truncationReasons: ["page_limit"],
            },
          };
        },
      );
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "I found architectural sheets." }],
      } as never);

      const cfg = {
        agents: {
          defaults: {
            pdfModel: { primary: OPENAI_PDF_MODEL },
            pdfMaxPages: 20,
          },
        },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "Are there any electrical sheets?",
        pdf: "/tmp/merged-set.pdf",
      });

      expect(result.content).toEqual([
        {
          type: "text",
          text: expect.stringContaining(
            "Partial PDF read: processed pages 1-20 of 59. Do not infer that omitted sheets or terms are absent.",
          ),
        },
      ]);
      expectFields(result.details, {
        native: false,
        status: "partial",
        coverage: [
          expect.objectContaining({
            documentPageCount: 59,
            pagesProcessed: Array.from({ length: 20 }, (_, index) => index + 1),
            complete: false,
            truncationReasons: ["page_limit"],
          }),
        ],
      });
      const finalContext = completeMock.mock.calls.at(-1)?.[1] as
        | { messages?: Array<{ content?: Array<{ text?: string }> }> }
        | undefined;
      expect(JSON.stringify(finalContext)).toContain("must not claim that a sheet");
    });
  });

  it("adds the coverage warning to a single partial extraction prompt", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-responses",
        input: ["text"],
      });
      vi.spyOn(pdfExtractModule, "extractPdfContent").mockImplementation(
        async ({ pageNumbers }) => {
          const requestedPages = pageNumbers ?? [];
          return {
            text: "A-series sheets only",
            images: [],
            coverage: {
              documentPageCount: 59,
              requestedPages,
              pagesProcessed: requestedPages,
              complete: false,
              textChars: 20,
              textBytes: 20,
              maxTextChars: 200_000,
              truncationReasons: ["page_limit"],
            },
          };
        },
      );
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "I found architectural sheets." }],
      } as never);

      const cfg = {
        agents: {
          defaults: {
            pdfModel: { primary: OPENAI_PDF_MODEL },
            pdfMaxPages: 10,
          },
        },
      } as OpenClawConfig;
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "Are there any electrical sheets?",
        pdf: "/tmp/merged-set.pdf",
      });

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(completeMock.mock.calls[0]?.[1])).toContain(
        "must not claim that a sheet",
      );
    });
  });

  it("passes password to PDF extraction fallback", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, { provider: "openai", input: ["text"] });
      const extractSpy = vi.spyOn(pdfExtractModule, "extractPdfContent").mockResolvedValue({
        text: "Encrypted content",
        images: [],
      });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "fallback summary" }],
      } as never);

      const cfg = withPdfModel(OPENAI_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
        password: "secret",
      });

      expect(extractSpy).toHaveBeenCalledWith(expect.objectContaining({ password: "secret" }));
    });
  });

  it("preserves PDF password whitespace before extraction fallback", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, { provider: "openai", input: ["text"] });
      const extractSpy = vi.spyOn(pdfExtractModule, "extractPdfContent").mockResolvedValue({
        text: "Plain content",
        images: [],
      });
      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "fallback summary" }],
      } as never);

      const cfg = withPdfModel(OPENAI_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
        password: " secret ",
      });

      expect(extractSpy).toHaveBeenCalledWith(expect.objectContaining({ password: " secret " }));
    });
  });

  it("adds Codex instructions for PDF extraction fallback requests", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-chatgpt-responses",
        input: ["text", "image"],
      });

      vi.spyOn(pdfExtractModule, "extractPdfContent").mockResolvedValue({
        text: "Extracted content",
        images: [],
      });

      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "codex summary" }],
      } as never);

      const cfg = withPdfModel(CODEX_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
      });

      expect(result.content).toEqual([{ type: "text", text: "codex summary" }]);
      expectFields(result.details, {
        native: false,
        model: CODEX_PDF_MODEL,
      });
      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(firstCompletionContext()?.systemPrompt).toContain("Analyze the provided PDF content");
    });
  });

  it("adds Codex instructions when extraction has images but the model only accepts text", async () => {
    await withTempPdfAgentDir(async (agentDir) => {
      await stubPdfToolInfra(agentDir, {
        provider: "openai",
        api: "openai-chatgpt-responses",
        input: ["text"],
      });

      vi.spyOn(pdfExtractModule, "extractPdfContent").mockResolvedValue({
        text: "Extracted content",
        images: [{ type: "image", data: "base64img", mimeType: "image/png" }],
      });

      completeMock.mockResolvedValue({
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "codex summary" }],
      } as never);

      const cfg = withPdfModel(CODEX_PDF_MODEL);
      const tool = requirePdfTool((await loadCreatePdfTool())({ config: cfg, agentDir }));

      const result = await tool.execute("t1", {
        prompt: "summarize",
        pdf: "/tmp/doc.pdf",
      });

      expect(result.content).toEqual([{ type: "text", text: "codex summary" }]);
      expectFields(result.details, {
        native: false,
        model: CODEX_PDF_MODEL,
      });
      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(firstCompletionContext()?.systemPrompt).toContain("Analyze the provided PDF content");
    });
  });

  it("tool parameters have correct schema shape", async () => {
    await loadCreatePdfTool();
    const schema = PdfToolSchema;
    expect(schema.type).toBe("object");
    expect(schema).toHaveProperty("properties");
    const props = schema.properties as Record<string, { type?: string }>;
    expect(props).toHaveProperty("prompt");
    expect(props).toHaveProperty("pdf");
    expect(props).toHaveProperty("pdfs");
    expect(props).toHaveProperty("pages");
    expect(props).toHaveProperty("password");
    expect(props).toHaveProperty("model");
    expect(props).toHaveProperty("maxBytesMb");
    expect(PdfToolSchema.properties.maxBytesMb).toMatchObject({
      type: "number",
      exclusiveMinimum: 0,
    });
  });
});
