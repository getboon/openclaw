import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const supervisorMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  cancel: vi.fn(),
  getRecord: vi.fn<(runId: string) => { state: string } | undefined>(() => undefined),
}));
const killProcessTreeMock = vi.hoisted(() => vi.fn());
const requestHeartbeatMock = vi.hoisted(() => vi.fn());
const enqueueSystemEventMock = vi.hoisted(() => vi.fn());

vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => supervisorMock,
}));

vi.mock("../process/kill-tree.js", () => ({
  killProcessTree: (...args: unknown[]) => killProcessTreeMock(...args),
}));

vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeat: requestHeartbeatMock,
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: enqueueSystemEventMock,
}));

let addSession: typeof import("./bash-process-registry.js").addSession;
let getFinishedSession: typeof import("./bash-process-registry.js").getFinishedSession;
let markBackgrounded: typeof import("./bash-process-registry.js").markBackgrounded;
let resetProcessRegistryForTests: typeof import("./bash-process-registry.js").resetProcessRegistryForTests;
let createProcessSessionFixture: typeof import("./bash-process-registry.test-helpers.js").createProcessSessionFixture;
let killExecProcessesForSessions: typeof import("./bash-process-abort.js").killExecProcessesForSessions;
let resolveProcessToolScopeKey: typeof import("./agent-tools.js").resolveProcessToolScopeKey;
let runExecProcess: typeof import("./bash-tools.exec-runtime.js").runExecProcess;

const parentSessionKey = "agent:main:789:thread-1:thread:1";
const childSessionKey = "agent:main:subagent:7f3c2a10-5b7e-4f0e-9d0a-2c1f4b8e6a11";
const unrelatedSessionKey = "agent:main:789:thread-2:thread:2";

beforeAll(async () => {
  ({ addSession, getFinishedSession, markBackgrounded, resetProcessRegistryForTests } =
    await import("./bash-process-registry.js"));
  ({ createProcessSessionFixture } = await import("./bash-process-registry.test-helpers.js"));
  ({ killExecProcessesForSessions } = await import("./bash-process-abort.js"));
  ({ resolveProcessToolScopeKey } = await import("./agent-tools.js"));
  ({ runExecProcess } = await import("./bash-tools.exec-runtime.js"));
});

beforeEach(() => {
  resetProcessRegistryForTests();
});

afterEach(() => {
  resetProcessRegistryForTests();
  supervisorMock.spawn.mockReset();
  supervisorMock.cancel.mockReset();
  supervisorMock.getRecord.mockReset().mockReturnValue(undefined);
  killProcessTreeMock.mockReset();
  requestHeartbeatMock.mockReset();
  enqueueSystemEventMock.mockReset();
});

function addExecSession(params: {
  id: string;
  sessionKey: string;
  backgrounded: boolean;
  pid?: number;
}) {
  const session = createProcessSessionFixture({
    id: params.id,
    command: "sleep 999",
    backgrounded: params.backgrounded,
    ...(params.pid === undefined ? {} : { pid: params.pid }),
  });
  session.sessionKey = params.sessionKey;
  session.scopeKey = resolveProcessToolScopeKey({ sessionKey: params.sessionKey });
  session.notifyOnExit = true;
  session.exitNotified = false;
  addSession(session);
  return session;
}

