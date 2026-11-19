#!/usr/bin/env node
// Runs every postpack restore step unconditionally: a `&&`-chained shell
// command would skip the rest after the first failure and leave a source
// checkout with un-restored packaging state (a rewritten package.json, a
// packaged-only CHANGELOG.md) with nothing left to fix it.
import { restorePackageChangelog } from "./package-changelog.mjs";
import { restoreWorkspacePackDependencies } from "./lib/resolve-workspace-pack-deps.mjs";

const steps = [
  ["package-changelog", () => restorePackageChangelog()],
  ["resolve-workspace-pack-deps", () => restoreWorkspacePackDependencies()],
];

let failed = false;
for (const [name, run] of steps) {
  try {
    await run();
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`postpack-restore: ${name} failed: ${message}`);
  }
}
if (failed) {
  process.exitCode = 1;
}
