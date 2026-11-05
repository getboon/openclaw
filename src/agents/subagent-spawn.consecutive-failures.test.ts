// The consecutive-failure backstop wired into spawnSubagentDirect.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentSpawnTestConfig,
  installSessionStoreCaptureMock,
  loadSubagentSpawnModuleForTest,
  setupAcceptedSubagentGatewayMock,
} from "./subagent-spawn.test-helpers.js";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  configOverride: {} as Record<string, unknown>,
  runsByRequester: new Map<string, unknown[]>(),
  updateSessionStoreMock: vi.fn(),
}));

let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;

function config(maxConsecutiveFailures?: number) {
  return createSubagentSpawnTestConfig("/tmp/workspace-main", {
    agents: {
      defaults: {
        workspace: "/tmp/workspace-main",
        subagents: maxConsecutiveFailures === undefined ? {} : { maxConsecutiveFailures },
      },
    },
  });
}

function failedRun(requesterSessionKey: string, createdAt: number) {
  return { requesterSessionKey, createdAt, taskName: "pass3", outcome: { status: "timeout" } };
}

describe("sessions_spawn consecutive-failure backstop", () => {
  beforeAll(async () => {
    ({ spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      getRuntimeConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      listSubagentRunsForRequester: (key) => hoisted.runsByRequester.get(key) ?? [],
      resetModules: false,
    }));
  });

  beforeEach(() => {
    hoisted.runsByRequester.clear();
    hoisted.callGatewayMock.mockClear();
    hoisted.updateSessionStoreMock.mockReset();
    installSessionStoreCaptureMock(hoisted.updateSessionStoreMock);
    hoisted.configOverride = config(2);
    setupAcceptedSubagentGatewayMock(hoisted.callGatewayMock);
  });

  it("blocks an automatic re-spawn (completion wake) after consecutive failures", async () => {
    const key = "agent:main:cap-wake";
    hoisted.runsByRequester.set(key, [failedRun(key, 1), failedRun(key, 2)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      { agentSessionKey: key, requesterInputProvenanceKind: "inter_session" },
    );

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/spawn blocked/i);
    expect(hoisted.callGatewayMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "agent" }),
    );
  });

  it("does not block when the cap is unset", async () => {
    hoisted.configOverride = config(undefined);
    const key = "agent:main:cap-off";
    hoisted.runsByRequester.set(key, [failedRun(key, 1), failedRun(key, 2), failedRun(key, 3)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      { agentSessionKey: key, requesterInputProvenanceKind: "inter_session" },
    );

    expect(result.status).toBe("accepted");
  });

  // Ordinary channel / chat messages carry no provenance marker; completion wakes and handoffs
  // are marked inter_session / internal_system.
  it.each([undefined, "external_user"] as const)(
    "does not block a spawn triggered by a new user message (provenance %s)",
    async (kind) => {
      const key = `agent:main:cap-user-${kind ?? "unmarked"}`;
      hoisted.runsByRequester.set(key, [failedRun(key, 1), failedRun(key, 2)]);

      const result = await spawnSubagentDirect(
        { task: "new request" },
        { agentSessionKey: key, ...(kind ? { requesterInputProvenanceKind: kind } : {}) },
      );

      expect(result.status).toBe("accepted");
    },
  );

  it("does not reset the streak for an internal system re-dispatch", async () => {
    const key = "agent:main:cap-internal";
    hoisted.runsByRequester.set(key, [failedRun(key, 1), failedRun(key, 2)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      { agentSessionKey: key, requesterInputProvenanceKind: "internal_system" },
    );

    expect(result.status).toBe("error");
  });

  it("keeps counting failures across spawns within one user turn, and resets on the next", async () => {
    const key = "agent:main:cap-same-turn";
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000);
      const turnA = { agentSessionKey: key, requesterTurnRunId: "turn-a" };
      expect((await spawnSubagentDirect({ task: "pass 3" }, turnA)).status).toBe("accepted");

      hoisted.runsByRequester.set(key, [failedRun(key, 2_000), failedRun(key, 2_001)]);
      now.mockReturnValue(3_000);
      expect((await spawnSubagentDirect({ task: "pass 3 again" }, turnA)).status).toBe("error");

      now.mockReturnValue(4_000);
      const turnB = { agentSessionKey: key, requesterTurnRunId: "turn-b" };
      expect((await spawnSubagentDirect({ task: "new request" }, turnB)).status).toBe("accepted");
    } finally {
      now.mockRestore();
    }
  });

  it("reads the runs registered for the completion owner, not the raw caller key", async () => {
    // A parent proxying the spawn registers child runs under the completion owner's key.
    const owner = "agent:main:owner";
    hoisted.runsByRequester.set(owner, [failedRun(owner, 1), failedRun(owner, 2)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      {
        agentSessionKey: "agent:main:proxy",
        completionOwnerKey: owner,
        requesterInputProvenanceKind: "inter_session",
      },
    );

    expect(result.status).toBe("error");
  });
});
