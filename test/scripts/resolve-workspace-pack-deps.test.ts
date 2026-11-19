// Resolve Workspace Pack Deps tests cover rewriting workspace: protocol
// dependencies to a real, installable version before `npm pack` ships them
// unresolved -- a plain `npm i -g` of a tarball with a literal
// `"workspace:*"` specifier cannot parse it and fails with no clear error.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectWorkspaceMembers,
  prepareWorkspacePackDependencies,
  previewWorkspacePackDependencies,
  readWorkspacePackagePatterns,
  resolveWorkspacePackDependencies,
  restoreWorkspacePackDependencies,
} from "../../scripts/lib/resolve-workspace-pack-deps.mjs";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "resolve-workspace-pack-deps-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function makeFixture(rootDir: string, rootPackageJson: Record<string, unknown>): void {
  writeFileSync(
    path.join(rootDir, "pnpm-workspace.yaml"),
    ["packages:", "  - .", "  - ui", "  - packages/*", "  - extensions/*", ""].join("\n"),
  );
  writeJson(path.join(rootDir, "package.json"), rootPackageJson);
  writeJson(path.join(rootDir, "packages", "ai", "package.json"), {
    name: "@openclaw/ai",
    version: "2026.7.35-boon.1",
  });
  writeJson(path.join(rootDir, "extensions", "slack", "package.json"), {
    name: "@openclaw/slack",
    version: "2026.7.35-boon.1",
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("readWorkspacePackagePatterns", () => {
  it("reads the flat packages: list without a yaml dependency", () => {
    const dir = makeTempDir();
    const workspaceYamlPath = path.join(dir, "pnpm-workspace.yaml");
    writeFileSync(
      workspaceYamlPath,
      ["packages:", "  - .", "  - ui", "  - packages/*", "  - extensions/*", "", "onlyPatch: true", ""].join(
        "\n",
      ),
    );
    expect(readWorkspacePackagePatterns(workspaceYamlPath)).toEqual([
      ".",
      "ui",
      "packages/*",
      "extensions/*",
    ]);
  });
});

describe("collectWorkspaceMembers", () => {
  it("maps package names to their directory and version across glob dirs", () => {
    const dir = makeTempDir();
    makeFixture(dir, { name: "openclaw", version: "2026.7.35-boon.1" });
    const members = collectWorkspaceMembers(dir);
    expect(members.get("@openclaw/ai")).toEqual({ dir: "packages/ai", version: "2026.7.35-boon.1" });
    expect(members.get("@openclaw/slack")).toEqual({
      dir: "extensions/slack",
      version: "2026.7.35-boon.1",
    });
  });
});

describe("previewWorkspacePackDependencies / resolveWorkspacePackDependencies", () => {
  it("resolves workspace:* to the matching package's base version, stripping -boon.N", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    const { rewritten } = previewWorkspacePackDependencies(dir);
    expect(rewritten).toEqual([
      { name: "@openclaw/ai", from: "workspace:*", to: "2026.7.35", section: "dependencies" },
    ]);
    // Preview must not touch disk.
    expect(readJson(path.join(dir, "package.json")).dependencies).toEqual({
      "@openclaw/ai": "workspace:*",
    });
  });

  it("resolves workspace:^ and workspace:~ ranges, keeping the range operator", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:^", "@openclaw/slack": "workspace:~" },
    });
    const { rewritten } = previewWorkspacePackDependencies(dir);
    expect(rewritten).toEqual(
      expect.arrayContaining([
        { name: "@openclaw/ai", from: "workspace:^", to: "^2026.7.35", section: "dependencies" },
        { name: "@openclaw/slack", from: "workspace:~", to: "~2026.7.35", section: "dependencies" },
      ]),
    );
  });

  it("leaves an explicit workspace:<version> pin as the literal version", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:1.2.3" },
    });
    const { rewritten } = previewWorkspacePackDependencies(dir);
    expect(rewritten).toEqual([
      { name: "@openclaw/ai", from: "workspace:1.2.3", to: "1.2.3", section: "dependencies" },
    ]);
  });

  it("strips a fork -boon.N suffix from an explicit workspace:<version> pin too", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:2026.7.35-boon.1" },
    });
    const { rewritten } = previewWorkspacePackDependencies(dir);
    expect(rewritten).toEqual([
      {
        name: "@openclaw/ai",
        from: "workspace:2026.7.35-boon.1",
        to: "2026.7.35",
        section: "dependencies",
      },
    ]);
  });

  it("does not touch a plain semver dependency", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/fs-safe": "0.8.5" },
    });
    expect(previewWorkspacePackDependencies(dir).rewritten).toEqual([]);
  });

  it("rewrites workspace: specifiers in optionalDependencies and peerDependencies too", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      optionalDependencies: { "@openclaw/ai": "workspace:*" },
      peerDependencies: { "@openclaw/slack": "workspace:*" },
    });
    const { rewritten } = previewWorkspacePackDependencies(dir);
    expect(rewritten).toEqual(
      expect.arrayContaining([
        {
          name: "@openclaw/ai",
          from: "workspace:*",
          to: "2026.7.35",
          section: "optionalDependencies",
        },
        {
          name: "@openclaw/slack",
          from: "workspace:*",
          to: "2026.7.35",
          section: "peerDependencies",
        },
      ]),
    );
  });

  it("throws when a workspace: dependency has no matching workspace package", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/missing": "workspace:*" },
    });
    expect(() => previewWorkspacePackDependencies(dir)).toThrow(/no matching workspace package/u);
  });

  it("resolveWorkspacePackDependencies writes the rewrite to disk", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    resolveWorkspacePackDependencies(dir);
    expect(readJson(path.join(dir, "package.json")).dependencies).toEqual({
      "@openclaw/ai": "2026.7.35",
    });
  });
});

