// PDF tool helper tests cover page ranges, PDF input normalization, provider
// capability checks, and assistant text coercion.
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

const pdfMetadataPlugins = vi.hoisted(() => [
  {
    contracts: {
      mediaUnderstandingProviders: ["anthropic", "google", "openai"],
    },
    mediaUnderstandingProviderMetadata: {
      anthropic: { capabilities: ["image"], nativeDocumentInputs: ["pdf"] },
      google: { capabilities: ["image"], nativeDocumentInputs: ["pdf"] },
      openai: { capabilities: ["image"], nativeDocumentInputs: [] },
    },
  },
]);

vi.mock("../../plugins/plugin-registry.js", () => ({
  loadPluginManifestRegistryForPluginRegistry: () => ({
    plugins: pdfMetadataPlugins,
    diagnostics: [],
  }),
  loadPluginRegistrySnapshotWithMetadata: () => ({
    source: "derived",
    snapshot: { plugins: [] },
    diagnostics: [],
  }),
}));

vi.mock("../../plugins/current-plugin-metadata-snapshot.js", () => ({
  getCurrentPluginMetadataSnapshot: () => ({
    plugins: pdfMetadataPlugins,
  }),
}));

import {
  coercePdfAssistantText,
  coercePdfModelConfig,
  parsePageRange,
  providerSupportsNativePdf,
  resolvePdfInputs,
  resolvePdfToolMaxTokens,
} from "./pdf-tool.helpers.js";

const ANTHROPIC_PDF_MODEL = "anthropic/claude-opus-4-7";

function pages(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

describe("parsePageRange", () => {
  it("parses a single page number", () => {
    expect(parsePageRange("3", 20)).toEqual({ pages: [3], skipped: [] });
  });

  it("parses a page range", () => {
    expect(parsePageRange("1-5", 20)).toEqual({ pages: [1, 2, 3, 4, 5], skipped: [] });
  });

  it("parses comma-separated pages and ranges", () => {
    expect(parsePageRange("1,3,5-7", 20)).toEqual({ pages: [1, 3, 5, 6, 7], skipped: [] });
  });

  it("accepts page numbers above maxPages", () => {
    expect(parsePageRange("200-300", 120)).toEqual({ pages: pages(200, 300), skipped: [] });
    expect(parsePageRange("200", 120)).toEqual({ pages: [200], skipped: [] });
  });

  it("caps the page count at maxPages and reports the rest as skipped", () => {
    expect(parsePageRange("1-500", 120)).toEqual({ pages: pages(1, 120), skipped: [[121, 500]] });
    expect(parsePageRange("121-280", 120)).toEqual({
      pages: pages(121, 240),
      skipped: [[241, 280]],
    });
  });

  it("caps huge ranges without materializing them", () => {
    const started = performance.now();
    expect(parsePageRange("1-1000000000", 120)).toEqual({
      pages: pages(1, 120),
      skipped: [[121, 1_000_000_000]],
    });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("merges overlapping segments before applying the cap", () => {
    expect(parsePageRange("1-5,3-8,20", 4)).toEqual({
      pages: [1, 2, 3, 4],
      skipped: [
        [5, 8],
        [20, 20],
      ],
    });
  });

  it("deduplicates and sorts", () => {
    expect(parsePageRange("5,3,1,3,5", 20)).toEqual({ pages: [1, 3, 5], skipped: [] });
    expect(parsePageRange("5,3,3,1-2", 120)).toEqual({ pages: [1, 2, 3, 5], skipped: [] });
  });

  it("throws on invalid page number", () => {
    expect(() => parsePageRange("abc", 20)).toThrow("Invalid page number");
  });

  it("throws on invalid range (start > end)", () => {
    expect(() => parsePageRange("5-3", 20)).toThrow("Invalid page range");
  });

  it("throws on zero page number", () => {
    expect(() => parsePageRange("0", 20)).toThrow("Invalid page number");
  });

  it("throws on negative page number", () => {
    expect(() => parsePageRange("-1", 20)).toThrow("Invalid page number");
  });

  it("handles empty parts gracefully", () => {
    expect(parsePageRange("1,,3", 20)).toEqual({ pages: [1, 3], skipped: [] });
  });

  it("throws when no pages match", () => {
    expect(() => parsePageRange("", 20)).toThrow('No PDF pages matched requested range ""');
    expect(() => parsePageRange(",", 20)).toThrow('No PDF pages matched requested range ","');
    expect(() => parsePageRange("1-5", 0)).toThrow('No PDF pages matched requested range "1-5"');
  });
});

describe("providerSupportsNativePdf", () => {
  it("returns true for anthropic", () => {
    // Native PDF support is derived from plugin metadata, not a hard-coded
    // provider allowlist in the helper.
    expect(providerSupportsNativePdf("anthropic")).toBe(true);
  });

  it("returns true for google", () => {
    expect(providerSupportsNativePdf("google")).toBe(true);
  });

  it("returns false for openai", () => {
    expect(providerSupportsNativePdf("openai")).toBe(false);
  });

  it("returns false for minimax", () => {
    expect(providerSupportsNativePdf("minimax")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(providerSupportsNativePdf("Anthropic")).toBe(true);
    expect(providerSupportsNativePdf("GOOGLE")).toBe(true);
  });
});

describe("pdf-tool.helpers", () => {
  it("resolvePdfInputs requires at least one pdf reference", () => {
    expect(() => resolvePdfInputs({ prompt: "test" })).toThrow("pdf required");
  });

  it("resolvePdfInputs deduplicates pdf and pdfs entries", () => {
    // `pdf` and `pdfs` are both public inputs; normalize them to one ordered
    // list before any filesystem or provider work begins.
    expect(
      resolvePdfInputs({
        pdf: " /tmp/nonexistent.pdf ",
        pdfs: ["/tmp/nonexistent.pdf", "  ", "/tmp/other.pdf"],
      }),
    ).toEqual(["/tmp/nonexistent.pdf", "/tmp/other.pdf"]);
  });

  it("resolvePdfToolMaxTokens respects model limit", () => {
    expect(resolvePdfToolMaxTokens(2048, 4096)).toBe(2048);
    expect(resolvePdfToolMaxTokens(8192, 4096)).toBe(4096);
    expect(resolvePdfToolMaxTokens(undefined, 4096)).toBe(4096);
  });

  it("coercePdfModelConfig reads primary and fallbacks", () => {
    const cfg = {
      agents: {
        defaults: {
          pdfModel: {
            primary: ANTHROPIC_PDF_MODEL,
            fallbacks: ["google/gemini-2.5-pro"],
          },
        },
      },
    } as OpenClawConfig;
    expect(coercePdfModelConfig(cfg)).toEqual({
      primary: ANTHROPIC_PDF_MODEL,
      fallbacks: ["google/gemini-2.5-pro"],
    });
  });

  it("coercePdfAssistantText returns trimmed text", () => {
    expect(
      coercePdfAssistantText({
        provider: "anthropic",
        model: "claude-opus-4-7",
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text: "  summary  " }],
        } as never,
      }),
    ).toBe("summary");
  });

  it("coercePdfAssistantText throws clear error for failed model output", () => {
    expect(() =>
      coercePdfAssistantText({
        provider: "google",
        model: "gemini-2.5-pro",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "bad request",
          content: [],
        } as never,
      }),
    ).toThrow("PDF model failed (google/gemini-2.5-pro): bad request");
  });
});
