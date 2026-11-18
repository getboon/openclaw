// Covers Windows filesystem security audit behavior.
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectFilesystemFindings } from "./audit.js";
import { AsyncTempCaseFactory } from "./test-temp-cases.js";

const windowsAuditEnv = {
  USERNAME: "Tester",
  USERDOMAIN: "DESKTOP-TEST",
};

const TESTER_SID = "S-1-5-21-1-2-3-1001";

// fs-safe 0.8 inspects Windows permissions with a PowerShell owner query
// (owner SID, current user SID, principal name -> SID map) before icacls, and
// reports "unknown" (no findings) when that query fails. Answer it as upstream
// does (v2026.9.4); every other command is the icacls listing.
function windowsSidQueryResult(command: string): { stdout: string; stderr: string } | undefined {
  if (!command.toLowerCase().endsWith("powershell.exe")) {
    return undefined;
  }
  return {
    stdout: JSON.stringify({
      ownerSid: TESTER_SID,
      currentUserSid: TESTER_SID,
      principalSids: [
        { name: "NT AUTHORITY\\SYSTEM", sid: "S-1-5-18" },
        { name: "BUILTIN\\Users", sid: "S-1-5-32-545" },
        { name: "DESKTOP-TEST\\Tester", sid: TESTER_SID },
      ],
      principalTranslationFailed: false,
      remote: false,
    }),
    stderr: "",
  };
}

describe("security audit filesystem Windows findings", () => {
  const tempCases = new AsyncTempCaseFactory("openclaw-security-audit-win-");

  beforeAll(async () => {
    await tempCases.setup();
  });

  afterAll(async () => {
    await tempCases.cleanup();
  });

  it("evaluates Windows ACL-derived filesystem findings", async () => {
    await Promise.all([
      (async () => {
        const tmp = await tempCases.makeTmpDir("win");
        const stateDir = path.join(tmp, "state");
        await fs.mkdir(stateDir, { recursive: true });
        const configPath = path.join(stateDir, "openclaw.json");
        await fs.writeFile(configPath, "{}\n", "utf-8");
        const findings = await collectFilesystemFindings({
          stateDir,
          configPath,
          platform: "win32",
          env: windowsAuditEnv,
          execIcacls: async (cmd: string, args: string[]) =>
            windowsSidQueryResult(cmd) ?? {
              stdout: `${args[0]} NT AUTHORITY\\SYSTEM:(F)\n DESKTOP-TEST\\Tester:(F)\n`,
              stderr: "",
            },
        });
        const forbidden = new Set([
          "fs.state_dir.perms_world_writable",
          "fs.state_dir.perms_group_writable",
          "fs.state_dir.perms_readable",
          "fs.config.perms_writable",
          "fs.config.perms_world_readable",
          "fs.config.perms_group_readable",
        ]);
        for (const id of forbidden) {
          expect(
            findings.some((finding) => finding.checkId === id),
            id,
          ).toBe(false);
        }
      })(),
      (async () => {
        const tmp = await tempCases.makeTmpDir("win-open");
        const stateDir = path.join(tmp, "state");
        await fs.mkdir(stateDir, { recursive: true });
        const configPath = path.join(stateDir, "openclaw.json");
        await fs.writeFile(configPath, "{}\n", "utf-8");
        const findings = await collectFilesystemFindings({
          stateDir,
          configPath,
          platform: "win32",
          env: windowsAuditEnv,
          execIcacls: async (cmd: string, args: string[]) => {
            const sidQuery = windowsSidQueryResult(cmd);
            if (sidQuery) {
              return sidQuery;
            }
            const target = args[0];
            if (target.endsWith(`${path.sep}state`)) {
              return {
                stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Users:(RX)\n DESKTOP-TEST\\Tester:(F)\n`,
                stderr: "",
              };
            }
            return {
              stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n DESKTOP-TEST\\Tester:(F)\n`,
              stderr: "",
            };
          },
        });
        expect(
          findings.some(
            (finding) =>
              finding.checkId === "fs.state_dir.perms_readable" && finding.severity === "warn",
          ),
        ).toBe(true);
      })(),
      (async () => {
        const tmp = await tempCases.makeTmpDir("win-anon-world");
        const stateDir = path.join(tmp, "state");
        await fs.mkdir(stateDir, { recursive: true });
        const configPath = path.join(stateDir, "openclaw.json");
        await fs.writeFile(configPath, "{}\n", "utf-8");
        const findings = await collectFilesystemFindings({
          stateDir,
          configPath,
          platform: "win32",
          env: windowsAuditEnv,
          execIcacls: async (cmd: string, args: string[]) => {
            const sidQuery = windowsSidQueryResult(cmd);
            if (sidQuery) {
              return sidQuery;
            }
            const target = args[0];
            if (target.endsWith(`${path.sep}state`)) {
              return {
                stdout: `${target} *S-1-5-18:(F)\n *S-1-5-7:(F)\n`,
                stderr: "",
              };
            }
            return {
              stdout: `${target} *S-1-5-18:(F)\n DESKTOP-TEST\\Tester:(F)\n`,
              stderr: "",
            };
          },
        });
        expect(
          findings.some(
            (finding) =>
              finding.checkId === "fs.state_dir.perms_world_writable" &&
              finding.severity === "critical",
          ),
        ).toBe(true);
        expect(
          findings.some((finding) => finding.checkId === "fs.state_dir.perms_group_writable"),
        ).toBe(false);
      })(),
    ]);
  });
});
