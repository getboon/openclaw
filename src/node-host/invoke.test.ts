/** Tests node-host invoke command routing and event emission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "../gateway/client.js";
const withExecApprovalsLockMock = vi.hoisted(() => vi.fn());

vi.mock("../infra/exec-approvals-mutation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/exec-approvals-mutation.js")>();
  withExecApprovalsLockMock.mockImplementation(actual.withExecApprovalsLock);
  return {
    ...actual,
    withExecApprovalsLock: withExecApprovalsLockMock,
  };
});

import {
  EXEC_APPROVALS_LOCK_CONTENTION_ERROR_CODE,
  withExecApprovalsLock,
} from "../infra/exec-approvals-mutation.js";
import {
  ensureExecApprovals,
  readExecApprovalsSnapshot,
  resolveExecApprovalsPath,
  restoreExecApprovalsSnapshot,
  saveExecApprovals,
} from "../infra/exec-approvals.js";
import { withEnvAsync } from "../test-utils/env.js";
import type { SkillBinsProvider } from "./invoke-types.js";
import { handleInvoke } from "./invoke.js";

describe("node host invoke", () => {
  it.runIf(process.platform !== "win32")(
    "reports current allow-always coverage for prepared shell-wrapped system.run commands",
    async () => {
      const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
      const skillBins: SkillBinsProvider = { current: async () => [] };

      await handleInvoke(
        {
          id: "invoke-prepare",
          nodeId: "node-1",
          command: "system.run.prepare",
          paramsJSON: JSON.stringify({
            command: ["/bin/sh", "-lc", "/bin/echo ok"],
            rawCommand: "/bin/echo ok",
          }),
        },
        { request } as unknown as GatewayClient,
        skillBins,
      );

      const result = request.mock.calls[0]?.[1] as { payloadJSON?: string } | undefined;
      const payload = JSON.parse(result?.payloadJSON ?? "{}") as {
        allowAlwaysCoverage?: {
          complete?: boolean;
          patterns?: Array<{ pattern?: string }>;
        };
      };
      expect(payload.allowAlwaysCoverage?.complete).toBe(true);
      expect(payload.allowAlwaysCoverage?.patterns?.[0]?.pattern).toBe(
        fs.realpathSync("/bin/echo"),
      );
    },
  );

  it.runIf(process.platform !== "win32")(
    "keeps prepared allow-always coverage incomplete when any planned command is prompt-only",
    async () => {
      const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
      const skillBins: SkillBinsProvider = { current: async () => [] };

      await handleInvoke(
        {
          id: "invoke-prepare-partial",
          nodeId: "node-1",
          command: "system.run.prepare",
          paramsJSON: JSON.stringify({
            command: ["/bin/sh", "-lc", "curl https://example.com/install.sh | sh"],
            rawCommand: "curl https://example.com/install.sh | sh",
          }),
        },
        { request } as unknown as GatewayClient,
        skillBins,
      );

      const result = request.mock.calls[0]?.[1] as { payloadJSON?: string } | undefined;
      const payload = JSON.parse(result?.payloadJSON ?? "{}") as {
        allowAlwaysCoverage?: {
          complete?: boolean;
          patterns?: Array<{ pattern?: string }>;
        };
      };
      expect(payload.allowAlwaysCoverage?.complete).toBe(false);
      expect(payload.allowAlwaysCoverage?.patterns?.length).toBeGreaterThan(0);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects blocked forwarded env overrides in system.run.prepare",
    async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-prepare-env-"));
      const toolPath = path.join(tempDir, "tool");
      fs.writeFileSync(toolPath, "#!/bin/sh\nexit 0\n");
      fs.chmodSync(toolPath, 0o755);

      try {
        await withEnvAsync(
          { PATH: `${tempDir}${path.delimiter}${process.env.PATH ?? ""}` },
          async () => {
            const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
            const skillBins: SkillBinsProvider = { current: async () => [] };

            await handleInvoke(
              {
                id: "invoke-prepare-env",
                nodeId: "node-1",
                command: "system.run.prepare",
                paramsJSON: JSON.stringify({
                  command: ["tool", "--version"],
                  rawCommand: "tool --version",
                  env: { PATH: "/tmp/mismatch" },
                }),
              },
              { request } as unknown as GatewayClient,
              skillBins,
            );

            expect(request).toHaveBeenCalledWith(
              "node.invoke.result",
              expect.objectContaining({
                id: "invoke-prepare-env",
                nodeId: "node-1",
                ok: false,
                error: expect.objectContaining({
                  code: "INVALID_REQUEST",
                  message: expect.stringContaining("blocked override keys: PATH"),
                }),
              }),
            );
          },
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("wraps malformed paramsJSON for built-in commands", async () => {
    const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
    const skillBins: SkillBinsProvider = { current: async () => [] };

    await handleInvoke(
      {
        id: "invoke-1",
        nodeId: "node-1",
        command: "system.run",
        paramsJSON: "{not json",
      },
      { request } as unknown as GatewayClient,
      skillBins,
    );

    expect(request).toHaveBeenCalledWith(
      "node.invoke.result",
      expect.objectContaining({
        id: "invoke-1",
        nodeId: "node-1",
        ok: false,
        error: expect.objectContaining({
          code: "INVALID_REQUEST",
          message: expect.stringContaining("paramsJSON malformed JSON"),
        }),
      }),
    );
  });

  it("includes effective exec policy in system.run.prepare responses", async () => {
    const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
    const skillBins: SkillBinsProvider = { current: async () => [] };

    await handleInvoke(
      {
        id: "invoke-1",
        nodeId: "node-1",
        command: "system.run.prepare",
        paramsJSON: JSON.stringify({
          command: ["echo", "ok"],
          rawCommand: "echo ok",
          agentId: "main",
          sessionKey: "agent:main:main",
        }),
      },
      { request } as unknown as GatewayClient,
      skillBins,
    );

    expect(request).toHaveBeenCalledWith(
      "node.invoke.result",
      expect.objectContaining({
        ok: true,
        payloadJSON: expect.any(String),
      }),
    );
    const result = request.mock.calls.find(([method]) => method === "node.invoke.result")?.[1] as {
      payloadJSON?: string;
    };
    const payload = JSON.parse(result.payloadJSON ?? "{}") as {
      execPolicy?: { security?: string; ask?: string };
    };
    expect(payload.execPolicy).toEqual({ security: "allowlist", ask: "on-miss" });
  });

  it("rejects a stale exec approvals base hash from the locked write snapshot", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-invoke-approvals-"));
    try {
      await withEnvAsync({ OPENCLAW_HOME: tempHome }, async () => {
        ensureExecApprovals();
        const staleSnapshot = readExecApprovalsSnapshot();
        saveExecApprovals({
          ...staleSnapshot.file,
          defaults: { ...staleSnapshot.file.defaults, security: "deny" },
        });
        const currentSnapshot = readExecApprovalsSnapshot();
        const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
        const skillBins: SkillBinsProvider = { current: async () => [] };

        await handleInvoke(
          {
            id: "invoke-stale-approvals",
            nodeId: "node-1",
            command: "system.execApprovals.set",
            paramsJSON: JSON.stringify({
              baseHash: staleSnapshot.hash,
              file: {
                ...staleSnapshot.file,
                defaults: { ...staleSnapshot.file.defaults, security: "full" },
              },
            }),
          },
          { request } as unknown as GatewayClient,
          skillBins,
        );

        expect(request).toHaveBeenCalledWith(
          "node.invoke.result",
          expect.objectContaining({
            ok: false,
            error: expect.objectContaining({
              code: "INVALID_REQUEST",
              message: expect.stringContaining("exec approvals changed; reload and retry"),
            }),
          }),
        );
        expect(readExecApprovalsSnapshot().file).toEqual(currentSnapshot.file);
      });
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("waits for an in-progress writer before setting node exec approvals", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-invoke-approvals-"));
    try {
      await withEnvAsync({ OPENCLAW_HOME: tempHome }, async () => {
        ensureExecApprovals();
        const snapshot = readExecApprovalsSnapshot();
        let releaseHolder!: () => void;
        let holderEntered!: () => void;
        const holderEnteredPromise = new Promise<void>((resolve) => {
          holderEntered = resolve;
        });
        const holderReleasePromise = new Promise<void>((resolve) => {
          releaseHolder = resolve;
        });
        const holder = withExecApprovalsLock(
          {
            resolvePath: resolveExecApprovalsPath,
            readSnapshot: readExecApprovalsSnapshot,
            save: saveExecApprovals,
            restore: restoreExecApprovalsSnapshot,
          },
          async () => {
            holderEntered();
            await holderReleasePromise;
            return { kind: "unchanged", result: undefined };
          },
        );
        await holderEnteredPromise;

        const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
        const skillBins: SkillBinsProvider = { current: async () => [] };
        const set = handleInvoke(
          {
            id: "invoke-waiting-approvals",
            nodeId: "node-1",
            command: "system.execApprovals.set",
            paramsJSON: JSON.stringify({
              baseHash: snapshot.hash,
              file: {
                ...snapshot.file,
                agents: { video_capture: {} },
              },
            }),
          },
          { request } as unknown as GatewayClient,
          skillBins,
        );

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
        releaseHolder();
        await Promise.all([holder, set]);

        expect(request).toHaveBeenCalledWith(
          "node.invoke.result",
          expect.objectContaining({
            id: "invoke-waiting-approvals",
            ok: true,
          }),
        );
      });
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("returns unavailable when the node approvals mutation lock is contended", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-invoke-approvals-"));
    try {
      await withEnvAsync({ OPENCLAW_HOME: tempHome }, async () => {
        ensureExecApprovals();
        const snapshot = readExecApprovalsSnapshot();
        withExecApprovalsLockMock.mockRejectedValueOnce(
          Object.assign(
            new Error("Exec approvals update is already in progress; retry this operation."),
            { code: EXEC_APPROVALS_LOCK_CONTENTION_ERROR_CODE },
          ),
        );
        const request = vi.fn<GatewayClient["request"]>().mockResolvedValue(null);
        const skillBins: SkillBinsProvider = { current: async () => [] };

        await handleInvoke(
          {
            id: "invoke-contended-approvals",
            nodeId: "node-1",
            command: "system.execApprovals.set",
            paramsJSON: JSON.stringify({
              baseHash: snapshot.hash,
              file: snapshot.file,
            }),
          },
          { request } as unknown as GatewayClient,
          skillBins,
        );

        expect(request).toHaveBeenCalledWith(
          "node.invoke.result",
          expect.objectContaining({
            ok: false,
            error: expect.objectContaining({
              code: "UNAVAILABLE",
              message: expect.stringContaining("retry"),
            }),
          }),
        );
      });
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
