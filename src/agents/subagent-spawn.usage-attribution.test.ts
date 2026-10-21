// Subagent spawn usage-attribution tests: children (and grandchildren) inherit the
// originating user for billing headers via the agent call and their session entry.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmbeddedAttemptToolRunContext } from "./embedded-agent-runner/run/attempt.tool-run-context.js";
import {
  createSubagentSpawnTestConfig,
  installSessionStoreCaptureMock,
  loadSubagentSpawnModuleForTest,
  setupAcceptedSubagentGatewayMock,
} from "./subagent-spawn.test-helpers.js";
import type { UsageAttribution } from "./usage-attribution.js";

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  configOverride: {} as Record<string, unknown>,
  depthBySession: new Map<string, number>(),
  updateSessionStoreMock: vi.fn(),
  registerSubagentRunMock: vi.fn(),
}));

let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
let persistedStore: Record<string, Record<string, unknown>> | undefined;

const ALICE: UsageAttribution = { userId: "U-ALICE", userName: "Alice", userSource: "slack" };

async function spawnFrom(sessionKey: string, requesterUsageAttribution?: UsageAttribution) {
  const result = await spawnSubagentDirect(
    { task: "hello" },
    {
      agentSessionKey: sessionKey,
      workspaceDir: "/tmp/workspace-main",
      ...(requesterUsageAttribution ? { requesterUsageAttribution } : {}),
    },
  );
  expect(result.status).toBe("accepted");
  const agentCall = hoisted.callGatewayMock.mock.calls.findLast(
    ([request]) => (request as { method?: string }).method === "agent",
  )?.[0] as { params?: Record<string, unknown> } | undefined;
  const childSessionKey = result.childSessionKey ?? "";
  return {
    agentParams: agentCall?.params,
    childSessionKey,
    childEntry: persistedStore?.[childSessionKey],
  };
}

describe("subagent spawn usage attribution", () => {
  beforeAll(async () => {
    ({ spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      getRuntimeConfig: () => hoisted.configOverride,
      registerSubagentRunMock: hoisted.registerSubagentRunMock,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      getSubagentDepthFromSessionStore: (sessionKey) => hoisted.depthBySession.get(sessionKey) ?? 0,
      resetModules: false,
    }));
  });

  beforeEach(() => {
    hoisted.depthBySession.clear();
    hoisted.callGatewayMock.mockClear();
    hoisted.registerSubagentRunMock.mockClear();
    hoisted.updateSessionStoreMock.mockReset();
    persistedStore = undefined;
    installSessionStoreCaptureMock(hoisted.updateSessionStoreMock, {
      onStore: (store) => {
        persistedStore = store;
      },
    });
    hoisted.configOverride = createSubagentSpawnTestConfig("/tmp/workspace-main", {
      agents: {
        defaults: { workspace: "/tmp/workspace-main", subagents: { maxSpawnDepth: 2 } },
      },
    });
    setupAcceptedSubagentGatewayMock(hoisted.callGatewayMock);
  });

  it("passes the parent sender to the child as usageAttribution, not as sender identity", async () => {
    // A user turn: the parent run's own inbound sender becomes the child's billing user.
    const parent = buildEmbeddedAttemptToolRunContext({
      senderId: "U-ALICE",
      senderName: "Alice",
      senderSource: "slack",
    });

    const child = await spawnFrom("agent:main:main", parent.requesterUsageAttribution);

    expect(child.agentParams?.usageAttribution).toEqual(ALICE);
    expect(child.agentParams).not.toHaveProperty("senderId");
    expect(child.agentParams).not.toHaveProperty("senderName");
    // Persisted next to spawnedBy so later turns of the child session stay attributed.
    expect(child.childEntry?.spawnedBy).toBe("agent:main:main");
    expect(child.childEntry?.usageAttribution).toEqual(ALICE);
  });

  it("carries the originating user to a depth-2 grandchild through the child's inheritance", async () => {
    const parent = buildEmbeddedAttemptToolRunContext({
      senderId: "U-ALICE",
      senderName: "Alice",
      senderSource: "slack",
    });
    const child = await spawnFrom("agent:main:main", parent.requesterUsageAttribution);

    // The child run has no sender of its own; it runs with the inherited attribution
    // (from the agent call or its persisted session entry).
    const childRun = buildEmbeddedAttemptToolRunContext({
      senderId: undefined,
      usageAttribution: child.childEntry?.usageAttribution as UsageAttribution | undefined,
    });
    hoisted.depthBySession.set(child.childSessionKey, 1);
    const grandchild = await spawnFrom(child.childSessionKey, childRun.requesterUsageAttribution);

    expect(grandchild.agentParams?.usageAttribution).toEqual(ALICE);
    expect(grandchild.childEntry?.spawnDepth).toBe(2);
    expect(grandchild.childEntry?.usageAttribution).toEqual(ALICE);
  });

  it("prefers a run's own sender over the attribution it inherited", () => {
    const run = buildEmbeddedAttemptToolRunContext({
      senderId: "U-BOB",
      usageAttribution: ALICE,
    });
    expect(run.requesterUsageAttribution).toEqual({ userId: "U-BOB" });
  });

  it("omits usageAttribution when the requester has no user", async () => {
    const parent = buildEmbeddedAttemptToolRunContext({ senderId: "  " });
    expect(parent.requesterUsageAttribution).toBeUndefined();

    const child = await spawnFrom("agent:main:main", parent.requesterUsageAttribution);

    expect(child.agentParams).not.toHaveProperty("usageAttribution");
    expect(child.childEntry).not.toHaveProperty("usageAttribution");
  });
});
