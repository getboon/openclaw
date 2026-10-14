// Local media access tests cover workspace path authorization.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveStateDir } from "../config/paths.js";
import {
  assertLocalMediaAllowed,
  isLocalMediaPathNotAllowedError,
  LocalMediaAccessError,
} from "./local-media-access.js";

const { hoistedRoots } = vi.hoisted(() => ({ hoistedRoots: [] as string[] }));

vi.mock("./local-roots.js", () => ({
  getDefaultMediaLocalRoots: () => hoistedRoots,
}));

describe("assertLocalMediaAllowed", () => {
  it("allows managed inbound media paths before explicit root checks", async () => {
    const stateDir = resolveStateDir();
    const id = `managed-local-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(stateDir, "media", "inbound", id);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("png"));

    try {
      await expect(assertLocalMediaAllowed(filePath, [])).resolves.toBeUndefined();
    } finally {
      await fs.rm(filePath, { force: true });
    }
  });

  it("does not allow nested inbound paths as managed media", async () => {
    const stateDir = resolveStateDir();
    const filePath = path.join(stateDir, "media", "inbound", "nested", "hidden.png");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from("png"));

    try {
      let accessError: unknown;
      try {
        await assertLocalMediaAllowed(filePath, []);
      } catch (error) {
        accessError = error;
      }
      expect(accessError).toBeInstanceOf(LocalMediaAccessError);
      if (!(accessError instanceof LocalMediaAccessError)) {
        throw new Error("expected LocalMediaAccessError");
      }
      expect(accessError.name).toBe("LocalMediaAccessError");
      expect(accessError.code).toBe("path-not-allowed");
      expect(accessError.message).toBe(
        `Local media path is not under an allowed directory: ${filePath}`,
      );
    } finally {
      await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    }
  });

  it("rejects workspace-* sibling paths when localRoots is undefined (unscoped)", async () => {
    const tmpDir = path.join(
      os.tmpdir(),
      `ocl-local-media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const workspaceDir = path.join(tmpDir, "workspace");
    const workspaceXiaoqianDir = path.join(tmpDir, "workspace-xiaoqian");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(workspaceXiaoqianDir, { recursive: true });

    const mediaPath = path.join(workspaceXiaoqianDir, "report.html");
    await fs.writeFile(mediaPath, "<html>test</html>");

    hoistedRoots.length = 0;
    hoistedRoots.push(workspaceDir);

    try {
      let accessError: unknown;
      try {
        await assertLocalMediaAllowed(mediaPath, undefined);
      } catch (error) {
        accessError = error;
      }
      expect(accessError).toBeInstanceOf(LocalMediaAccessError);
      if (!(accessError instanceof LocalMediaAccessError)) {
        throw new Error("expected LocalMediaAccessError");
      }
      expect(accessError.code).toBe("path-not-allowed");
    } finally {
      hoistedRoots.length = 0;
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("allows workspace-* paths when scoped localRoots include the agent workspace", async () => {
    const tmpDir = path.join(
      os.tmpdir(),
      `ocl-local-media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const workspaceDir = path.join(tmpDir, "workspace");
    const workspaceXiaoqianDir = path.join(tmpDir, "workspace-xiaoqian");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(workspaceXiaoqianDir, { recursive: true });

    const mediaPath = path.join(workspaceXiaoqianDir, "report.html");
    await fs.writeFile(mediaPath, "<html>test</html>");

    try {
      // Simulate scoped roots that include the agent's workspace-* directory
      await expect(
        assertLocalMediaAllowed(mediaPath, [workspaceDir, workspaceXiaoqianDir]),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("still rejects a symlink that escapes an allowed root (traversal via alias)", async () => {
    const tmpDir = path.join(
      os.tmpdir(),
      `ocl-local-media-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const allowedRoot = path.join(tmpDir, "allowed");
    const outsideDir = path.join(tmpDir, "outside");
    await fs.mkdir(allowedRoot, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    const secretFile = path.join(outsideDir, "secret.png");
    await fs.writeFile(secretFile, Buffer.from("png"));
    const aliasPath = path.join(allowedRoot, "alias.png");
    await fs.symlink(secretFile, aliasPath);

    try {
      let accessError: unknown;
      try {
        // Even though the symlink's literal path is under the allowed root, its
        // realpath resolves outside it — the realpath-based containment check
        // in assertLocalMediaAllowed must still reject it.
        await assertLocalMediaAllowed(aliasPath, [allowedRoot]);
      } catch (error) {
        accessError = error;
      }
      expect(accessError).toBeInstanceOf(LocalMediaAccessError);
      expect(isLocalMediaPathNotAllowedError(accessError)).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("isLocalMediaPathNotAllowedError", () => {
  it("is true only for the path-not-allowed code", () => {
    expect(
      isLocalMediaPathNotAllowedError(new LocalMediaAccessError("path-not-allowed", "x")),
    ).toBe(true);
    expect(isLocalMediaPathNotAllowedError(new LocalMediaAccessError("not-found", "x"))).toBe(
      false,
    );
    expect(isLocalMediaPathNotAllowedError(new Error("x"))).toBe(false);
    expect(isLocalMediaPathNotAllowedError(null)).toBe(false);
  });
});
