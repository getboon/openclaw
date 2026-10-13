// Kill tree tests cover process tree termination and platform-specific fallbacks.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";

const { spawnMock, procTable } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  procTable: { stats: new Map<number, string>(), readdirError: false },
}));

vi.mock("node:fs", async () => {
  const { mockNodeBuiltinModule } = await import("openclaw/plugin-sdk/test-node-mocks");
  return mockNodeBuiltinModule(
    () => vi.importActual<typeof import("node:fs")>("node:fs"),
    {
      readdirSync: ((dir: string) => {
        if (dir !== "/proc") {
          throw new Error(`unexpected readdir ${dir}`);
        }
        if (procTable.readdirError) {
          throw new Error("EACCES");
        }
        return [...procTable.stats.keys()].map(String).concat("self", "uptime");
      }) as unknown as typeof import("node:fs").readdirSync,
      readFileSync: ((file: string) => {
        const match = /^\/proc\/(\d+)\/stat$/.exec(file);
        const stat = match ? procTable.stats.get(Number(match[1])) : undefined;
        if (stat === undefined) {
          throw new Error(`ENOENT ${file}`);
        }
        return stat;
      }) as unknown as typeof import("node:fs").readFileSync,
    },
    { mirrorToDefault: true },
  );
});

// Fixture pids must not collide with the test process, which the kill path never signals.
const PID_BASE = [7000, 17000, 27000].find((base) =>
  [process.pid, process.ppid].every((pid) => pid < base || pid >= base + 1000),
) as number;

function setProcParents(entries: Array<[pid: number, ppid: number, comm?: string]>) {
  procTable.stats.clear();
  for (const [pid, ppid, comm] of entries) {
    procTable.stats.set(pid, `${pid} (${comm ?? "sh"}) S ${ppid} ${pid} ${pid} 0 -1 4194304`);
  }
}

vi.mock("node:child_process", async () => {
  const { mockNodeBuiltinModule } = await import("openclaw/plugin-sdk/test-node-mocks");
  return mockNodeBuiltinModule(
    () => vi.importActual<typeof import("node:child_process")>("node:child_process"),
    {
      spawn: (...args: unknown[]) => spawnMock(...args),
    },
  );
});

let killProcessTree: typeof import("./kill-tree.js").killProcessTree;
let signalProcessTree: typeof import("./kill-tree.js").signalProcessTree;

function expectTaskkillCall(index: number, args: string[]) {
  expect(spawnMock.mock.calls[index]).toStrictEqual([
    "taskkill",
    args,
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  ]);
}

