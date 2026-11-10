// Exposes root-scoped file open helpers with fs-safe defaults.
import "./fs-safe-defaults.js";
import path from "node:path";
import {
  canonicalPathFromExistingAncestor,
  openRootFile,
  type OpenRootFileParams,
  type RootFileOpenResult,
} from "@openclaw/fs-safe/advanced";

// Root-scoped file open helpers. Use these for user paths that must stay under
// an already trusted boundary.
export {
  canUseRootFileOpen,
  matchRootFileOpenFailure,
  openRootFile,
  openRootFileSync,
  type RootFileOpenFailure,
  type RootFileOpenResult,
} from "@openclaw/fs-safe/advanced";

/**
 * Opens a root-scoped file after canonicalizing symlink parents. fs-safe 0.5.2+
 * rejects every symlink path component by default; the workspace contract
 * follows contained parent symlinks (directory aliases) while final-symlink
 * targets and out-of-root escapes stay rejected by openRootFile itself.
 */
export async function openRootFileFollowingParents(
  params: OpenRootFileParams,
): Promise<RootFileOpenResult> {
  let absolutePath = path.resolve(params.absolutePath);
  try {
    const canonicalParent = await canonicalPathFromExistingAncestor(path.dirname(absolutePath));
    absolutePath = path.join(canonicalParent, path.basename(absolutePath));
  } catch {
    // Keep the lexical path; openRootFile reports the boundary or IO failure.
  }
  return await openRootFile({ ...params, absolutePath });
}
