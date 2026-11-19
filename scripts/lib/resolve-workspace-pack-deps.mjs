// `npm pack`/`npm publish` ship package.json as-is: they have no concept of
// pnpm's `workspace:` protocol, so a dependency on a local workspace package
// ships the literal unresolved specifier (e.g. `"workspace:*"`) into the
// published tarball. A plain `npm i -g` of that tarball then asks npm's
// resolver to fetch that literal string as a version, which it cannot parse.
//
// Mirrors what `pnpm pack`/`pnpm publish` do automatically: rewrite each
// `workspace:` specifier to the real version of the matching local package.
//
// The fork never publishes `packages/*` or `extensions/*` members under its
// own `-boon.N` suffix -- only the gateway tarball itself, plus a short list
// of plugins packed as separate sibling release assets. There is no
// `<pkg>@<base>-boon.N` anywhere for npm to fetch for any other workspace
// member, so the resolved dependency strips that suffix back to the real,
// upstream-published base version (e.g. `2026.7.35-boon.1` -> `2026.7.35`)
// rather than using the local package.json's version field verbatim.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseForkReleaseVersion } from "./release-version.mjs";

const WORKSPACE_PROTOCOL_PREFIX = "workspace:";
const DEPENDENCY_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"];
const BACKUP_PATH = join(".artifacts", "resolve-workspace-pack-deps", "package.json.prepack-backup");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Writes via a same-directory temp file + rename so a write that fails
 * partway (disk full, process killed) can never leave `filePath` truncated
 * -- the rename only lands once the full content is safely on disk.
 *
 * @param {string} filePath
 * @param {string} content
 */
function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, content);
  renameSync(tempPath, filePath);
}

/**
 * Reads the flat `packages:` list from pnpm-workspace.yaml. Kept
 * dependency-free (no `yaml` import) so this script runs in any environment,
 * including a bare `node` invocation with no installed dependencies. Only
 * supports what this repo's pnpm-workspace.yaml actually uses: a top-level
 * `packages:` block of plain `- <glob>` list items.
 *
 * @param {string} workspaceYamlPath
 * @returns {string[]}
 */
export function readWorkspacePackagePatterns(workspaceYamlPath) {
  const lines = readFileSync(workspaceYamlPath, "utf8").split("\n");
  const patterns = [];
  let inPackagesBlock = false;
  for (const line of lines) {
    if (/^packages:\s*$/u.test(line)) {
      inPackagesBlock = true;
      continue;
    }
    if (!inPackagesBlock) {
      continue;
    }
    const itemMatch = /^\s*-\s*(\S+)\s*$/u.exec(line);
    if (itemMatch) {
      patterns.push(itemMatch[1]);
      continue;
    }
    if (line.trim() !== "" && !line.startsWith(" ")) {
      break;
    }
  }
  return patterns;
}

