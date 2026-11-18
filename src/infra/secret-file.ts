// Exposes private secret file helpers with fs-safe defaults.
import "./fs-safe-defaults.js";
import path from "node:path";
import {
  PRIVATE_SECRET_DIR_MODE,
  readSecretFileSync as readSecretFileSyncImpl,
  writeSecretFileAtomic as writeSecretFileAtomicImpl,
} from "@openclaw/fs-safe/secret";
import { resolveUserPath } from "../utils.js";
import { tightenPrivateDirChain } from "./private-dir-mode.js";

export {
  DEFAULT_SECRET_FILE_MAX_BYTES,
  PRIVATE_SECRET_DIR_MODE,
  PRIVATE_SECRET_FILE_MODE,
  readSecretFileSync,
  tryReadSecretFileSync,
  type SecretFileReadOptions,
} from "@openclaw/fs-safe/secret";

type SecretFileWriteParams = Parameters<typeof writeSecretFileAtomicImpl>[0];

// fs-safe 0.8 no longer repairs existing directory modes; OpenClaw keeps its
// documented behavior of tightening its own secret directories before writing.
function tightenSecretDirectoryModes(params: {
  rootDir: string;
  filePath: string;
  dirMode?: number;
}): Promise<void> {
  return tightenPrivateDirChain(
    params.rootDir,
    path.dirname(params.filePath),
    params.dirMode ?? PRIVATE_SECRET_DIR_MODE,
  );
}

/** Atomically write a private secret file, tightening OpenClaw-owned parent directories first. */
export async function writePrivateSecretFileAtomic(params: SecretFileWriteParams): Promise<void> {
  await tightenSecretDirectoryModes(params);
  await writeSecretFileAtomicImpl(params);
}

export type SecretFileReadResult =
  | {
      ok: true;
      secret: string;
      resolvedPath: string;
    }
  | {
      ok: false;
      message: string;
      resolvedPath?: string;
      error?: unknown;
    };

/** @deprecated Use readSecretFileSync() or tryReadSecretFileSync(). */
export function loadSecretFileSync(
  filePath: string,
  label: string,
  options: Parameters<typeof readSecretFileSyncImpl>[2] = {},
): SecretFileReadResult {
  const trimmedPath = filePath.trim();
  const resolvedPath = resolveUserPath(trimmedPath);
  if (!resolvedPath) {
    return { ok: false, message: `${label} file path is empty.` };
  }

  try {
    return {
      ok: true,
      secret: readSecretFileSyncImpl(filePath, label, options),
      resolvedPath,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      resolvedPath,
      error,
    };
  }
}