describe("killExecProcessesForSessions", () => {
  it("cancels foreground and background execs of the given sessions only", () => {
    const parentBackground = addExecSession({
      id: "parent-bg",
      sessionKey: parentSessionKey,
      backgrounded: true,
    });
    const parentForeground = addExecSession({
      id: "parent-fg",
      sessionKey: parentSessionKey,
      backgrounded: false,
    });
    const childBackground = addExecSession({
      id: "child-bg",
      sessionKey: childSessionKey,
      backgrounded: true,
    });
    const unrelated = addExecSession({
      id: "unrelated-bg",
      sessionKey: unrelatedSessionKey,
      backgrounded: true,
    });
    supervisorMock.getRecord.mockReturnValue({ state: "running" });

    const killed = killExecProcessesForSessions([parentSessionKey, childSessionKey]);

    expect(killed).toBe(3);
    expect(supervisorMock.cancel.mock.calls).toEqual([
      ["parent-bg", "manual-cancel"],
      ["parent-fg", "manual-cancel"],
      ["child-bg", "manual-cancel"],
    ]);
    expect(parentBackground.exitNotified).toBe(true);
    expect(parentForeground.exitNotified).toBe(true);
    expect(childBackground.exitNotified).toBe(true);
    expect(unrelated.exitNotified).toBe(false);
  });

  it("falls back to killing the process tree when no supervisor run is active", () => {
    const session = addExecSession({
      id: "parent-unmanaged",
      sessionKey: parentSessionKey,
      backgrounded: true,
      pid: 4242,
    });

    const killed = killExecProcessesForSessions([parentSessionKey]);

    expect(killed).toBe(1);
    expect(supervisorMock.cancel).not.toHaveBeenCalled();
    expect(killProcessTreeMock).toHaveBeenCalledWith(4242);
    expect(session.exitNotified).toBe(true);
    expect(getFinishedSession("parent-unmanaged")?.status).toBe("killed");
  });

  it("does not count or silence a supervisor run that is still starting", () => {
    const session = addExecSession({
      id: "parent-starting",
      sessionKey: parentSessionKey,
      backgrounded: true,
      pid: 4242,
    });
    supervisorMock.getRecord.mockReturnValue({ state: "starting" });

    expect(killExecProcessesForSessions([parentSessionKey])).toBe(0);
    expect(supervisorMock.cancel).not.toHaveBeenCalled();
    expect(killProcessTreeMock).not.toHaveBeenCalled();
    expect(session.exitNotified).toBe(false);
  });

  it("does not count or silence a session without a supervisor run or pid", () => {
    const session = addExecSession({
      id: "parent-no-pid",
      sessionKey: parentSessionKey,
      backgrounded: true,
    });

    expect(killExecProcessesForSessions([parentSessionKey])).toBe(0);
    expect(killProcessTreeMock).not.toHaveBeenCalled();
    expect(session.exitNotified).toBe(false);
  });

  it("returns zero without touching processes when no session keys are given", () => {
    addExecSession({ id: "parent-bg", sessionKey: parentSessionKey, backgrounded: true });
    supervisorMock.getRecord.mockReturnValue({ state: "running" });

    expect(killExecProcessesForSessions([])).toBe(0);
    expect(supervisorMock.cancel).not.toHaveBeenCalled();
  });

  it("does not wake the session for a killed background exec with output", async () => {
    let resolveWait: (() => void) | undefined;
    supervisorMock.spawn.mockImplementationOnce(
      async (input: { onStdout?: (chunk: string) => void }) => {
        input.onStdout?.("partial output\n");
        return {
          runId: "run-1",
          startedAtMs: Date.now(),
          pid: 123,
          wait: () =>
            new Promise((resolve) => {
              resolveWait = () =>
                resolve({
                  reason: "manual-cancel",
                  exitCode: null,
                  exitSignal: "SIGKILL",
                  durationMs: 10,
                  stdout: "",
                  stderr: "",
                  timedOut: false,
                  noOutputTimedOut: false,
                });
            }),
          cancel: vi.fn(),
        };
      },
    );
    supervisorMock.getRecord.mockReturnValue({ state: "running" });
    supervisorMock.cancel.mockImplementation(() => resolveWait?.());

    const run = await runExecProcess({
      command: "sleep 999",
      workdir: "/tmp",
      env: {},
      usePty: false,
      warnings: [],
      maxOutput: 1000,
      pendingMaxOutput: 1000,
      notifyOnExit: true,
      notifyOnExitEmptySuccess: false,
      sessionKey: parentSessionKey,
      scopeKey: resolveProcessToolScopeKey({ sessionKey: parentSessionKey }),
      timeoutSec: null,
    });
    markBackgrounded(run.session);

    expect(killExecProcessesForSessions([parentSessionKey])).toBe(1);
    const outcome = await run.promise;

    expect(outcome.status).toBe("failed");
    expect(enqueueSystemEventMock).not.toHaveBeenCalled();
    expect(requestHeartbeatMock).not.toHaveBeenCalled();
  });
});
