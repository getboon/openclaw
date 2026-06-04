import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MAX_INLINE_BASE64_BYTES } from "../../media/constants.js";
import { imageResult, imageResultFromFile, parseAvailableTags } from "./common.js";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n0sAAAAASUVORK5CYII=";

describe("parseAvailableTags", () => {
  test("returns undefined for non-array inputs", () => {
    expect(parseAvailableTags(undefined)).toBeUndefined();
    expect(parseAvailableTags(null)).toBeUndefined();
    expect(parseAvailableTags("oops")).toBeUndefined();
  });

  test("drops entries without a string name and returns undefined when empty", () => {
    expect(parseAvailableTags([{ id: "1" }])).toBeUndefined();
    expect(parseAvailableTags([{ name: 123 }])).toBeUndefined();
  });

  test("keeps falsy ids and sanitizes emoji fields", () => {
    const result = parseAvailableTags([
      { id: "0", name: "General", emoji_id: null },
      { id: "1", name: "Docs", emoji_name: "📚" },
      { name: "Bad", emoji_id: 123 },
    ]);
    expect(result).toEqual([
      { id: "0", name: "General", emoji_id: null },
      { id: "1", name: "Docs", emoji_name: "📚" },
      { name: "Bad" },
    ]);
  });
});
describe("imageResult", () => {
  test("stores media delivery in details.media instead of MEDIA text", async () => {
    const result = await imageResult({
      label: "test:image",
      path: "/tmp/test.png",
      base64: PNG_1X1_BASE64,
      mimeType: "image/png",
    });

    expect(result.content).toEqual([
      {
        type: "image",
        data: PNG_1X1_BASE64,
        mimeType: "image/png",
      },
    ]);
    expect(result.details).toEqual({
      path: "/tmp/test.png",
      media: {
        mediaUrl: "/tmp/test.png",
      },
    });
  });

  test("keeps extra text without MEDIA text fallback", async () => {
    const result = await imageResult({
      label: "test:image",
      path: "/tmp/test.png",
      base64: PNG_1X1_BASE64,
      mimeType: "image/png",
      extraText: "label text",
    });

    expect(result.content?.[0]).toEqual({
      type: "text",
      text: "label text",
    });
    expect(result.content?.[1]).toEqual({
      type: "image",
      data: PNG_1X1_BASE64,
      mimeType: "image/png",
    });
    expect(JSON.stringify(result.content)).not.toContain("MEDIA:");
  });
});

describe("imageResultFromFile inline-size guard", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test("throws a clear actionable error instead of a raw V8 string throw when the file exceeds the inline base64 limit", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "image-guard-"));
    const filePath = path.join(dir, "huge.bin");
    // Sparse file: declares a size beyond the limit without consuming disk.
    await writeFile(filePath, "");
    await truncate(filePath, MAX_INLINE_BASE64_BYTES + 1024);

    await expect(
      imageResultFromFile({ label: "test:image", path: filePath }),
    ).rejects.toThrow(/exceeds the .* inline-media limit/);
    // The error must NOT be V8's raw max-string-length throw.
    await expect(
      imageResultFromFile({ label: "test:image", path: filePath }),
    ).rejects.not.toThrow(/Cannot create a string longer than/);
  });
});
