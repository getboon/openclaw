// ENG-21265 — the consecutive-failure backstop wired into spawnSubagentDirect.
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

describe("sessions_spawn consecutive-failure backstop (ENG-21265)", () => {
  const callGatewayMock = vi.fn();
  const loadSessionStoreMock = vi.fn();
  const updateSessionStoreMock = vi.fn();
  const resolveContextEngineMock = vi.fn();
  let spawnSubagentDirect: Awaited<
    ReturnType<typeof loadSubagentSpawnModuleForTest>
  >["spawnSubagentDirect"];

  beforeAll(async () => {
    vi.doMock("../registry/subagent-registry-read.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../registry/subagent-registry-read.js")>()),
      listSubagentRunsForRequester: (key: string, opts?: unknown) =>
        listRunsForRequester(key, opts),
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