describe("prepareWorkspacePackDependencies / restoreWorkspacePackDependencies", () => {
  it("round-trips package.json byte-for-byte", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    const packageJsonPath = path.join(dir, "package.json");
    const original = readFileSync(packageJsonPath, "utf8");

    prepareWorkspacePackDependencies(dir);
    expect(readJson(packageJsonPath).dependencies).toEqual({ "@openclaw/ai": "2026.7.35" });

    const restored = restoreWorkspacePackDependencies(dir);
    expect(restored).toBe(true);
    expect(readFileSync(packageJsonPath, "utf8")).toBe(original);
  });

  it("is a no-op when there is nothing to resolve", () => {
    const dir = makeTempDir();
    makeFixture(dir, { name: "openclaw", version: "2026.7.35-boon.1" });
    prepareWorkspacePackDependencies(dir);
    // No workspace: dependency existed, so no backup should have been written.
    expect(restoreWorkspacePackDependencies(dir)).toBe(false);
  });

  it("restoreWorkspacePackDependencies returns false with no backup present", () => {
    const dir = makeTempDir();
    makeFixture(dir, { name: "openclaw", version: "2026.7.35-boon.1" });
    expect(restoreWorkspacePackDependencies(dir)).toBe(false);
  });

  it("restores cleanly when the current file still matches the expected rewrite exactly", () => {
    // The common case: nothing touched package.json between prepare and
    // restore, so current === the rewrite prepare produced (not the backup).
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    const original = readFileSync(path.join(dir, "package.json"), "utf8");
    prepareWorkspacePackDependencies(dir);
    expect(restoreWorkspacePackDependencies(dir)).toBe(true);
    expect(readFileSync(path.join(dir, "package.json"), "utf8")).toBe(original);
  });

  it("refuses to restore if package.json's version changed since the backup", () => {
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    prepareWorkspacePackDependencies(dir);

    const packageJsonPath = path.join(dir, "package.json");
    const mutated = readJson(packageJsonPath);
    mutated.version = "2026.7.35-boon.2";
    writeFileSync(packageJsonPath, `${JSON.stringify(mutated, null, 2)}\n`);

    expect(() => restoreWorkspacePackDependencies(dir)).toThrow(/Refusing to restore/u);
  });

  it("refuses to restore over an unrelated same-version edit made after prepare", () => {
    // Same package.json `version` as the backup, but different content --
    // a version-only equality check would miss this and clobber the edit.
    const dir = makeTempDir();
    makeFixture(dir, {
      name: "openclaw",
      version: "2026.7.35-boon.1",
      dependencies: { "@openclaw/ai": "workspace:*" },
    });
    prepareWorkspacePackDependencies(dir);

    const packageJsonPath = path.join(dir, "package.json");
    const mutated = readJson(packageJsonPath);
    mutated.description = "edited mid-pack";
    writeFileSync(packageJsonPath, `${JSON.stringify(mutated, null, 2)}\n`);

    expect(() => restoreWorkspacePackDependencies(dir)).toThrow(/Refusing to restore/u);
  });
});
