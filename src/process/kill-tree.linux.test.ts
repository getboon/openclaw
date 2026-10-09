// Real-process coverage for non-detached process-tree termination on Linux.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { signalProcessTree } from "./kill-tree.js";

const spawnedPids: number[] = [];

function isAlive(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
  } catch {
    return false;
  }
}

function killIfStillTestSleep(pid: number): void {
  try {
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (commandLine.includes("sleep") && commandLine.includes("300")) {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

function findChildPids(parentPid: number): number[] {
  const children: number[] = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[1]) === parentPid) {
        children.push(Number(entry));
      }
    } catch {
      // Process exited while scanning.
    }
  }
  return children;
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  return undefined;
}

describe.runIf(process.platform === "linux")("signalProcessTree on Linux", () => {
  afterEach(() => {
    for (const pid of spawnedPids.splice(0)) {
      killIfStillTestSleep(pid);
    }
  });

  it("kills the grandchild of a non-detached shell", async () => {
    const child = spawn("bash", ["-c", "sleep 300 && echo done"], {
      detached: false,
      stdio: "ignore",
    });
    const shellPid = child.pid;
    expect(shellPid).toBeTypeOf("number");
    if (shellPid === undefined) {
      return;
    }
    spawnedPids.push(shellPid);
    const sleepPid = await waitFor(() => findChildPids(shellPid)[0], 3_000);
    expect(sleepPid).toBeTypeOf("number");
    if (sleepPid === undefined) {
      return;
    }
    spawnedPids.push(sleepPid);

    signalProcessTree(shellPid, "SIGTERM", { detached: false });

    const shellExited = () => child.exitCode !== null || child.signalCode !== null;
    const treeGone = await waitFor(
      () => (shellExited() && !isAlive(sleepPid) ? true : undefined),
      3_000,
    );
    expect(treeGone).toBe(true);
  });
});
