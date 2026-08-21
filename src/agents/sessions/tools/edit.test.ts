// Edit tool tests cover exact-match diagnostics, post-write recovery, newline
// preservation, and preview rendering for custom operations.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import { createEditTool, createEditToolDefinition, type EditOperations } from "./edit.js";
import type { EditToolInput } from "./tool-contracts.js";

const testTheme = {
  bg: (_name: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_name: string, text: string) => text,
} as Theme;

describe("edit tool", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function createTempFile(content: string) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-edit-tool-"));
    const filePath = path.join(tmpDir, "demo.txt");
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  it("adds current file contents to exact-match mismatch errors", async () => {
    const filePath = await createTempFile("actual current content");
    const tool = createEditTool(tmpDir);

    await expect(
      tool.execute(
        "call-1",
        { path: filePath, edits: [{ oldText: "missing", newText: "replacement" }] },
        undefined,
      ),
    ).rejects.toThrow(/Current file contents:\nactual current content/);
  });

  it("recovers success after a post-write throw when the edit already applied", async () => {
    // Some backends throw after flushing content; a readback match is the
    // contract that lets the tool report success without duplicating edits.
    const filePath = await createTempFile('const value = "foo";\r\n');
    const operations: EditOperations = {
      access: async (absolutePath) => {
        await fs.access(absolutePath);
      },
      readFile: (absolutePath) => fs.readFile(absolutePath),
      writeFile: async (absolutePath, content) => {
        await fs.writeFile(absolutePath, content, "utf-8");
        throw new Error("Simulated post-write failure");
      },
    };
    const tool = createEditTool(tmpDir, { operations });

    const result = await tool.execute(
      "call-1",
      {
        path: filePath,
        edits: [
          {
            oldText: 'const value = "foo";\n',
            newText: 'const value = "foobar";\n',
          },
        ],
      },
      undefined,
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: `Successfully replaced 1 block(s) in ${filePath}.`,
    });
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe('const value = "foobar";\r\n');
  });

  it("does not recover false success when the file never changed", async () => {
    const filePath = await createTempFile("old replacement already present");
    const operations: EditOperations = {
      access: async (absolutePath) => {
        await fs.access(absolutePath);
      },
      readFile: (absolutePath) => fs.readFile(absolutePath),
      writeFile: async () => {
        throw new Error("Simulated write failure");
      },
    };
    const tool = createEditTool(tmpDir, { operations });

    await expect(
      tool.execute(
        "call-1",
        {
          path: filePath,
          edits: [{ oldText: "old", newText: "replacement already present" }],
        },
        undefined,
      ),
    ).rejects.toThrow("Simulated write failure");
  });

  it("recovers multi-edit post-write failures", async () => {
    const filePath = await createTempFile("alpha beta gamma delta\n");
    const operations: EditOperations = {
      access: async (absolutePath) => {
        await fs.access(absolutePath);
      },
      readFile: (absolutePath) => fs.readFile(absolutePath),
      writeFile: async (absolutePath, content) => {
        await fs.writeFile(absolutePath, content, "utf-8");
        throw new Error("Simulated post-write failure");
      },
    };
    const tool = createEditTool(tmpDir, { operations });

    const result = await tool.execute(
      "call-1",
      {
        path: filePath,
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "delta", newText: "DELTA" },
        ],
      },
      undefined,
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: `Successfully replaced 2 block(s) in ${filePath}.`,
    });
  });

  it("renders previews through custom edit operations", async () => {
    // Preview rendering must use injected operations so remote/sandbox files are
    // shown without accidentally reading from the host filesystem.
    const readFile = vi.fn(async () => Buffer.from("remote original\n"));
    const operations: EditOperations = {
      access: async () => {},
      readFile,
      writeFile: async () => {},
    };
    const tool = createEditToolDefinition("/workspace", { operations });
    const args = {
      path: "remote.txt",
      edits: [{ oldText: "remote original", newText: "remote changed" }],
    };
    const context = {
      args,
      argsComplete: true,
      cwd: "/workspace",
      executionStarted: false,
      expanded: false,
      invalidate: vi.fn(),
      isError: false,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "call-preview",
    };

    const component = tool.renderCall?.(args, testTheme, context);
    await vi.waitFor(() => expect(context.invalidate).toHaveBeenCalled());

    expect(readFile).toHaveBeenCalledWith(path.join("/workspace", "remote.txt"));
    expect((component as { preview?: { diff?: string } } | undefined)?.preview?.diff).toContain(
      "remote changed",
    );
  });

  it("renders a preview for snake_case aliases (the live streamed args never run through prepareArguments)", async () => {
    const readFile = vi.fn(async () => Buffer.from("remote original\n"));
    const operations: EditOperations = {
      access: async () => {},
      readFile,
      writeFile: async () => {},
    };
    const tool = createEditToolDefinition("/workspace", { operations });
    const args = {
      file_path: "remote.txt",
      edits: [{ old_string: "remote original", new_string: "remote changed" }],
    };
    const context = {
      args,
      argsComplete: true,
      cwd: "/workspace",
      executionStarted: false,
      expanded: false,
      invalidate: vi.fn(),
      isError: false,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "call-preview-alias",
    };

    const component = tool.renderCall?.(args, testTheme, context);
    await vi.waitFor(() => expect(context.invalidate).toHaveBeenCalled());

    expect(readFile).toHaveBeenCalledWith(path.join("/workspace", "remote.txt"));
    expect((component as { preview?: { diff?: string } } | undefined)?.preview?.diff).toContain(
      "remote changed",
    );
  });
});

