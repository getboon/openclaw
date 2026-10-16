// The consecutive-failure backstop wired into spawnSubagentDirect.
import os from "node:os";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentSpawnTestConfig,
  installSessionStoreCaptureMock,
  loadSubagentSpawnModuleForTest,
  setupAcceptedSubagentGatewayMock,
} from "./subagent-spawn.test-helpers.js";

const listRunsForRequester = vi.fn((_key: string, _opts?: unknown): unknown[] => []);

function failedRun(requesterSessionKey: string, createdAt: number) {
  return {
    runId: `run-${createdAt}`,
    childSessionKey: `agent:main:subagent:child-${createdAt}`,
    requesterSessionKey,
    createdAt,
    taskName: "pass3",
    execution: { outcome: { status: "timeout" } },
  };
}

describe("sessions_spawn consecutive-failure backstop", () => {
  const callGatewayMock = vi.fn();
  const loadSessionStoreMock = vi.fn();
  const updateSessionStoreMock = vi.fn();
  const resolveContextEngineMock = vi.fn();
  let spawnSubagentDirect: Awaited<
    ReturnType<typeof loadSubagentSpawnModuleForTest>
  >["spawnSubagentDirect"];

  beforeAll(async () => {
    // Only the registry reads the spawn graph uses: listSubagentRunsForRequester (the backstop)
    // and getSubagentRunByChildSessionKey (ACP spawn admission).
    vi.doMock("../registry/subagent-registry-read.js", () => ({
      listSubagentRunsForRequester: (key: string, opts?: unknown) =>
        listRunsForRequester(key, opts),
      getSubagentRunByChildSessionKey: () => null,
    }));
    ({ spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock,
      loadSessionStoreMock,
      updateSessionStoreMock,
      resolveContextEngineMock,
      getRuntimeConfig: () =>
        createSubagentSpawnTestConfig(os.tmpdir(), {
          agents: {
            defaults: {
              workspace: os.tmpdir(),
              subagents: { maxConsecutiveFailures: 2, maxChildrenPerAgent: 1 },
            },
          },
        }),
    }));
  });

  beforeEach(() => {
    listRunsForRequester.mockReset();
    listRunsForRequester.mockReturnValue([]);
    callGatewayMock.mockReset();
    setupAcceptedSubagentGatewayMock(callGatewayMock);
    loadSessionStoreMock.mockReset();
    loadSessionStoreMock.mockReturnValue({});
    installSessionStoreCaptureMock(updateSessionStoreMock);
    resolveContextEngineMock.mockReset();
    resolveContextEngineMock.mockResolvedValue({});
  });

  it("blocks after consecutive failures and releases the admission slot", async () => {
    const key = "agent:main:cap-leak";
    listRunsForRequester.mockReturnValue([failedRun(key, 1), failedRun(key, 2)]);

    // Automatic re-spawn after a child failed: the completion wake is marked inter_session.
    const wake = { agentSessionKey: key, requesterInputProvenanceKind: "inter_session" } as const;
    const blocked = await spawnSubagentDirect({ task: "pass 3" }, wake);
    expect(blocked.status).toBe("error");
    expect(blocked.error).toMatch(/spawn blocked/i);

    // maxChildrenPerAgent = 1: a leaked reservation from the blocked call would make this
    // next spawn "forbidden". With the slot released it is accepted.
    listRunsForRequester.mockReturnValue([]);
    const next = await spawnSubagentDirect({ task: "pass 3" }, wake);
    expect(next.status).toBe("accepted");
  });

  // Ordinary channel / chat messages carry no provenance marker; only internal re-dispatches
  // (completion wakes, tool handoffs) are marked inter_session / internal_system.
  it.each([undefined, "external_user"] as const)(
    "does not block a spawn triggered by a new user message (provenance %s)",
    async (kind) => {
      const key = `agent:main:cap-user-${kind ?? "unmarked"}`;
      listRunsForRequester.mockReturnValue([failedRun(key, 1), failedRun(key, 2)]);

      const result = await spawnSubagentDirect(
        { task: "new request" },
        { agentSessionKey: key, ...(kind ? { requesterInputProvenanceKind: kind } : {}) },
      );
      expect(result.status).toBe("accepted");
    },
  );

  it("keeps counting failures across spawns within one user turn, and resets on the next", async () => {
    const key = "agent:main:cap-same-turn";
    const now = vi.spyOn(Date, "now");
    try {
      // Turn A starts its streak at t=1000.
      now.mockReturnValue(1_000);
      const turnA = { agentSessionKey: key, requesterTurnRunId: "turn-a" };
      expect((await spawnSubagentDirect({ task: "pass 3" }, turnA)).status).toBe("accepted");

      // Two children fail at t=2000/2001; a later spawn in the same turn is blocked.
      listRunsForRequester.mockReturnValue([failedRun(key, 2_000), failedRun(key, 2_001)]);
      now.mockReturnValue(3_000);
      expect((await spawnSubagentDirect({ task: "pass 3 again" }, turnA)).status).toBe("error");

      // A new user turn at t=4000 starts a fresh streak; the earlier failures no longer count.
      now.mockReturnValue(4_000);
      const turnB = { agentSessionKey: key, requesterTurnRunId: "turn-b" };
      expect((await spawnSubagentDirect({ task: "new request" }, turnB)).status).toBe("accepted");
    } finally {
      now.mockRestore();
    }
  });

  it("does not reset the streak for an internal system re-dispatch", async () => {
    const key = "agent:main:cap-internal";
    listRunsForRequester.mockReturnValue([failedRun(key, 1), failedRun(key, 2)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      { agentSessionKey: key, requesterInputProvenanceKind: "internal_system" },
    );
    expect(result.status).toBe("error");
  });

  it("still blocks automatic re-spawns (completion wakes) after the user's request", async () => {
    const key = "agent:main:cap-wake";
    await spawnSubagentDirect(
      { task: "pass 3" },
      { agentSessionKey: key, requesterInputProvenanceKind: "external_user" },
    );
    const later = Date.now() + 1_000;
    listRunsForRequester.mockReturnValue([failedRun(key, later), failedRun(key, later + 1)]);

    const result = await spawnSubagentDirect(
      { task: "pass 3 retry" },
      { agentSessionKey: key, requesterInputProvenanceKind: "inter_session" },
    );
    expect(result.status).toBe("error");
  });
});
