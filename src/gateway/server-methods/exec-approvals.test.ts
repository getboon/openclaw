// Exec approval RPC tests cover stale-editor protection at the locked write boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../../infra/exec-approvals.js";
import type { GatewayRequestHandlers } from "./types.js";

const mocks = vi.hoisted(() => ({
  ensureExecApprovals: vi.fn(),
  readExecApprovalsSnapshot: vi.fn(),
  withExecApprovalsLock: vi.fn(),
}));

vi.mock("../../infra/exec-approvals.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/exec-approvals.js")>(
    "../../infra/exec-approvals.js",
  );
  return {
    ...actual,
    ensureExecApprovals: mocks.ensureExecApprovals,
    readExecApprovalsSnapshot: mocks.readExecApprovalsSnapshot,
    withExecApprovalsLock: mocks.withExecApprovalsLock,
  };
});

function makeSnapshot(hash: string): ExecApprovalsSnapshot {
  const file: ExecApprovalsFile = {
    version: 1,
    socket: { path: "/tmp/exec-approvals.sock", token: "socket-token" },
    agents: {},
  };
  return {
    path: "/tmp/exec-approvals.json",
    exists: true,
    raw: JSON.stringify(file),
    hash,
    file,
  };
}

describe("exec approvals gateway methods", () => {
  let execApprovalsHandlers: GatewayRequestHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ execApprovalsHandlers } = await import("./exec-approvals.js"));
  });

  it("checks the base hash against the fresh snapshot held by the mutation lock", async () => {
    const currentSnapshot = makeSnapshot("current-hash");
    mocks.withExecApprovalsLock.mockImplementation(async (mutate) => {
      const mutation = await mutate(currentSnapshot);
      return mutation.result;
    });
    const respond = vi.fn();

    await execApprovalsHandlers["exec.approvals.set"]?.({
      params: {
        baseHash: "stale-hash",
        file: { version: 1, agents: { video_capture: {} } },
      },
      respond,
      context: {} as never,
      client: null,
      req: { type: "req", id: "req-1", method: "exec.approvals.set" },
      isWebchatConnect: () => false,
    });

    expect(mocks.withExecApprovalsLock).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "exec approvals changed since last load; re-run exec.approvals.get and retry",
      }),
    );
  });

  it("uses the async mutation lock without synchronously initializing approvals first", async () => {
    const currentSnapshot = makeSnapshot("current-hash");
    mocks.withExecApprovalsLock.mockImplementation(async (mutate) => {
      const mutation = await mutate(currentSnapshot);
      return mutation.result;
    });
    mocks.readExecApprovalsSnapshot.mockReturnValue(currentSnapshot);
    const respond = vi.fn();

    await execApprovalsHandlers["exec.approvals.set"]?.({
      params: {
        baseHash: "current-hash",
        file: { version: 1, agents: { video_capture: {} } },
      },
      respond,
      context: {} as never,
      client: null,
      req: { type: "req", id: "req-2", method: "exec.approvals.set" },
      isWebchatConnect: () => false,
    });

    expect(mocks.ensureExecApprovals).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        hash: "current-hash",
      }),
      undefined,
    );
  });

  it("returns a retryable unavailable error when the mutation lock times out", async () => {
    mocks.withExecApprovalsLock.mockRejectedValue(
      Object.assign(new Error("lock timed out"), { code: "exec_approvals_lock_contended" }),
    );
    const respond = vi.fn();

    await expect(
      execApprovalsHandlers["exec.approvals.set"]?.({
        params: {
          baseHash: "current-hash",
          file: { version: 1, agents: { video_capture: {} } },
        },
        respond,
        context: {} as never,
        client: null,
        req: { type: "req", id: "req-3", method: "exec.approvals.set" },
        isWebchatConnect: () => false,
      }),
    ).resolves.toBeUndefined();

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: "exec approvals update is already in progress; retry this operation.",
        retryable: true,
      }),
    );
  });

  it("preserves a node approval lock timeout as retryable", async () => {
    const respond = vi.fn();
    const nodeRegistry = {
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: "exec approvals update is already in progress; retry this operation.",
        },
      }),
    };

    await execApprovalsHandlers["exec.approvals.node.set"]?.({
      params: {
        nodeId: "node-1",
        baseHash: "current-hash",
        file: { version: 1, agents: { video_capture: {} } },
      },
      respond,
      context: { nodeRegistry } as never,
      client: null,
      req: { type: "req", id: "req-4", method: "exec.approvals.node.set" },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        retryable: true,
      }),
    );
  });
});