// editSchema/replaceEditSchema are additionalProperties: false, so
// Claude-Code-style names (file_path, old_string, new_string) — which the
// tool's own TUI renderers already read, e.g. RenderableEditArgs.file_path —
// were hard schema rejections. prepareArguments now aliases them the same way
// it already rescues top-level oldText/newText and a stringified edits[].
describe("prepareEditArguments alias normalization", () => {
  function prepare(input: unknown): EditToolInput {
    const definition = createEditToolDefinition("/workspace");
    return definition.prepareArguments?.(input) as EditToolInput;
  }

  it("never mutates the caller's raw arguments object", () => {
    const raw = {
      file_path: "notes.txt",
      edits: [{ old_string: "alpha", new_string: "ALPHA" }],
    };
    const snapshot = structuredClone(raw);
    prepare(raw);
    expect(raw).toEqual(snapshot);
  });

  it("maps file_path to path", () => {
    const prepared = prepare({
      file_path: "notes.txt",
      edits: [{ oldText: "a", newText: "b" }],
    });
    expect(prepared).toEqual({
      path: "notes.txt",
      edits: [{ oldText: "a", newText: "b" }],
    });
  });

  it("does not override an explicit path with file_path", () => {
    const prepared = prepare({
      path: "real.txt",
      file_path: "ignored.txt",
      edits: [{ oldText: "a", newText: "b" }],
    });
    expect(prepared.path).toBe("real.txt");
  });

  it("maps old_string/new_string inside each edits[] entry", () => {
    const prepared = prepare({
      path: "notes.txt",
      edits: [
        { old_string: "alpha", new_string: "ALPHA" },
        { oldText: "beta", newText: "BETA" },
      ],
    });
    expect(prepared).toEqual({
      path: "notes.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "beta", newText: "BETA" },
      ],
    });
  });

  it("maps top-level file_path/old_string/new_string with no edits[] wrapper (Claude Code's single-edit shape)", () => {
    const prepared = prepare({
      file_path: "notes.txt",
      old_string: "alpha",
      new_string: "ALPHA",
    });
    expect(prepared).toEqual({
      path: "notes.txt",
      edits: [{ oldText: "alpha", newText: "ALPHA" }],
    });
  });

  it("does not merge top-level old_string/new_string into an edits[] array that is already present", () => {
    // A model that (unusually) sends both would otherwise get its top-level
    // pair silently appended as an extra, unintended edit on top of the real
    // edits[] array.
    const prepared = prepare({
      path: "notes.txt",
      edits: [{ oldText: "alpha", newText: "ALPHA" }],
      old_string: "unrelated",
      new_string: "should not apply",
    });
    expect(prepared.edits).toEqual([{ oldText: "alpha", newText: "ALPHA" }]);
    expect((prepared as unknown as Record<string, unknown>).old_string).toBe("unrelated");
    expect((prepared as unknown as Record<string, unknown>).new_string).toBe("should not apply");
  });

  it("still rescues edits sent as a JSON string alongside snake_case fields", () => {
    const prepared = prepare({
      path: "notes.txt",
      edits: JSON.stringify([{ old_string: "alpha", new_string: "ALPHA" }]),
    });
    expect(prepared).toEqual({
      path: "notes.txt",
      edits: [{ oldText: "alpha", newText: "ALPHA" }],
    });
  });
});
