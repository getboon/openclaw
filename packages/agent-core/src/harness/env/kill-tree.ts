// Agent Core module implements kill tree behavior.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const DEFAULT_GRACE_MS = 3000;
const MAX_GRACE_MS = 60_000;

export type KillProcessTreeOptions = {
  graceMs?: number;
  detached?: boolean;
  force?: boolean;
};

/**
 * Best-effort process-tree termination with graceful shutdown.
 * - Windows: use taskkill /T to include descendants. Sends SIGTERM-equivalent
 *   first (without /F), then force-kills if process survives.
 * - Unix: send SIGTERM to process group first, wait grace period, then SIGKILL.
 *
 * When the child was spawned with `detached: false`, pass `detached: false` to
 * skip the Unix `process.kill(-pid, ...)` group-kill. That avoids signaling the
 * gateway's own process group.
 */
export function killProcessTree(pid: number, opts?: KillProcessTreeOptions): void {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    if (opts?.force === true) {
      signalProcessTreeWindows(pid, "SIGKILL");
      return;
    }
    const graceMs = normalizeGraceMs(opts?.graceMs);
    killProcessTreeWindows(pid, graceMs);
    return;
  }

  const useGroupKill = opts?.detached !== false;
  if (opts?.force === true) {
    signalProcessTreeUnix(pid, "SIGKILL", useGroupKill);
    return;
  }

  const graceMs = normalizeGraceMs(opts?.graceMs);
  signalProcessTreeUnix(pid, "SIGTERM", useGroupKill);
  setTimeout(() => {
    const stillAlive = useGroupKill
      ? isProcessAlive(-pid) || isProcessAlive(pid)
      : isProcessAlive(pid);
    if (!stillAlive) {
      return;
    }
    signalProcessTreeUnix(pid, "SIGKILL", useGroupKill);
  }, graceMs).unref();
}

export function signalProcessTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
  opts?: { detached?: boolean },
): void {
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }

  if (process.platform === "win32") {
    signalProcessTreeWindows(pid, signal);
    return;
  }

  signalProcessTreeUnix(pid, signal, opts?.detached !== false);
}

function normalizeGraceMs(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GRACE_MS;
  }
  return Math.max(0, Math.min(MAX_GRACE_MS, Math.floor(value)));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessTreeUnix(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
  useGroupKill: boolean,
): void {
  if (useGroupKill) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Process group does not exist or we lack permission; try direct pid.
    }
  }

  // A non-detached child shares the gateway's process group, so its descendants
  // can only be reached one pid at a time.
  const descendants =
    !useGroupKill && process.platform === "linux" ? listSignalableDescendantsLinux(pid) : [];
  for (const descendant of descendants) {
    signalPid(descendant, signal);
  }
  signalPid(pid, signal);
}

function signalPid(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function listSignalableDescendantsLinux(rootPid: number): number[] {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }
  const childrenByParent = new Map<number, number[]>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const parentPid = readParentPidLinux(entry);
    if (parentPid === undefined) {
      continue;
    }
    const siblings = childrenByParent.get(parentPid);
    if (siblings) {
      siblings.push(Number(entry));
    } else {
      childrenByParent.set(parentPid, [Number(entry)]);
    }
  }
  const protectedPids = new Set([process.pid, process.ppid]);
  const descendants: number[] = [];
  const visited = new Set([rootPid]);
  const queue = [rootPid];
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const child of childrenByParent.get(parent) ?? []) {
      if (visited.has(child)) {
        continue;
      }
      visited.add(child);
      if (child > 1 && !protectedPids.has(child)) {
        descendants.push(child);
        queue.push(child);
      }
    }
  }
  return descendants;
}

function readParentPidLinux(pid: string): number | undefined {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
  // The command name field may contain spaces and parentheses, so fields start after the last ")".
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) {
    return undefined;
  }
  const parentPid = Number(stat.slice(commandEnd + 2).split(" ")[1]);
  return Number.isInteger(parentPid) ? parentPid : undefined;
}

function runTaskkill(args: string[]): void {
  try {
    spawn("taskkill", args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
  } catch {
    // Ignore taskkill spawn failures.
  }
}

function killProcessTreeWindows(pid: number, graceMs: number): void {
  signalProcessTreeWindows(pid, "SIGTERM");

  setTimeout(() => {
    if (!isProcessAlive(pid)) {
      return;
    }
    signalProcessTreeWindows(pid, "SIGKILL");
  }, graceMs).unref();
}

function signalProcessTreeWindows(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  const args =
    signal === "SIGKILL" ? ["/F", "/T", "/PID", String(pid)] : ["/T", "/PID", String(pid)];
  runTaskkill(args);
}