describe("killProcessTree", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    ({ killProcessTree, signalProcessTree } = await import("./kill-tree.js"));
  });

  beforeEach(() => {
    procTable.stats.clear();
    procTable.readdirError = false;
    spawnMock.mockClear();
    killSpy = vi.spyOn(process, "kill");
    vi.useFakeTimers();
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("on Windows skips delayed force-kill when PID is already gone", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 4242 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("win32", async () => {
      killProcessTree(4242, { graceMs: 25 });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expectTaskkillCall(0, ["/T", "/PID", "4242"]);

      await vi.advanceTimersByTimeAsync(25);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
  });

  it("on Windows force-kills after grace period only when PID still exists", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 5252 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("win32", async () => {
      killProcessTree(5252, { graceMs: 10 });

      await vi.advanceTimersByTimeAsync(10);

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expectTaskkillCall(0, ["/T", "/PID", "5252"]);
      expectTaskkillCall(1, ["/F", "/T", "/PID", "5252"]);
    });
  });

  it("on Unix sends SIGTERM first and skips SIGKILL when process exits", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -3333 && signal === 0) {
        throw new Error("ESRCH");
      }
      if (pid === 3333 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("linux", async () => {
      killProcessTree(3333, { graceMs: 10 });

      await vi.advanceTimersByTimeAsync(10);

      expect(killSpy).toHaveBeenCalledWith(-3333, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-3333, "SIGKILL");
      expect(killSpy).not.toHaveBeenCalledWith(3333, "SIGKILL");
    });
  });

  it("on Unix sends SIGKILL after grace period when process is still alive", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -4444 && signal === 0) {
        return true;
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("linux", async () => {
      killProcessTree(4444, { graceMs: 5 });

      await vi.advanceTimersByTimeAsync(5);

      expect(killSpy).toHaveBeenCalledWith(-4444, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(-4444, "SIGKILL");
    });
  });

  it("on Unix force-kills synchronously without SIGTERM or delayed escalation", async () => {
    killSpy.mockImplementation(() => true);

    await withMockedPlatform("linux", async () => {
      killProcessTree(4949, { force: true });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(-4949, "SIGKILL");
      expect(killSpy).not.toHaveBeenCalledWith(-4949, "SIGTERM");
    });
  });

  it("on Unix force-kills a live detached group even after the parent pid exits", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -4545 && signal === 0) {
        return true;
      }
      if (pid === 4545 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("linux", async () => {
      killProcessTree(4545, { graceMs: 5 });

      await vi.advanceTimersByTimeAsync(5);

      expect(killSpy).toHaveBeenCalledWith(-4545, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(-4545, "SIGKILL");
      expect(killSpy).not.toHaveBeenCalledWith(4545, "SIGKILL");
    });
  });

  it("on Unix skips group kill when detached:false to avoid SIGTERMing the parent's own process group (#71662)", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 5555 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("linux", async () => {
      killProcessTree(5555, { graceMs: 10, detached: false });
      await vi.advanceTimersByTimeAsync(10);

      // Direct pid kill is fine. Group kill (`-pid`) is FORBIDDEN here because
      // when the child wasn't spawned detached, its process group is the
      // gateway's group — `-pid` would SIGTERM the gateway itself.
      expect(killSpy).toHaveBeenCalledWith(5555, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-5555, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-5555, "SIGKILL");
    });
  });

  it("on Unix uses group kill by default (detached:true preserved as the existing behavior)", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -6666 && signal === 0) {
        throw new Error("ESRCH");
      }
      if (pid === 6666 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withMockedPlatform("linux", async () => {
      killProcessTree(6666, { graceMs: 10 });
      await vi.advanceTimersByTimeAsync(10);

      expect(killSpy).toHaveBeenCalledWith(-6666, "SIGTERM");
    });
  });

  it("on Unix sends a single requested tree signal without scheduling escalation", async () => {
    killSpy.mockImplementation(() => true);

    await withMockedPlatform("linux", async () => {
      signalProcessTree(7777, "SIGTERM");

      await vi.advanceTimersByTimeAsync(60_000);

      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(-7777, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-7777, "SIGKILL");
    });
  });

  it("on Linux non-detached SIGTERM signals descendants before the shell pid", async () => {
    killSpy.mockImplementation(() => true);
    setProcParents([
      [PID_BASE + 100, 1],
      [PID_BASE + 101, PID_BASE + 100, "sleep"],
      [PID_BASE + 102, PID_BASE + 101, "odd ) name (x"],
      [PID_BASE + 200, 1],
    ]);

    await withMockedPlatform("linux", async () => {
      signalProcessTree(PID_BASE + 100, "SIGTERM", { detached: false });
    });

    expect(killSpy.mock.calls).toEqual([
      [PID_BASE + 101, "SIGTERM"],
      [PID_BASE + 102, "SIGTERM"],
      [PID_BASE + 100, "SIGTERM"],
    ]);
  });

  it("on Linux non-detached kill never signals the gateway, its parent, or init", async () => {
    killSpy.mockImplementation(() => true);
    setProcParents([
      [PID_BASE + 300, 1],
      [process.pid, PID_BASE + 300, "node"],
      [process.ppid, PID_BASE + 300, "systemd"],
      [1, PID_BASE + 300, "init"],
      [PID_BASE + 301, PID_BASE + 300, "sleep"],
    ]);

    await withMockedPlatform("linux", async () => {
      signalProcessTree(PID_BASE + 300, "SIGTERM", { detached: false });
    });

    const signaledPids = killSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(signaledPids).toEqual([PID_BASE + 301, PID_BASE + 300]);
  });

  it("on Linux non-detached kill falls back to the shell pid when /proc is unreadable", async () => {
    killSpy.mockImplementation(() => true);
    procTable.readdirError = true;

    await withMockedPlatform("linux", async () => {
      signalProcessTree(PID_BASE + 400, "SIGTERM", { detached: false });
    });

    expect(killSpy.mock.calls).toEqual([[PID_BASE + 400, "SIGTERM"]]);
  });

  it("on Linux group kill still signals only the process group", async () => {
    killSpy.mockImplementation(() => true);
    setProcParents([
      [PID_BASE + 500, 1],
      [PID_BASE + 501, PID_BASE + 500, "sleep"],
    ]);

    await withMockedPlatform("linux", async () => {
      signalProcessTree(PID_BASE + 500, "SIGTERM");
    });

    expect(killSpy.mock.calls).toEqual([[-(PID_BASE + 500), "SIGTERM"]]);
  });

  it("on Windows maps requested tree signals to taskkill force mode", async () => {
    await withMockedPlatform("win32", async () => {
      signalProcessTree(8888, "SIGTERM");
      signalProcessTree(8888, "SIGKILL");

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expectTaskkillCall(0, ["/T", "/PID", "8888"]);
      expectTaskkillCall(1, ["/F", "/T", "/PID", "8888"]);
    });
  });

  it("on Windows force-kills synchronously without delayed taskkill", async () => {
    await withMockedPlatform("win32", async () => {
      killProcessTree(9999, { force: true });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expectTaskkillCall(0, ["/F", "/T", "/PID", "9999"]);
    });
  });
});
