// Covers exec approvals store socket interactions.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { makeTempDir } from "./exec-approvals-test-helpers.js";

const requestJsonlSocketMock = vi.hoisted(() => vi.fn());

vi.mock("./jsonl-socket.js", () => ({
  requestJsonlSocket: (...args: unknown[]) => requestJsonlSocketMock(...args),
}));

import type { ExecApprovalsFile } from "./exec-approvals.js";

type ExecApprovalsModule = typeof import("./exec-approvals.js");
type ExecApprovalsMutationModule = typeof import("./exec-approvals-mutation.js");

let ensureExecApprovals: ExecApprovalsModule["ensureExecApprovals"];
let mergeExecApprovalsSocketDefaults: ExecApprovalsModule["mergeExecApprovalsSocketDefaults"];
let normalizeExecApprovals: ExecApprovalsModule["normalizeExecApprovals"];
let persistAllowAlwaysDecision: ExecApprovalsModule["persistAllowAlwaysDecision"];
let readExecApprovalsSnapshot: ExecApprovalsModule["readExecApprovalsSnapshot"];
let recordAllowlistMatchesUse: ExecApprovalsModule["recordAllowlistMatchesUse"];
let recordAllowlistUse: ExecApprovalsModule["recordAllowlistUse"];
let requestExecApprovalViaSocket: ExecApprovalsModule["requestExecApprovalViaSocket"];
let resolveExecApprovals: ExecApprovalsModule["resolveExecApprovals"];
let resolveExecApprovalsDisplayPath: ExecApprovalsModule["resolveExecApprovalsDisplayPath"];
let resolveExecApprovalsPath: ExecApprovalsModule["resolveExecApprovalsPath"];
let resolveExecApprovalsSocketPath: ExecApprovalsModule["resolveExecApprovalsSocketPath"];
let resolveExecApprovalsTranscriptPath: ExecApprovalsModule["resolveExecApprovalsTranscriptPath"];
let restoreExecApprovalsSnapshot: ExecApprovalsModule["restoreExecApprovalsSnapshot"];
let saveExecApprovals: ExecApprovalsModule["saveExecApprovals"];
let withExecApprovalsLock: ExecApprovalsMutationModule["withExecApprovalsLock"];

const tempDirs: string[] = [];
const testEnvSnapshot = captureEnv(["OPENCLAW_HOME", "OPENCLAW_STATE_DIR"]);

beforeAll(async () => {
  ({
    ensureExecApprovals,
    mergeExecApprovalsSocketDefaults,
    normalizeExecApprovals,
    persistAllowAlwaysDecision,
    readExecApprovalsSnapshot,
    recordAllowlistMatchesUse,
    recordAllowlistUse,
    requestExecApprovalViaSocket,
    resolveExecApprovals,
    resolveExecApprovalsDisplayPath,
    resolveExecApprovalsPath,
    resolveExecApprovalsSocketPath,
    resolveExecApprovalsTranscriptPath,
    restoreExecApprovalsSnapshot,
    saveExecApprovals,
  } = await import("./exec-approvals.js"));
  ({ withExecApprovalsLock } = await import("./exec-approvals-mutation.js"));
});

beforeEach(() => {
  requestJsonlSocketMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  testEnvSnapshot.restore();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createHomeDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  setTestEnvValue("OPENCLAW_HOME", dir);
  deleteTestEnvValue("OPENCLAW_STATE_DIR");
  return dir;
}

function approvalsFilePath(homeDir: string): string {
  return path.join(homeDir, ".openclaw", "exec-approvals.json");
}

function stateApprovalsFilePath(stateDir: string): string {
  return path.join(stateDir, "exec-approvals.json");
}

function createExecApprovalsMutationStore() {
  return {
    resolvePath: resolveExecApprovalsPath,
    readSnapshot: readExecApprovalsSnapshot,
    save: saveExecApprovals,
    restore: restoreExecApprovalsSnapshot,
  };
}

function readApprovalsFile(homeDir: string): ExecApprovalsFile {
  return JSON.parse(fs.readFileSync(approvalsFilePath(homeDir), "utf8")) as ExecApprovalsFile;
}

function listExecApprovalTempFiles(homeDir: string): string[] {
  const dir = path.dirname(approvalsFilePath(homeDir));
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a non-array record");
  }
  return value as Record<string, unknown>;
}

function allowlistEntries(homeDir: string, agentId: string): Record<string, unknown>[] {
  const file = readApprovalsFile(homeDir);
  return (file.agents?.[agentId]?.allowlist ?? []).map((entry) => requireRecord(entry));
}

function expectAllowlistEntryFields(
  entry: Record<string, unknown>,
  fields: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    expect(entry[key]).toEqual(value);
  }
}

