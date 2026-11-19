#!/usr/bin/env node
// Runs every postpack restore step unconditionally: a `&&`-chained shell
// command would skip the rest after the first failure and leave a source
// checkout with un-restored packaging state (a rewritten package.json, a
// packaged-only CHANGELOG.md) with nothing left to fix it.
import { restorePackageChangelog } from "./package-changelog.mjs";
import { restoreWorkspacePackDependencies } from "./lib/resolve-workspace-pack-deps.mjs";

/**
 * @param {string} name
 * @param {() => unknown} run
 * @returns {Promise<boolean>} whether this step failed
 */
async function runRestoreStep(name, run) {
  try {
    await run();
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`postpack-restore: ${name} failed: ${message}`);
    return true;
  }
}

const changelogFailed = await runRestoreStep("package-changelog", () => restorePackageChangelog());
const workspaceDepsFailed = await runRestoreStep("resolve-workspace-pack-deps", () =>
  restoreWorkspacePackDependencies(),
);
if (changelogFailed || workspaceDepsFailed) {
  process.exitCode = 1;
}
