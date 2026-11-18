// Exposes sibling temp file writes with fs-safe defaults.
import "./fs-safe-defaults.js";
// Atomic sibling temp writes preserve target-directory permissions and avoid
// cross-device rename behavior.
import {
  writeSiblingTempFile as writeSiblingTempFileBase,
  type WriteSiblingTempFileOptions,
} from "@openclaw/fs-safe/advanced";
import { writeOwnedTempFile } from "./owned-temp-file.js";

export type {
  WriteSiblingTempFileOptions,
  WriteSiblingTempFileResult,
} from "@openclaw/fs-safe/advanced";

// fs-safe 0.8 only removes a sibling temp it has pinned; output a producer
// leaves behind after throwing (e.g. an oversized stream) is not its to delete.
// Produce into an owned private temp file and hand it off only on success, so
// a failed producer never leaves partial output beside the final artifact.
export async function writeSiblingTempFile<T>(options: WriteSiblingTempFileOptions<T>) {
  return await writeSiblingTempFileBase({
    ...options,
    writeTemp: (tempPath) => writeOwnedTempFile(tempPath, options.writeTemp),
  });
}