async function mutateApprovalsInChild(homeDir: string, agentId: string): Promise<void> {
  const mutationModuleUrl = pathToFileURL(
    path.join(process.cwd(), "src/infra/exec-approvals-mutation.ts"),
  ).href;
  const approvalsModuleUrl = pathToFileURL(
    path.join(process.cwd(), "src/infra/exec-approvals.ts"),
  ).href;
  const script = `
    const { withExecApprovalsLock } = await import(${JSON.stringify(mutationModuleUrl)});
    const {
      readExecApprovalsSnapshot,
      resolveExecApprovalsPath,
      restoreExecApprovalsSnapshot,
      saveExecApprovals,
    } = await import(${JSON.stringify(approvalsModuleUrl)});
    await withExecApprovalsLock({
      resolvePath: resolveExecApprovalsPath,
      readSnapshot: readExecApprovalsSnapshot,
      save: saveExecApprovals,
      restore: restoreExecApprovalsSnapshot,
    }, async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        kind: "save",
        file: {
          ...snapshot.file,
          agents: {
            ...snapshot.file.agents,
            [${JSON.stringify(agentId)}]: { allowlist: [{ pattern: ${JSON.stringify(
              `/usr/bin/${agentId}`,
            )} }] },
          },
        },
        result: undefined,
      };
    });
  `;
  const { OPENCLAW_STATE_DIR: _stateDir, ...env } = process.env;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        env: { ...env, OPENCLAW_HOME: homeDir },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Child approval mutation failed (${code}): ${stderr}`));
    });
  });
}

describe("exec approvals store helpers", () => {
  it("preserves concurrent cross-process mutations from fresh approval snapshots", async () => {
    const dir = createHomeDir();
    saveExecApprovals({ version: 1, agents: {} });

    await Promise.all([
      mutateApprovalsInChild(dir, "first"),
      mutateApprovalsInChild(dir, "second"),
    ]);

    expect(readApprovalsFile(dir).agents).toMatchObject({
      first: { allowlist: [{ pattern: "/usr/bin/first" }] },
      second: { allowlist: [{ pattern: "/usr/bin/second" }] },
    });
  });

  it("serializes concurrent mutations from fresh approval snapshots", async () => {
    const dir = createHomeDir();
    saveExecApprovals({ version: 1, agents: {} });

    let releaseFirstMutation!: () => void;
    const firstMutationMayFinish = new Promise<void>((resolve) => {
      releaseFirstMutation = resolve;
    });
    let firstMutationEntered!: () => void;
    const firstMutationHasLock = new Promise<void>((resolve) => {
      firstMutationEntered = resolve;
    });

    const first = withExecApprovalsLock(createExecApprovalsMutationStore(), async (snapshot) => {
      firstMutationEntered();
      await firstMutationMayFinish;
      return {
        kind: "save",
        file: {
          ...snapshot.file,
          agents: {
            ...snapshot.file.agents,
            first: { allowlist: [{ pattern: "/usr/bin/first" }] },
          },
        },
        result: undefined,
      };
    });
    await firstMutationHasLock;

    const second = withExecApprovalsLock(createExecApprovalsMutationStore(), (snapshot) => ({
      kind: "save",
      file: {
        ...snapshot.file,
        agents: {
          ...snapshot.file.agents,
          second: { allowlist: [{ pattern: "/usr/bin/second" }] },
        },
      },
      result: undefined,
    }));

    releaseFirstMutation();
    await Promise.all([first, second]);

    expect(readApprovalsFile(dir).agents).toMatchObject({
      first: { allowlist: [{ pattern: "/usr/bin/first" }] },
      second: { allowlist: [{ pattern: "/usr/bin/second" }] },
    });
  });

  it("fails closed when socket persistence contends with another writer", () => {
    const dir = createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        token: "held-by-another-writer",
      }),
      "utf8",
    );

    expect(() => resolveExecApprovals("main", { requireSocket: true })).toThrow(
      "Exec approvals update is already in progress",
    );
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(false);
  });

  it("reads non-socket policy while an async mutation owns the approvals lock", async () => {
    createHomeDir();
    saveExecApprovals({
      version: 1,
      defaults: { security: "allowlist", ask: "on-miss" },
      agents: {},
    });
    let releaseMutation!: () => void;
    let mutationEntered!: () => void;
    const mutationEnteredPromise = new Promise<void>((resolve) => {
      mutationEntered = resolve;
    });
    const releaseMutationPromise = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutation = withExecApprovalsLock(createExecApprovalsMutationStore(), async () => {
      mutationEntered();
      await releaseMutationPromise;
      return { kind: "unchanged", result: undefined };
    });
    await mutationEnteredPromise;

    const resolved = resolveExecApprovals("main", {
      security: "allowlist",
      ask: "on-miss",
    });

    expect(resolved.agent.security).toBe("allowlist");
    expect(resolved.agent.ask).toBe("on-miss");
    expect(resolved.token).toBe("");

    releaseMutation();
    await mutation;
  });

  it("reclaims a dead-owner lock before synchronous socket persistence", () => {
    const dir = createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: -1,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        token: "abandoned-writer",
      }),
      "utf8",
    );

    const resolved = resolveExecApprovals("main", { requireSocket: true });

    expect(resolved.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(true);
  });

  it("reclaims an expired incomplete lock before synchronous socket persistence", () => {
    const dir = createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "{", "utf8");
    const expiredAt = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, expiredAt, expiredAt);

    const resolved = resolveExecApprovals("main", { requireSocket: true });

    expect(resolved.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(true);
  });

  it("cleans up a replacement lock when its payload write fails after stale recovery", () => {
    createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "{", "utf8");
    const expiredAt = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, expiredAt, expiredAt);

    const actualWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (typeof file === "number") {
        throw new Error("lock payload write failed");
      }
      return actualWriteFileSync(file, data, options as never);
    });

    expect(() => resolveExecApprovals("main", { requireSocket: true })).toThrow(
      "lock payload write failed",
    );
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases the async mutation lock after a callback throws", async () => {
    createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;

    await expect(
      withExecApprovalsLock(createExecApprovalsMutationStore(), async () => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked lock destination", () => {
    const dir = createHomeDir();
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    const targetPath = path.join(dir, "unexpected-lock-target");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(targetPath, "target", "utf8");
    fs.symlinkSync(targetPath, lockPath);

    expect(() => resolveExecApprovals("main", { requireSocket: true })).toThrow(
      "Refusing to write exec approvals via symlink",
    );
    expect(fs.readFileSync(targetPath, "utf8")).toBe("target");
  });

  it("expands home-prefixed default file and socket paths", () => {
    const dir = createHomeDir();

    expect(path.normalize(resolveExecApprovalsPath())).toBe(
      path.normalize(path.join(dir, ".openclaw", "exec-approvals.json")),
    );
    expect(path.normalize(resolveExecApprovalsSocketPath())).toBe(
      path.normalize(path.join(dir, ".openclaw", "exec-approvals.sock")),
    );
    expect(resolveExecApprovalsDisplayPath()).toBe("~/.openclaw/exec-approvals.json");
  });

  it("uses OPENCLAW_STATE_DIR for default file and socket paths", () => {
    const dir = createHomeDir();
    const stateDir = path.join(dir, "custom-state");
    setTestEnvValue("OPENCLAW_STATE_DIR", stateDir);

    expect(path.normalize(resolveExecApprovalsPath())).toBe(
      path.normalize(stateApprovalsFilePath(stateDir)),
    );
    expect(path.normalize(resolveExecApprovalsSocketPath())).toBe(
      path.normalize(path.join(stateDir, "exec-approvals.sock")),
    );
    expect(resolveExecApprovalsDisplayPath()).toBe(stateApprovalsFilePath(stateDir));
    expect(resolveExecApprovalsTranscriptPath()).toBe("$OPENCLAW_STATE_DIR/exec-approvals.json");

    const ensured = ensureExecApprovals();

    expect(ensured.socket?.path).toBe(resolveExecApprovalsSocketPath());
    expect(fs.existsSync(stateApprovalsFilePath(stateDir))).toBe(true);
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(false);
  });

  it("fails closed without writing target approvals before state migration runs", () => {
    const dir = createHomeDir();
    const stateDir = path.join(dir, "custom-state");
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(
      approvalsFilePath(dir),
      `${JSON.stringify({
        version: 1,
        socket: {
          path: path.join(dir, ".openclaw", "exec-approvals.sock"),
          token: "legacy-token",
        },
        defaults: {
          security: "deny",
          ask: "always",
        },
        agents: {},
      })}\n`,
      "utf8",
    );
    setTestEnvValue("OPENCLAW_STATE_DIR", stateDir);

    const resolved = resolveExecApprovals("main", {
      security: "full",
      ask: "off",
    });

    expect(resolved.agent.security).toBe("deny");
    expect(resolved.agent.ask).toBe("always");
    expect(resolved.token).toBe("");
    expect(fs.existsSync(stateApprovalsFilePath(stateDir))).toBe(false);
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(true);

    const ensured = ensureExecApprovals();

    expect(ensured.defaults).toEqual({
      security: "deny",
      ask: "always",
      askFallback: "deny",
      autoAllowSkills: undefined,
    });
    expect(fs.existsSync(stateApprovalsFilePath(stateDir))).toBe(false);
  });

  it("does not create target approvals from last-used bookkeeping before state migration runs", () => {
    const dir = createHomeDir();
    const stateDir = path.join(dir, "custom-state");
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(
      approvalsFilePath(dir),
      `${JSON.stringify({
        version: 1,
        agents: {
          main: {
            allowlist: [{ pattern: "/usr/bin/rg" }],
          },
        },
      })}\n`,
      "utf8",
    );
    setTestEnvValue("OPENCLAW_STATE_DIR", stateDir);

    recordAllowlistUse({
      agentId: undefined,
      entry: { pattern: "/usr/bin/rg" },
      command: "rg needle",
      resolvedPath: "/usr/bin/rg",
    });

    expect(fs.existsSync(stateApprovalsFilePath(stateDir))).toBe(false);
    expect(JSON.parse(fs.readFileSync(approvalsFilePath(dir), "utf8"))).toEqual({
      version: 1,
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/rg" }],
        },
      },
    });
  });

  it("keeps the default approvals path when only legacy state exists", () => {
    const dir = createHomeDir();
    fs.mkdirSync(path.join(dir, ".clawdbot"), { recursive: true });

    expect(path.normalize(resolveExecApprovalsPath())).toBe(path.normalize(approvalsFilePath(dir)));

    ensureExecApprovals();

    expect(fs.existsSync(approvalsFilePath(dir))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".clawdbot", "exec-approvals.json"))).toBe(false);
  });

  it("merges socket defaults from normalized, current, and built-in fallback", () => {
    const normalized = normalizeExecApprovals({
      version: 1,
      agents: {},
      socket: { path: "/tmp/a.sock", token: "a" },
    });
    const current = normalizeExecApprovals({
      version: 1,
      agents: {},
      socket: { path: "/tmp/b.sock", token: "b" },
    });

    expect(mergeExecApprovalsSocketDefaults({ normalized, current }).socket).toEqual({
      path: "/tmp/a.sock",
      token: "a",
    });

    const merged = mergeExecApprovalsSocketDefaults({
      normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      current,
    });
    expect(merged.socket).toEqual({
      path: "/tmp/b.sock",
      token: "b",
    });

    createHomeDir();
    expect(
      mergeExecApprovalsSocketDefaults({
        normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      }).socket,
    ).toMatchObject({
      path: resolveExecApprovalsSocketPath(),
    });
    expect(
      mergeExecApprovalsSocketDefaults({
        normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      }).socket?.token,
    ).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const whitespaceCurrent: ExecApprovalsFile = {
      version: 1,
      agents: {},
      socket: { path: "  ", token: "  " },
    };
    const whitespaceMerged = mergeExecApprovalsSocketDefaults({
      normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      current: whitespaceCurrent,
    });
    expect(whitespaceMerged.socket?.path).toBe(resolveExecApprovalsSocketPath());
    expect(whitespaceMerged.socket?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("returns normalized empty snapshots for missing and invalid approvals files", () => {
    const dir = createHomeDir();

    const missing = readExecApprovalsSnapshot();
    expect(missing.exists).toBe(false);
    expect(missing.raw).toBeNull();
    expect(missing.file).toEqual(normalizeExecApprovals({ version: 1, agents: {} }));
    expect(path.normalize(missing.path)).toBe(path.normalize(approvalsFilePath(dir)));

    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(approvalsFilePath(dir), "{invalid", "utf8");

    const invalid = readExecApprovalsSnapshot();
    expect(invalid.exists).toBe(true);
    expect(invalid.raw).toBe("{invalid");
    expect(invalid.file).toEqual(normalizeExecApprovals({ version: 1, agents: {} }));
  });

  it("ensures approvals file with default socket path and generated token", () => {
    const dir = createHomeDir();

    const ensured = ensureExecApprovals();
    const raw = fs.readFileSync(approvalsFilePath(dir), "utf8");

    expect(ensured.socket?.path).toBe(resolveExecApprovalsSocketPath());
    expect(ensured.socket?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(raw.endsWith("\n")).toBe(true);
    expect(readApprovalsFile(dir).socket).toEqual(ensured.socket);
  });

  it("does not create an approvals file when resolving the missing default no-prompt policy", () => {
    const dir = createHomeDir();

    const resolved = resolveExecApprovals("main", {
      security: "full",
      ask: "off",
    });

    expect(resolved.agent.security).toBe("full");
    expect(resolved.agent.ask).toBe("off");
    expect(resolved.socketPath).toBe(resolveExecApprovalsSocketPath());
    expect(resolved.token).toBe("");
    expect(fs.existsSync(approvalsFilePath(dir))).toBe(false);
  });

  it("does not rewrite an empty approvals file for the default no-prompt policy", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(approvalsPath, "", "utf8");

    const resolved = resolveExecApprovals("main", {
      security: "full",
      ask: "off",
    });

    expect(resolved.agent.security).toBe("full");
    expect(resolved.agent.ask).toBe("off");
    expect(resolved.token).toBe("");
    expect(fs.statSync(approvalsPath).size).toBe(0);
  });

  it.runIf(process.platform !== "win32")(
    "hardens existing token-bearing approvals files before resolving default no-prompt policy",
    () => {
      const dir = createHomeDir();
      const approvalsPath = approvalsFilePath(dir);
      fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
      fs.writeFileSync(
        approvalsPath,
        JSON.stringify({
          version: 1,
          socket: { path: resolveExecApprovalsSocketPath(), token: "existing-token" },
          defaults: { security: "full", ask: "off" },
          agents: {},
        }),
        { mode: 0o644 },
      );
      fs.chmodSync(approvalsPath, 0o644);

      const resolved = resolveExecApprovals("main", {
        security: "full",
        ask: "off",
      });

      expect(resolved.agent.security).toBe("full");
      expect(resolved.agent.ask).toBe("off");
      expect(resolved.token).toBe("existing-token");
      expect(fs.statSync(approvalsPath).mode & 0o777).toBe(0o600);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects symlinked approvals files before resolving the default no-prompt policy",
    () => {
      const dir = createHomeDir();
      const approvalsPath = approvalsFilePath(dir);
      const linkedPath = path.join(dir, "linked-approvals.json");
      fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
      fs.writeFileSync(
        linkedPath,
        JSON.stringify({
          version: 1,
          defaults: { security: "full", ask: "off" },
          agents: {},
        }),
        "utf8",
      );
      fs.symlinkSync(linkedPath, approvalsPath);

      expect(() =>
        resolveExecApprovals("main", {
          security: "deny",
          ask: "always",
        }),
      ).toThrow("Refusing to write exec approvals via symlink");
    },
  );

  it("does not treat approvals path access errors as a missing default policy", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const actualReadFileSync = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation((target, options) => {
      if (String(target) === approvalsPath) {
        throw Object.assign(new Error("approval path blocked"), { code: "EACCES" });
      }
      return actualReadFileSync(target, options as never);
    });

    expect(() =>
      resolveExecApprovals("main", {
        security: "full",
        ask: "off",
      }),
    ).toThrow("approval path blocked");
  });

  it("creates an approvals file when resolving a missing policy that may prompt", () => {
    const dir = createHomeDir();

    const resolved = resolveExecApprovals("main", {
      security: "allowlist",
      ask: "on-miss",
    });

    expect(resolved.agent.security).toBe("allowlist");
    expect(resolved.agent.ask).toBe("on-miss");
    expect(resolved.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readApprovalsFile(dir).socket).toEqual(resolved.file.socket);
  });

  it("creates an approvals file for default no-prompt policy when a socket is required", () => {
    const dir = createHomeDir();

    const resolved = resolveExecApprovals("main", {
      security: "full",
      ask: "off",
      requireSocket: true,
    });

    expect(resolved.agent.security).toBe("full");
    expect(resolved.agent.ask).toBe("off");
    expect(resolved.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readApprovalsFile(dir).socket).toEqual(resolved.file.socket);
  });

  it("atomically replaces existing approvals files instead of mutating linked inodes", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const linkedPath = path.join(dir, "linked.json");
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(linkedPath, '{"sentinel":true}\n', "utf8");
    fs.linkSync(linkedPath, approvalsPath);

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(fs.readFileSync(approvalsPath, "utf8")).toContain('"security": "full"');
    expect(fs.readFileSync(linkedPath, "utf8")).toBe('{"sentinel":true}\n');
    expect(fs.statSync(approvalsPath).ino).not.toBe(fs.statSync(linkedPath).ino);
  });

  it("normalizes successful rename writes to owner-only permissions", () => {
    const dir = createHomeDir();
    const actualWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      const result = actualWriteFileSync(file, data, options as never);
      const filePath = String(file);
      if (
        typeof file !== "number" &&
        filePath.includes(".exec-approvals.") &&
        filePath.endsWith(".tmp")
      ) {
        fs.chmodSync(file, 0o000);
      }
      return result;
    });

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(fs.readFileSync(approvalsFilePath(dir), "utf8")).toContain('"security": "full"');
    expect(fs.statSync(approvalsFilePath(dir)).mode & 0o777).toBe(0o600);
  });

  it("normalizes the approvals directory to owner-only permissions", () => {
    const dir = createHomeDir();
    const approvalsDir = path.dirname(approvalsFilePath(dir));
    fs.mkdirSync(approvalsDir, { recursive: true });
    fs.chmodSync(approvalsDir, 0o777);

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(fs.readFileSync(approvalsFilePath(dir), "utf8")).toContain('"security": "full"');
    expect(fs.statSync(approvalsDir).mode & 0o777).toBe(0o700);
  });

  it.runIf(process.platform !== "win32")(
    "keeps exec approvals strict when directory chmod fails",
    () => {
      const dir = createHomeDir();
      const approvalsDir = path.dirname(approvalsFilePath(dir));
      const actualChmodSync = fs.chmodSync.bind(fs);
      vi.spyOn(fs, "chmodSync").mockImplementation((target, mode) => {
        if (String(target) === approvalsDir) {
          throw Object.assign(new Error("chmod denied"), { code: "EPERM" });
        }
        return actualChmodSync(target, mode);
      });

      expect(() => ensureExecApprovals()).toThrow("chmod denied");
      expect(fs.existsSync(approvalsFilePath(dir))).toBe(false);
    },
  );

  it("falls back to copying when rename cannot overwrite the approvals file", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(approvalsPath, '{"version":1,"agents":{}}\n', "utf8");
    const actualRenameSync = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === approvalsPath) {
        const error = Object.assign(new Error("locked target"), { code: "EPERM" });
        throw error;
      }
      return actualRenameSync(from, to);
    });

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(rename).toHaveBeenCalled();
    expect(fs.readFileSync(approvalsPath, "utf8")).toContain('"security": "full"');
    expect(fs.statSync(approvalsPath).mode & 0o777).toBe(0o600);
    expect(listExecApprovalTempFiles(dir)).toStrictEqual([]);
  });

  it("normalizes fallback temp files before copying", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(approvalsPath, '{"version":1,"agents":{}}\n', "utf8");
    const actualWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      const result = actualWriteFileSync(file, data, options as never);
      const filePath = String(file);
      if (
        typeof file !== "number" &&
        filePath.includes(".exec-approvals.") &&
        filePath.endsWith(".tmp")
      ) {
        fs.chmodSync(file, 0o000);
      }
      return result;
    });
    const actualRenameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === approvalsPath) {
        const error = Object.assign(new Error("locked target"), { code: "EPERM" });
        throw error;
      }
      return actualRenameSync(from, to);
    });

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(fs.readFileSync(approvalsPath, "utf8")).toContain('"security": "full"');
    expect(fs.statSync(approvalsPath).mode & 0o777).toBe(0o600);
    expect(listExecApprovalTempFiles(dir)).toStrictEqual([]);
  });

  it("restores the previous approvals file when fallback copy fails", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const previousRaw = '{"version":1,"defaults":{"security":"deny"},"agents":{}}\n';
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(approvalsPath, previousRaw, { encoding: "utf8", mode: 0o600 });
    const actualRenameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === approvalsPath) {
        const error = Object.assign(new Error("locked target"), { code: "EPERM" });
        throw error;
      }
      return actualRenameSync(from, to);
    });
    const actualFtruncateSync = fs.ftruncateSync.bind(fs);
    let forcedFallbackFailure = false;
    vi.spyOn(fs, "ftruncateSync").mockImplementation((fd, len) => {
      if (!forcedFallbackFailure && len === 0) {
        forcedFallbackFailure = true;
        actualFtruncateSync(fd, len);
        const error = Object.assign(new Error("copy failed after opening destination"), {
          code: "ENOSPC",
        });
        throw error;
      }
      return actualFtruncateSync(fd, len);
    });

    expect(() =>
      saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} }),
    ).toThrow(/copy failed after opening destination/);
    expect(fs.readFileSync(approvalsPath, "utf8")).toBe(previousRaw);
    expect(fs.statSync(approvalsPath).mode & 0o777).toBe(0o600);
    expect(listExecApprovalTempFiles(dir)).toStrictEqual([]);
  });

  it("does not follow a symlink swapped in before fallback copy", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const targetPath = path.join(dir, "elsewhere.json");
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(approvalsPath, '{"version":1,"agents":{}}\n', "utf8");
    fs.writeFileSync(targetPath, '{"sentinel":true}\n', "utf8");
    const actualRenameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === approvalsPath) {
        const error = Object.assign(new Error("locked target"), { code: "EPERM" });
        throw error;
      }
      return actualRenameSync(from, to);
    });
    const actualStatSync = fs.statSync.bind(fs);
    let swappedDestination = false;
    vi.spyOn(fs, "statSync").mockImplementation((file, options) => {
      const result = actualStatSync(file, options as never);
      if (!swappedDestination && String(file) === approvalsPath) {
        swappedDestination = true;
        fs.rmSync(approvalsPath);
        fs.symlinkSync(targetPath, approvalsPath);
      }
      return result;
    });

    expect(() =>
      saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} }),
    ).toThrow(/symlink|ELOOP/);
    expect(fs.readFileSync(targetPath, "utf8")).toBe('{"sentinel":true}\n');
    expect(listExecApprovalTempFiles(dir)).toStrictEqual([]);
  });

  it("does not use the copy fallback for hard-linked approvals files", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const linkedPath = path.join(dir, "linked.json");
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(linkedPath, '{"sentinel":true}\n', "utf8");
    fs.linkSync(linkedPath, approvalsPath);
    const actualRenameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === approvalsPath) {
        const error = Object.assign(new Error("locked target"), { code: "EPERM" });
        throw error;
      }
      return actualRenameSync(from, to);
    });

    expect(() =>
      saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} }),
    ).toThrow(/hard-linked exec approvals file/);
    expect(fs.readFileSync(linkedPath, "utf8")).toBe('{"sentinel":true}\n');
    expect(listExecApprovalTempFiles(dir)).toStrictEqual([]);
  });

  it("refuses to write approvals through a symlink destination", () => {
    const dir = createHomeDir();
    const approvalsPath = approvalsFilePath(dir);
    const targetPath = path.join(dir, "elsewhere.json");
    fs.mkdirSync(path.dirname(approvalsPath), { recursive: true });
    fs.writeFileSync(targetPath, '{"sentinel":true}\n', "utf8");
    fs.symlinkSync(targetPath, approvalsPath);

    expect(() =>
      saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} }),
    ).toThrow(/Refusing to write exec approvals via symlink/);
    expect(fs.readFileSync(targetPath, "utf8")).toBe('{"sentinel":true}\n');
  });

  it("accepts a symlinked OPENCLAW_HOME as the trusted approvals root", () => {
    const realHome = makeTempDir();
    const linkedHome = `${realHome}-link`;
    tempDirs.push(realHome, linkedHome);
    fs.symlinkSync(realHome, linkedHome, "dir");
    setTestEnvValue("OPENCLAW_HOME", linkedHome);

    saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} });

    expect(
      fs.readFileSync(path.join(realHome, ".openclaw", "exec-approvals.json"), "utf8"),
    ).toContain('"security": "full"');
  });

  it("refuses to traverse symlinked approvals components below a symlinked home", () => {
    const realHome = makeTempDir();
    const linkedHome = `${realHome}-link`;
    const linkedStateTarget = path.join(realHome, "state-target");
    tempDirs.push(realHome, linkedHome);
    fs.mkdirSync(linkedStateTarget, { recursive: true });
    fs.symlinkSync(realHome, linkedHome, "dir");
    fs.symlinkSync(linkedStateTarget, path.join(realHome, ".openclaw"), "dir");
    setTestEnvValue("OPENCLAW_HOME", linkedHome);

    expect(() =>
      saveExecApprovals({ version: 1, defaults: { security: "full" }, agents: {} }),
    ).toThrow(/Refusing to traverse symlink in exec approvals path/);
    expect(fs.existsSync(path.join(linkedStateTarget, "exec-approvals.json"))).toBe(false);
  });

  it("persists exact-command allow-always decisions from a fresh approval snapshot", async () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(321_000);

    await persistAllowAlwaysDecision({
      agentId: "worker",
      decision: {
        kind: "exact-command",
        commandText: 'printenv API_KEY="secret-value"',
      },
    });

    const allowlist = allowlistEntries(dir, "worker");
    expect(allowlist).toHaveLength(1);
    expectAllowlistEntryFields(allowlist[0] ?? {}, {
      source: "allow-always",
      lastUsedAt: 321_000,
    });
    expect(allowlist[0]?.pattern).toMatch(/^=command:[0-9a-f]{16}$/i);
    expect(allowlist[0]).not.toHaveProperty("commandText");
  });

  it("strips legacy plaintext command text during normalization", () => {
    const normalized = normalizeExecApprovals({
      version: 1,
      agents: {
        main: {
          allowlist: [
            {
              pattern: "=command:test",
              source: "allow-always",
              commandText: "echo secret-token",
            },
          ],
        },
      },
    });
    const allowlist = normalized.agents?.main?.allowlist ?? [];
    expect(allowlist).toHaveLength(1);
    expect(allowlist[0]?.pattern).toBe("=command:test");
    expect(allowlist[0]?.source).toBe("allow-always");
    expect(allowlist[0]).not.toHaveProperty("commandText");
  });

  it("preserves source and argPattern metadata for allow-always entries", async () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(321_000);

    await persistAllowAlwaysDecision({
      agentId: "worker",
      decision: {
        kind: "patterns",
        patterns: [
          { pattern: "/usr/bin/python3", argPattern: "^script\\.py\x00$" },
          { pattern: "/usr/bin/python3", argPattern: "^script\\.py\x00$" },
          { pattern: "/usr/bin/python3", argPattern: "^other\\.py\x00$" },
        ],
      },
    });

    const allowlist = allowlistEntries(dir, "worker");
    expect(allowlist).toHaveLength(2);
    expectAllowlistEntryFields(allowlist[0] ?? {}, {
      pattern: "/usr/bin/python3",
      argPattern: "^script\\.py\x00$",
      source: "allow-always",
      lastUsedAt: 321_000,
    });
    expectAllowlistEntryFields(allowlist[1] ?? {}, {
      pattern: "/usr/bin/python3",
      argPattern: "^other\\.py\x00$",
      source: "allow-always",
      lastUsedAt: 321_000,
    });
  });

  it("records allowlist usage from a fresh approval snapshot and backfills missing ids", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(999_000);

    const approvals: ExecApprovalsFile = {
      version: 1,
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/rg" }, { pattern: "/usr/bin/jq", id: "keep-id" }],
        },
      },
    };
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(approvalsFilePath(dir), JSON.stringify(approvals, null, 2), "utf8");

    recordAllowlistUse({
      agentId: undefined,
      entry: { pattern: "/usr/bin/rg" },
      command: "rg needle",
      resolvedPath: "/opt/homebrew/bin/rg",
    });

    const allowlist = allowlistEntries(dir, "main");
    expect(allowlist).toHaveLength(2);
    expectAllowlistEntryFields(allowlist[0] ?? {}, {
      pattern: "/usr/bin/rg",
      lastUsedAt: 999_000,
      lastUsedCommand: "rg needle",
      lastResolvedPath: "/opt/homebrew/bin/rg",
    });
    expect(allowlist[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(allowlist[1]).toEqual({ pattern: "/usr/bin/jq", id: "keep-id" });
  });

  it("skips last-used bookkeeping when another writer holds the lock", () => {
    const dir = createHomeDir();
    saveExecApprovals({
      version: 1,
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/rg" }],
        },
      },
    });
    const lockPath = `${resolveExecApprovalsPath()}.lock`;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );

    recordAllowlistUse({
      agentId: undefined,
      entry: { pattern: "/usr/bin/rg" },
      command: "rg needle",
      resolvedPath: "/opt/homebrew/bin/rg",
    });

    expect(allowlistEntries(dir, "main")).toEqual([{ pattern: "/usr/bin/rg" }]);
  });

  it("dedupes allowlist usage by pattern and argPattern", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(777_000);

    const approvals: ExecApprovalsFile = {
      version: 1,
      agents: {
        main: {
          allowlist: [
            { pattern: "/usr/bin/python3", argPattern: "^a\\.py\x00$" },
            { pattern: "/usr/bin/python3", argPattern: "^b\\.py\x00$" },
          ],
        },
      },
    };
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(approvalsFilePath(dir), JSON.stringify(approvals, null, 2), "utf8");

    recordAllowlistMatchesUse({
      agentId: undefined,
      matches: [
        { pattern: "/usr/bin/python3", argPattern: "^a\\.py\x00$" },
        { pattern: "/usr/bin/python3", argPattern: "^a\\.py\x00$" },
        { pattern: "/usr/bin/python3", argPattern: "^b\\.py\x00$" },
      ],
      command: "python3 a.py",
      resolvedPath: "/usr/bin/python3",
    });

    const allowlist = allowlistEntries(dir, "main");
    expect(allowlist).toHaveLength(2);
    expectAllowlistEntryFields(allowlist[0] ?? {}, {
      pattern: "/usr/bin/python3",
      argPattern: "^a\\.py\x00$",
      lastUsedAt: 777_000,
    });
    expectAllowlistEntryFields(allowlist[1] ?? {}, {
      pattern: "/usr/bin/python3",
      argPattern: "^b\\.py\x00$",
      lastUsedAt: 777_000,
    });
  });

  it("returns null when approval socket credentials are missing", async () => {
    await expect(
      requestExecApprovalViaSocket({
        socketPath: "",
        token: "secret",
        request: { command: "echo hi" },
      }),
    ).resolves.toBeNull();
    await expect(
      requestExecApprovalViaSocket({
        socketPath: "/tmp/socket",
        token: "",
        request: { command: "echo hi" },
      }),
    ).resolves.toBeNull();
    expect(requestJsonlSocketMock).not.toHaveBeenCalled();
  });

  it("builds approval socket payloads and accepts decision responses only", async () => {
    requestJsonlSocketMock.mockImplementationOnce(async ({ requestLine, accept, timeoutMs }) => {
      expect(timeoutMs).toBe(15_000);
      const parsed = JSON.parse(requestLine) as {
        type: string;
        token: string;
        id: string;
        request: { command: string };
      };
      expect(parsed.type).toBe("request");
      expect(parsed.token).toBe("secret");
      expect(parsed.request).toEqual({ command: "echo hi" });
      expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(accept({ type: "noop", decision: "allow-once" })).toBeUndefined();
      expect(accept({ type: "decision", decision: "allow-always" })).toBe("allow-always");
      return "deny";
    });

    await expect(
      requestExecApprovalViaSocket({
        socketPath: "/tmp/socket",
        token: "secret",
        request: { command: "echo hi" },
      }),
    ).resolves.toBe("deny");
  });
});
