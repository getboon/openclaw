// Tests archive creation and extraction helpers.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as tar from "tar";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { withRealpathSymlinkRebindRace } from "../test-utils/symlink-rebind-race.js";
import { createZipCentralDirectoryArchive } from "../test-utils/zip-central-directory-fixture.js";
import type { ArchiveSecurityError } from "./archive.js";
import { extractArchive, resolvePackedRootDir } from "./archive.js";

const fixtureRootTracker = createSuiteTempRootTracker({ prefix: "openclaw-archive-" });
const directorySymlinkType = process.platform === "win32" ? "junction" : undefined;
const ARCHIVE_EXTRACT_TIMEOUT_MS = 15_000;
// fs-safe >= 0.5 rejects traversing / absolute tar members with this ArchiveSecurityError code
// (message "archive-entry-path-invalid"; 0.3.0 said "escapes destination").
const TAR_ENTRY_PATH_REJECTED_CODE = "entry-path";

async function makeTempDir(prefix = "case") {
  return await fixtureRootTracker.make(prefix);
}

async function withArchiveCase(
  ext: "zip" | "tar",
  run: (params: { workDir: string; archivePath: string; extractDir: string }) => Promise<void>,
) {
  const workDir = await makeTempDir(ext);
  const archivePath = path.join(workDir, `bundle.${ext}`);
  const extractDir = path.join(workDir, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  await run({ workDir, archivePath, extractDir });
}

async function writePackageArchive(params: {
  ext: "zip" | "tar";
  workDir: string;
  archivePath: string;
  fileName: string;
  content: string;
}) {
  if (params.ext === "zip") {
    const zip = new JSZip();
    zip.file(`package/${params.fileName}`, params.content);
    await fs.writeFile(params.archivePath, await zip.generateAsync({ type: "nodebuffer" }));
    return;
  }

  const packageDir = path.join(params.workDir, "package");
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(path.join(packageDir, params.fileName), params.content);
  await tar.c({ cwd: params.workDir, file: params.archivePath }, ["package"]);
}

async function createDirectorySymlink(targetDir: string, linkPath: string) {
  await fs.symlink(targetDir, linkPath, directorySymlinkType);
}

async function expectRejectedCode(promise: Promise<unknown>, expected: string | RegExp) {
  try {
    await promise;
  } catch (error) {
    const code = (error as Partial<ArchiveSecurityError>).code;
    if (typeof expected === "string") {
      expect(code).toBe(expected);
      return;
    }
    expect(String(code)).toMatch(expected);
    return;
  }
  throw new Error("expected promise to reject");
}

async function expectPathMissing(filePath: string) {
  await expectRejectedCode(fs.stat(filePath), "ENOENT");
}

async function expectExtractedSizeBudgetExceeded(params: {
  archivePath: string;
  destDir: string;
  timeoutMs?: number;
  maxExtractedBytes: number;
}) {
  await expect(
    extractArchive({
      archivePath: params.archivePath,
      destDir: params.destDir,
      timeoutMs: params.timeoutMs ?? ARCHIVE_EXTRACT_TIMEOUT_MS,
      limits: { maxExtractedBytes: params.maxExtractedBytes },
    }),
  ).rejects.toThrow("archive extracted size exceeds limit");
}

beforeAll(async () => {
  await fixtureRootTracker.setup();
});

afterAll(async () => {
  await fixtureRootTracker.cleanup();
});

describe("archive utils", () => {
  it.each([{ ext: "zip" as const }, { ext: "tar" as const }])(
    "extracts $ext archives",
    async ({ ext }) => {
      await withArchiveCase(ext, async ({ workDir, archivePath, extractDir }) => {
        await writePackageArchive({
          ext,
          workDir,
          archivePath,
          fileName: "hello.txt",
          content: "hi",
        });
        await extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        });
        const rootDir = await resolvePackedRootDir(extractDir);
        const content = await fs.readFile(path.join(rootDir, "hello.txt"), "utf-8");
        expect(content).toBe("hi");
      });
    },
  );

  it.each([{ ext: "zip" as const }, { ext: "tar" as const }])(
    "rejects $ext extraction when destination dir is a symlink",
    async ({ ext }) => {
      await withArchiveCase(ext, async ({ workDir, archivePath, extractDir }) => {
        const realExtractDir = path.join(workDir, "real-extract");
        await fs.mkdir(realExtractDir, { recursive: true });
        await writePackageArchive({
          ext,
          workDir,
          archivePath,
          fileName: "hello.txt",
          content: "hi",
        });
        await fs.rm(extractDir, { recursive: true, force: true });
        await createDirectorySymlink(realExtractDir, extractDir);

        await expectRejectedCode(
          extractArchive({
            archivePath,
            destDir: extractDir,
            timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
          }),
          "destination-symlink",
        );

        await expectPathMissing(path.join(realExtractDir, "package", "hello.txt"));
      });
    },
  );

  it("rejects zip path traversal (zip slip)", async () => {
    await withArchiveCase("zip", async ({ archivePath, extractDir }) => {
      const zip = new JSZip();
      zip.file("../b/evil.txt", "pwnd");
      await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

      await expect(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
      ).rejects.toThrow(/(escapes destination|absolute)/i);
    });
  });

  it("rejects zip entries that traverse pre-existing destination symlinks", async () => {
    await withArchiveCase("zip", async ({ workDir, archivePath, extractDir }) => {
      const outsideDir = path.join(workDir, "outside");
      await fs.mkdir(outsideDir, { recursive: true });
      await createDirectorySymlink(outsideDir, path.join(extractDir, "escape"));

      const zip = new JSZip();
      zip.file("escape/pwn.txt", "owned");
      await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

      await expectRejectedCode(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
        "destination-symlink-traversal",
      );

      const outsideFile = path.join(outsideDir, "pwn.txt");
      const outsideExists = await fs
        .stat(outsideFile)
        .then(() => true)
        .catch(() => false);
      expect(outsideExists).toBe(false);
    });
  });

  it("does not clobber out-of-destination file when parent dir is symlink-rebound during zip extract", async () => {
    await withArchiveCase("zip", async ({ workDir, archivePath, extractDir }) => {
      const outsideDir = path.join(workDir, "outside");
      await fs.mkdir(outsideDir, { recursive: true });
      const slotDir = path.join(extractDir, "slot");
      await fs.mkdir(slotDir, { recursive: true });

      const outsideTarget = path.join(outsideDir, "target.txt");
      await fs.writeFile(outsideTarget, "SAFE");

      const zip = new JSZip();
      zip.file("slot/target.txt", "owned");
      await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

      let rejected = false;
      try {
        await withRealpathSymlinkRebindRace({
          shouldFlip: (realpathInput) => realpathInput === slotDir,
          symlinkPath: slotDir,
          symlinkTarget: outsideDir,
          timing: "after-realpath",
          run: async () => {
            await extractArchive({
              archivePath,
              destDir: extractDir,
              timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
            });
          },
        });
      } catch (error) {
        rejected = true;
        const code = (error as Partial<ArchiveSecurityError>).code;
        expect(String(code)).toMatch(/destination-symlink-traversal|not-file/);
      }

      await expect(fs.readFile(outsideTarget, "utf8")).resolves.toBe("SAFE");
      if (!rejected) {
        await expect(fs.readFile(path.join(slotDir, "target.txt"), "utf8")).resolves.toBe("owned");
      }
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects zip extraction when a hardlink appears during destination verification",
    async () => {
      await withArchiveCase("zip", async ({ workDir, archivePath, extractDir }) => {
        const outsideDir = path.join(workDir, "outside");
        await fs.mkdir(outsideDir, { recursive: true });
        const outsideAlias = path.join(outsideDir, "payload.bin");
        const extractedPath = path.join(extractDir, "package", "payload.bin");

        const zip = new JSZip();
        zip.file("package/payload.bin", "owned");
        await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));
        const extractedRealPath = path.join(
          await fs.realpath(extractDir),
          "package",
          "payload.bin",
        );

        // fs-safe >= 0.5 verifies the published file through the caller's destination path
        // (0.3.0 used the realpath), so race on either spelling of the extracted file.
        const extractedPaths = new Set([extractedRealPath, path.resolve(extractedPath)]);
        const realLstat = fs.lstat.bind(fs);
        let linked = false;
        const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
          if (!linked && extractedPaths.has(String(args[0]))) {
            await fs.link(extractedRealPath, outsideAlias);
            linked = true;
          }
          return await realLstat(...args);
        });

        try {
          await expectRejectedCode(
            extractArchive({
              archivePath,
              destDir: extractDir,
              timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
            }),
            /^(?:destination-symlink-traversal|hardlink)$/u,
          );
        } finally {
          lstatSpy.mockRestore();
        }

        // fs-safe 0.8.x rejects without unlinking or truncating the now-shared published inode:
        // truncating would mutate a path outside the destination boundary, and the raced alias
        // only ever holds the archive's own bytes (same expectation as upstream openclaw).
        await expect(fs.readFile(outsideAlias, "utf8")).resolves.toBe("owned");
        await expect(fs.readFile(extractedPath, "utf8")).resolves.toBe("owned");
        expect((await fs.stat(extractedPath)).nlink).toBe(2);
      });
    },
  );

  it("rejects tar path traversal (zip slip)", async () => {
    await withArchiveCase("tar", async ({ workDir, archivePath, extractDir }) => {
      const insideDir = path.join(workDir, "inside");
      await fs.mkdir(insideDir, { recursive: true });
      await fs.writeFile(path.join(workDir, "outside.txt"), "pwnd");

      await tar.c({ cwd: insideDir, file: archivePath }, ["../outside.txt"]);
      await fs.writeFile(path.join(workDir, "outside.txt"), "outside sentinel");

      await expectRejectedCode(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
        TAR_ENTRY_PATH_REJECTED_CODE,
      );
      await expect(fs.readdir(extractDir)).resolves.toEqual([]);
      await expect(fs.readFile(path.join(workDir, "outside.txt"), "utf8")).resolves.toBe(
        "outside sentinel",
      );
    });
  });

  it("rejects tar entries that traverse pre-existing destination symlinks", async () => {
    await withArchiveCase("tar", async ({ workDir, archivePath, extractDir }) => {
      const outsideDir = path.join(workDir, "outside");
      const archiveRoot = path.join(workDir, "archive-root");
      await fs.mkdir(outsideDir, { recursive: true });
      await fs.mkdir(path.join(archiveRoot, "escape"), { recursive: true });
      await fs.writeFile(path.join(archiveRoot, "escape", "pwn.txt"), "owned");
      await createDirectorySymlink(outsideDir, path.join(extractDir, "escape"));
      await tar.c({ cwd: archiveRoot, file: archivePath }, ["escape"]);

      await expectRejectedCode(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
        "destination-symlink-traversal",
      );

      await expectPathMissing(path.join(outsideDir, "pwn.txt"));
    });
  });

  it.each([{ ext: "zip" as const }, { ext: "tar" as const }])(
    "rejects $ext archives that exceed extracted size budget",
    async ({ ext }) => {
      await withArchiveCase(ext, async ({ workDir, archivePath, extractDir }) => {
        await writePackageArchive({
          ext,
          workDir,
          archivePath,
          fileName: "big.txt",
          content: "x".repeat(64),
        });

        await expectExtractedSizeBudgetExceeded({
          archivePath,
          destDir: extractDir,
          maxExtractedBytes: 32,
        });
      });
    },
  );

  it.each([{ ext: "zip" as const }, { ext: "tar" as const }])(
    "rejects $ext archives that exceed archive size budget",
    async ({ ext }) => {
      await withArchiveCase(ext, async ({ workDir, archivePath, extractDir }) => {
        await writePackageArchive({
          ext,
          workDir,
          archivePath,
          fileName: "file.txt",
          content: "ok",
        });
        const stat = await fs.stat(archivePath);

        await expect(
          extractArchive({
            archivePath,
            destDir: extractDir,
            timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
            limits: { maxArchiveBytes: Math.max(1, stat.size - 1) },
          }),
        ).rejects.toThrow("archive size exceeds limit");
      });
    },
  );

  it("rejects zip archives whose actual central directory exceeds the entry limit before parsing", async () => {
    await withArchiveCase("zip", async ({ archivePath, extractDir }) => {
      // The fixture carries valid local records (upstream v2026.9.4), so fs-safe 0.8's
      // metadata checks pass and the physical central-directory scan must trip the limit.
      const archiveBytes = createZipCentralDirectoryArchive({
        actualEntryCount: 2,
        declaredEntryCount: 1,
      });
      await fs.writeFile(archivePath, archiveBytes);

      await expect(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
          limits: { maxEntries: 1 },
        }),
      ).rejects.toThrow("archive entry count exceeds limit");
      await expect(fs.readdir(extractDir)).resolves.toEqual([]);
    });
  });

  // Pins npm-pack style extraction through the public facade using the system `tar`
  // binary, so the @openclaw/fs-safe tar backend can change without silently changing
  // what lands on disk for plugin/package installs.
  it.runIf(process.platform !== "win32")(
    "installs an npm-pack tarball with nested dirs, a symlink-free tree and a PAX long path",
    async () => {
      const workDir = await makeTempDir("npm-pack");
      const srcRoot = path.join(workDir, "src");
      const longName = `${"l".repeat(117)}.js`;
      expect(longName).toHaveLength(120);
      const files: Record<string, string> = {
        "package/package.json": '{"name":"fixture","version":"1.0.0"}\n',
        "package/dist/a/b/c.js": "export const c = 1;\n",
        [`package/${longName}`]: "export const long = true;\n",
      };
      for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(srcRoot, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
        await fs.chmod(abs, 0o644);
      }
      const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
      const archivePath = path.join(workDir, "fixture-1.0.0.tgz");
      execFileSync("tar", ["--format=pax", "-czf", archivePath, "-C", srcRoot, "package"], {
        env: tarEnv,
      });
      const listing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
      expect(listing).toContain(`package/${longName}`);

      const extractDir = path.join(workDir, "extract");
      await fs.mkdir(extractDir, { recursive: true });
      await extractArchive({
        archivePath,
        destDir: extractDir,
        timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
      });

      for (const [rel, content] of Object.entries(files)) {
        const extracted = path.join(extractDir, rel);
        const stat = await fs.lstat(extracted);
        expect(stat.isFile(), rel).toBe(true);
        expect(stat.mode & 0o777, rel).toBe(0o644);
        await expect(fs.readFile(extracted, "utf8")).resolves.toBe(content);
      }
      const walk = async (dir: string): Promise<string[]> => {
        const out: string[] = [];
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          expect(entry.isSymbolicLink(), abs).toBe(false);
          if (entry.isDirectory()) {
            out.push(...(await walk(abs)));
          } else {
            out.push(path.relative(extractDir, abs).split(path.sep).join("/"));
          }
        }
        return out;
      };
      expect((await walk(extractDir)).toSorted()).toEqual(Object.keys(files).toSorted());

      const escapeRoot = path.join(workDir, "escape-root");
      const escapeCwd = path.join(escapeRoot, "inner");
      await fs.mkdir(escapeCwd, { recursive: true });
      await fs.writeFile(path.join(escapeRoot, "escape.js"), "pwnd\n");
      const escapeArchive = path.join(workDir, "escape-1.0.0.tgz");
      execFileSync("tar", ["--format=pax", "-czPf", escapeArchive, "../escape.js"], {
        cwd: escapeCwd,
        env: tarEnv,
      });
      expect(execFileSync("tar", ["-tzf", escapeArchive], { encoding: "utf8" })).toContain(
        "../escape.js",
      );
      const escapeExtractDir = path.join(workDir, "escape-extract");
      await fs.mkdir(escapeExtractDir, { recursive: true });
      await expectRejectedCode(
        extractArchive({
          archivePath: escapeArchive,
          destDir: escapeExtractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
        TAR_ENTRY_PATH_REJECTED_CODE,
      );
      // "../escape.js" relative to escapeExtractDir would land here.
      await expectPathMissing(path.join(workDir, "escape.js"));
      await expect(fs.readdir(escapeExtractDir)).resolves.toEqual([]);
    },
  );

  it("rejects tar entries with absolute extraction paths", async () => {
    await withArchiveCase("tar", async ({ workDir, archivePath, extractDir }) => {
      const inputDir = path.join(workDir, "input");
      const outsideFile = path.join(inputDir, "outside.txt");
      await fs.mkdir(inputDir, { recursive: true });
      await fs.writeFile(outsideFile, "owned");
      await tar.c({ file: archivePath, preservePaths: true }, [outsideFile]);
      await fs.writeFile(outsideFile, "outside sentinel");

      await expectRejectedCode(
        extractArchive({
          archivePath,
          destDir: extractDir,
          timeoutMs: ARCHIVE_EXTRACT_TIMEOUT_MS,
        }),
        TAR_ENTRY_PATH_REJECTED_CODE,
      );
      await expect(fs.readdir(extractDir)).resolves.toEqual([]);
      await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("outside sentinel");
    });
  });
});
