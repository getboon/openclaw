// Tightens OpenClaw-owned private directories before secret writes. Only
// directories owned by the current user are chmodded, each through a no-follow
// descriptor; fs-safe rejects symlinked, swapped, or foreign-owned paths itself.
import fsSync, { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const OPEN_DIR_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_DIRECTORY;
// Full POSIX permission bits, including setuid/setgid/sticky: fs-safe compares
// these too, so a 02700 directory is not "already private".
const PERMISSION_BITS = 0o7777;

// Only the directory owner may chmod it. A foreign-owned drifted directory fails
// closed with an actionable message (secret writes) or is left for fs-safe to
// reject on write (store factories, which also serve reads).
function isOwnedByCurrentUser(stat: { uid: number }): boolean {
  const euid = process.geteuid?.();
  return euid === undefined || stat.uid === euid;
}

function notOwnedError(dir: string, actualMode: number, uid: number, mode: number): Error {
  return new Error(
    `Private directory ${JSON.stringify(dir)} has mode ${actualMode.toString(8)} and is not owned by the current user ` +
      `(owner uid ${uid}, current uid ${process.geteuid?.()}); OpenClaw cannot tighten it to ${mode.toString(8)}. ` +
      `Run as its owner, or chown it to the gateway user and chmod it ${mode.toString(8)}.`,
  );
}

/** Tighten every existing directory from `rootDir` down to `targetDir`. */
export async function tightenPrivateDirChain(
  rootDir: string,
  targetDir: string,
  mode: number,
): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const root = path.resolve(rootDir);
  const parent = path.resolve(targetDir);
  const relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return;
  }
  const chain: string[] = [root];
  if (relative) {
    let current = root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      chain.push(current);
    }
  }
  for (const dir of chain) {
    let handle;
    try {
      handle = await fs.open(dir, OPEN_DIR_FLAGS);
    } catch {
      return; // Missing parents are created by fs-safe at the private mode; symlinked or non-directory components are rejected by it.
    }
    try {
      const stat = await handle.stat();
      const actualMode = stat.mode & PERMISSION_BITS;
      if (actualMode !== mode) {
        if (!isOwnedByCurrentUser(stat)) {
          throw notOwnedError(dir, actualMode, stat.uid, mode);
        }
        await handle.chmod(mode);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

/**
 * Tighten a single existing directory root. Missing, symlinked, or
 * non-directory roots are skipped (fs-safe creates or rejects them), as are
 * roots owned by another user; a failed chmod on an owned root throws.
 */
export function tightenPrivateDirRootSync(rootDir: string, mode: number): void {
  if (process.platform === "win32") {
    return;
  }
  let fd: number;
  try {
    fd = fsSync.openSync(rootDir, OPEN_DIR_FLAGS);
  } catch {
    return;
  }
  try {
    const stat = fsSync.fstatSync(fd);
    if ((stat.mode & PERMISSION_BITS) !== mode && isOwnedByCurrentUser(stat)) {
      fsSync.fchmodSync(fd, mode);
    }
  } finally {
    try {
      fsSync.closeSync(fd);
    } catch {
      // Best-effort close; the descriptor carries no further state.
    }
  }
}
