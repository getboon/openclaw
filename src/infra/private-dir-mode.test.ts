// Covers descriptor-pinned tightening of OpenClaw-owned private directories.
import fsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { tightenPrivateDirChain, tightenPrivateDirRootSync } from "./private-dir-mode.js";

const tempDirs = createTrackedTempDirs();
const createTempDir = () => tempDirs.make("openclaw-private-dir-mode-test-");
const posixOnly = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  vi.restoreAllMocks();
  await tempDirs.cleanup();
});

async function modeOf(dir: string): Promise<number> {
  return (await fsPromises.stat(dir)).mode & 0o777;
}

describe("tightenPrivateDirChain", () => {
  posixOnly("tightens umask-0002 style 0775 directories from root to target", async () => {
    const root = await createTempDir();
    const nested = path.join(root, "agents", "main");
    await fsPromises.mkdir(nested, { recursive: true });
    await fsPromises.chmod(root, 0o775);
    await fsPromises.chmod(path.join(root, "agents"), 0o775);
    await fsPromises.chmod(nested, 0o775);

    await tightenPrivateDirChain(root, nested, 0o700);

    expect(await modeOf(root)).toBe(0o700);
    expect(await modeOf(path.join(root, "agents"))).toBe(0o700);
    expect(await modeOf(nested)).toBe(0o700);
  });

  posixOnly("stops at a missing component so fs-safe creates it at the private mode", async () => {
    const root = await createTempDir();
    await fsPromises.chmod(root, 0o775);

    await tightenPrivateDirChain(root, path.join(root, "missing", "deeper"), 0o700);

    expect(await modeOf(root)).toBe(0o700);
    await expect(fsPromises.stat(path.join(root, "missing"))).rejects.toThrow();
  });

  posixOnly("refuses to tighten a directory owned by another user with a clear error", async () => {
    const root = await createTempDir();
    await fsPromises.chmod(root, 0o775);
    const uid = process.geteuid?.() ?? 0;
    vi.spyOn(process, "geteuid").mockReturnValue(uid + 1);

    await expect(tightenPrivateDirChain(root, root, 0o700)).rejects.toThrow(
      /is not owned by the current user .*cannot tighten/,
    );
    expect(await modeOf(root)).toBe(0o775);
  });

  posixOnly("leaves a correctly-moded directory owned by another user alone", async () => {
    const root = await createTempDir();
    await fsPromises.chmod(root, 0o700);
    const uid = process.geteuid?.() ?? 0;
    vi.spyOn(process, "geteuid").mockReturnValue(uid + 1);

    await expect(tightenPrivateDirChain(root, root, 0o700)).resolves.toBeUndefined();
  });
});

describe("tightenPrivateDirRootSync", () => {
  posixOnly("tightens an existing 0775 root", async () => {
    const root = await createTempDir();
    await fsPromises.chmod(root, 0o775);

    tightenPrivateDirRootSync(root, 0o700);

    expect(await modeOf(root)).toBe(0o700);
  });

  posixOnly("leaves a root owned by another user for fs-safe to reject on write", async () => {
    const root = await createTempDir();
    await fsPromises.chmod(root, 0o775);
    const uid = process.geteuid?.() ?? 0;
    vi.spyOn(process, "geteuid").mockReturnValue(uid + 1);

    expect(() => tightenPrivateDirRootSync(root, 0o700)).not.toThrow();
    expect(await modeOf(root)).toBe(0o775);
  });
});