function expandWorkspaceGlob(rootDir, pattern) {
  if (pattern === ".") {
    return [];
  }
  if (!pattern.endsWith("/*")) {
    return [pattern];
  }
  const parentDir = pattern.slice(0, -2);
  const parentPath = resolve(rootDir, parentDir);
  if (!existsSync(parentPath)) {
    return [];
  }
  return readdirSync(parentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parentDir}/${entry.name}`);
}

/**
 * @param {string} rootDir
 * @returns {Map<string, { dir: string, version: string }>} package name -> local package info
 */
export function collectWorkspaceMembers(rootDir = resolve(".")) {
  const workspaceYamlPath = join(rootDir, "pnpm-workspace.yaml");
  const patterns = readWorkspacePackagePatterns(workspaceYamlPath);

  const members = new Map();
  for (const pattern of patterns) {
    for (const dir of expandWorkspaceGlob(rootDir, pattern)) {
      const packageJsonPath = join(rootDir, dir, "package.json");
      if (!existsSync(packageJsonPath)) {
        continue;
      }
      const packageJson = readJson(packageJsonPath);
      if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
        continue;
      }
      members.set(packageJson.name, { dir, version: packageJson.version });
    }
  }
  return members;
}

function publishableBaseVersion(localVersion) {
  const parsed = parseForkReleaseVersion(localVersion);
  return parsed && "forkPatch" in parsed ? parsed.baseVersion : localVersion;
}

function resolveWorkspaceSpecifier(specifier, localVersion) {
  const baseVersion = publishableBaseVersion(localVersion);
  const range = specifier.slice(WORKSPACE_PROTOCOL_PREFIX.length);
  if (range === "*" || range === "") {
    return baseVersion;
  }
  if (range === "^" || range === "~") {
    return `${range}${baseVersion}`;
  }
  // An explicit workspace:<version> pin is already meant to be a real
  // version, but still route it through the same base-version stripping: a
  // pin that was itself copied from a fork-suffixed local version must not
  // ship the unpublishable `-boon.N` form.
  return publishableBaseVersion(range);
}

/**
 * Rewrites every `workspace:` specifier across `dependencies`,
 * `optionalDependencies`, and `peerDependencies` on an already-parsed
 * package.json object, in place, against the given workspace member map.
 *
 * @param {Record<string, unknown>} packageJson
 * @param {Map<string, { dir: string, version: string }>} members
 * @returns {Array<{ name: string, from: string, to: string, section: string }>}
 */
function rewriteWorkspaceSpecifiers(packageJson, members) {
  const rewritten = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = packageJson[section];
    if (!deps || typeof deps !== "object") {
      continue;
    }
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier !== "string" || !specifier.startsWith(WORKSPACE_PROTOCOL_PREFIX)) {
        continue;
      }
      const member = members.get(name);
      if (!member) {
        throw new Error(
          `root package.json ${section} entry "${name}" uses the workspace: protocol (${specifier}) but no matching workspace package was found to resolve it against`,
        );
      }
      const resolvedSpecifier = resolveWorkspaceSpecifier(specifier, member.version);
      deps[name] = resolvedSpecifier;
      rewritten.push({ name, from: specifier, to: resolvedSpecifier, section });
    }
  }
  return rewritten;
}

/**
 * Computes the `workspace:` dependency rewrites for the root package.json
 * without touching disk. Safe to call freely for inspection.
 *
 * @param {string} rootDir
 * @returns {{ packageJson: object, rewritten: Array<{ name: string, from: string, to: string, section: string }> }}
 */
export function previewWorkspacePackDependencies(rootDir = resolve(".")) {
  const packageJsonPath = join(rootDir, "package.json");
  const packageJson = readJson(packageJsonPath);
  const members = collectWorkspaceMembers(rootDir);
  const rewritten = rewriteWorkspaceSpecifiers(packageJson, members);
  return { packageJson, rewritten };
}

/**
 * Rewrites every `workspace:` dependency in the root package.json to the
 * matching local package's real version, in place on disk. Callers that
 * need the original content back (anything other than a disposable/ephemeral
 * checkout) must snapshot it themselves first — see
 * {@link prepareWorkspacePackDependencies} for the backed-up variant.
 *
 * @param {string} rootDir
 * @returns {{ rewritten: Array<{ name: string, from: string, to: string, section: string }> }}
 */
export function resolveWorkspacePackDependencies(rootDir = resolve(".")) {
  const packageJsonPath = join(rootDir, "package.json");
  const { packageJson, rewritten } = previewWorkspacePackDependencies(rootDir);
  if (rewritten.length > 0) {
    writeFileAtomic(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
  return { rewritten };
}

/**
 * Prepack entry point: backs up package.json BEFORE mutating it, then
 * resolves `workspace:` dependencies in place so `npm pack`/`npm publish`
 * ship a real, installable specifier. Pairs with
 * {@link restoreWorkspacePackDependencies} in postpack, mirroring the
 * existing prepack/postpack backup-and-restore shape in
 * `scripts/package-changelog.mjs`. The backup is written first so a failed
 * backup write can never leave the checkout permanently rewritten with
 * nothing to restore from.
 *
 * @param {string} rootDir
 * @returns {{ rewritten: Array<{ name: string, from: string, to: string, section: string }> }}
 */
export function prepareWorkspacePackDependencies(rootDir = resolve(".")) {
  const packageJsonPath = join(rootDir, "package.json");
  const backupPath = join(rootDir, BACKUP_PATH);
  const original = readFileSync(packageJsonPath, "utf8");
  const { packageJson, rewritten } = previewWorkspacePackDependencies(rootDir);
  if (rewritten.length > 0) {
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, original);
    writeFileAtomic(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
  return { rewritten };
}

/**
 * Restores package.json from the prepack backup, if one exists. If the
 * current file no longer matches what the backup's own rewrite would have
 * produced, something else edited package.json since the backup was
 * written — refuse rather than silently discard that edit.
 *
 * @param {string} rootDir
 * @returns {boolean} whether a backup was restored
 */
export function restoreWorkspacePackDependencies(rootDir = resolve(".")) {
  const backupPath = join(rootDir, BACKUP_PATH);
  if (!existsSync(backupPath)) {
    return false;
  }
  const packageJsonPath = join(rootDir, "package.json");
  const backupText = readFileSync(backupPath, "utf8");
  const currentText = readFileSync(packageJsonPath, "utf8");
  if (currentText !== backupText) {
    const backupPackageJson = JSON.parse(backupText);
    const members = collectWorkspaceMembers(rootDir);
    let expectedText;
    try {
      rewriteWorkspaceSpecifiers(backupPackageJson, members);
      expectedText = `${JSON.stringify(backupPackageJson, null, 2)}\n`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Refusing to restore ${BACKUP_PATH}: could not recompute the expected rewritten package.json to verify against the current file: ${message}`,
        { cause: error },
      );
    }
    if (currentText !== expectedText) {
      throw new Error(
        `Refusing to restore ${BACKUP_PATH} because package.json has changed since the backup was written.`,
      );
    }
  }
  writeFileAtomic(packageJsonPath, backupText);
  rmSync(backupPath, { force: true });
  return true;
}

function logRewrites(rewritten, { written }) {
  const verb = written ? "resolved" : "would resolve";
  for (const { name, from, to } of rewritten) {
    console.error(`resolve-workspace-pack-deps: ${verb} ${name}: ${from} -> ${to}`);
  }
  if (rewritten.length === 0) {
    console.error("resolve-workspace-pack-deps: no workspace: dependencies to resolve.");
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  if (command === "restore") {
    const restored = restoreWorkspacePackDependencies();
    console.error(
      restored
        ? "resolve-workspace-pack-deps: restored source package.json."
        : "resolve-workspace-pack-deps: no backup to restore.",
    );
    return;
  }
  if (command === "prepare") {
    logRewrites(prepareWorkspacePackDependencies().rewritten, { written: true });
    return;
  }
  if (command === undefined) {
    // Dry-run default: never mutate package.json when run with no args, so
    // a human inspecting this script's output locally can't repeat the exact
    // mistake that motivated this safeguard -- an un-backed-up write from a
    // bare invocation. Use `prepare` to actually apply the rewrite.
    logRewrites(previewWorkspacePackDependencies().rewritten, { written: false });
    return;
  }
  console.error("Usage: node scripts/lib/resolve-workspace-pack-deps.mjs [prepare|restore]");
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
