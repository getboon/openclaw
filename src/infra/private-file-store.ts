// Creates private fs-safe file stores.
import "./fs-safe-defaults.js";
import {
  fileStore,
  fileStoreSync,
  type FileStore,
  type FileStoreSync,
} from "@openclaw/fs-safe/store";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { formatErrorMessage } from "./errors.js";
import { tightenPrivateDirRootSync } from "./private-dir-mode.js";

const PRIVATE_STORE_DIR_MODE = 0o700;

const log = createSubsystemLogger("infra:private-file-store");

// fs-safe does not repair existing store-root permissions, so OpenClaw tightens
// its own roots at store creation. A failed chmod is logged with its real cause
// rather than thrown, because stores also serve reads; files are still written
// owner-only.
function tightenPrivateStoreRoot(rootDir: string): void {
  try {
    tightenPrivateDirRootSync(rootDir, PRIVATE_STORE_DIR_MODE);
  } catch (err) {
    log.warn(
      `Could not tighten private store root ${JSON.stringify(rootDir)} to ${PRIVATE_STORE_DIR_MODE.toString(8)}: ${formatErrorMessage(err)}`,
    );
  }
}

// Private stores create owner-only files under a caller-provided root.
export type PrivateFileStore = FileStore;

/** Create an async private file store rooted at `rootDir`. */
export function privateFileStore(rootDir: string): FileStore {
  tightenPrivateStoreRoot(rootDir);
  return fileStore({ rootDir, private: true });
}

export type PrivateFileStoreSync = FileStoreSync;

/** Create a sync private file store rooted at `rootDir`. */
export function privateFileStoreSync(rootDir: string): PrivateFileStoreSync {
  tightenPrivateStoreRoot(rootDir);
  return fileStoreSync({ rootDir, private: true });
}
