// Real-process coverage for stopping exec commands when the gateway runs as a service.
import fs from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeat: vi.fn(),
}));

let killExecProcessesForSessions: typeof import("./bash-process-abort.js").killExecProcessesForSessions;
let resetProcessRegistryForTests: typeof import("./bash-process-registry.js").resetProcessRegistryForTests;
let resolveProcessToolScopeKey: typeof import("./agent-tools.js").resolveProcessToolScopeKey;
let runExecProcess: typeof import("./bash-tools.exec-runtime.js").runExecProcess;

const sessionKey = "agent:main:789:thread-1:thread:1";
const leftoverPids: number[] = [];

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

function findDescendantPids(rootPid: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const parentPid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      childrenByParent.set(parentPid, [...(childrenByParent.get(parentPid) ?? []), Number(entry)]);
    } catch {
      // Process exited while scanning.
    }
  }
  const descendants: number[] = [];
  const queue = [rootPid];
  while (queue.length > 0) {
    for (const child of childrenByParent.get(queue.shift() as number) ?? []) {
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

function readCommandLine(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
  } catch {
    return "";
  }
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

describe.runIf(process.platform === "linux")("killExecProcessesForSessions in service mode", () => {
  beforeAll(async () => {
    ({ killExecProcessesForSessions } = await import("./bash-process-abort.js"));
    ({ resetProcessRegistryForTests } = await import("./bash-process-registry.js"));
    ({ resolveProcessToolScopeKey } = await import("./agent-tools.js"));
    ({ runExecProcess } = await import("./bash-tools.exec-runtime.js"));
  });

  beforeEach(() => {
    vi.stubEnv("OPENCLAW_SERVICE_MARKER", "openclaw-test");
    resetProcessRegistryForTests();
  });

  afterEach(() => {
    for (const pid of leftoverPids.splice(0)) {
      killIfStillTestSleep(pid);
    }
    resetProcessRegistryForTests();
    vi.unstubAllEnvs();
  });

  it("stops the grandchild of a non-detached exec shell", async () => {
    const run = await runExecProcess({
      command: "sleep 300 && echo done",
      workdir: process.cwd(),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      usePty: false,
      warnings: [],
      maxOutput: 1000,
      pendingMaxOutput: 1000,
      notifyOnExit: false,
      notifyOnExitEmptySuccess: false,
      sessionKey,
      scopeKey: resolveProcessToolScopeKey({ sessionKey }),
      timeoutSec: null,
    });
    const shellPid = run.session.pid;
    expect(shellPid).toBeTypeOf("number");
    if (shellPid === undefined) {
      return;
    }
    leftoverPids.push(shellPid);
    const sleepPid = await waitFor(
      () => findDescendantPids(shellPid).find((pid) => readCommandLine(pid) === "sleep 300"),
      3_000,
    );
    expect(sleepPid).toBeTypeOf("number");
    if (sleepPid === undefined) {
      return;
    }
    leftoverPids.push(sleepPid);

    expect(killExecProcessesForSessions([sessionKey])).toBe(1);
    await run.promise;

    const sleepGone = await waitFor(() => (!isAlive(sleepPid) ? true : undefined), 3_000);
    expect(sleepGone).toBe(true);
  });
});
