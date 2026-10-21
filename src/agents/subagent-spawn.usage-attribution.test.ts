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
  // Spawns from a channel/tool turn dispatch in-process; false exercises the socket fallback.
  inProcess: true,
  // Records which transport carried each request so wire-safety can be asserted.
  transports: [] as Array<{
    via: "in-process" | "socket";
    method?: string;
    params?: unknown;
    options?: unknown;
  }>,
  configOverride: {} as Record<string, unknown>,
  depthBySession: new Map<string, number>(),
  updateSessionStoreMock: vi.fn(),
  registerSubagentRunMock: vi.fn(),
}));

let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
let persistedStore: Record<string, Record<string, unknown>> | undefined;

const ALICE: UsageAttribution = { userId: "U-ALICE", userName: "Alice", userSource: "slack" };

const OBO = "eyJ.gateway-aud.parent-obo";

async function spawnFrom(
  sessionKey: string,
  requesterUsageAttribution?: UsageAttribution,
  requesterOboToken?: string,
) {
  const result = await spawnSubagentDirect(
    { task: "hello" },
    {
      agentSessionKey: sessionKey,
      workspaceDir: "/tmp/workspace-main",
      ...(requesterUsageAttribution ? { requesterUsageAttribution } : {}),
      ...(requesterOboToken ? { requesterOboToken } : {}),
    },
  );
  expect(result.status).toBe("accepted");
  const agentCall = hoisted.callGatewayMock.mock.calls.findLast(
    ([request]) => (request as { method?: string }).method === "agent",
  )?.[0] as { params?: Record<string, unknown> } | undefined;
  const childSessionKey = result.childSessionKey ?? "";
  return {
    agentParams: agentCall?.params,
    persistedJson: JSON.stringify(persistedStore ?? {}),
    childSessionKey,
    childEntry: persistedStore?.[childSessionKey],
  };
}

describe("subagent spawn usage attribution", () => {
  beforeAll(async () => {
    ({ spawnSubagentDirect } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: vi.fn(async (...args: unknown[]) => {
        const request = args[0] as { method?: string; params?: unknown };
        hoisted.transports.push({ via: "socket", ...request });
        return await hoisted.callGatewayMock(request);
      }),
      hasInProcessGatewayContextMock: vi.fn(() => hoisted.inProcess),
      dispatchGatewayMethodInProcessMock: vi.fn(async (...args: unknown[]) => {
        const [method, params, options] = args as [string, unknown, unknown];
        hoisted.transports.push({ via: "in-process", method, params, options });
        return await hoisted.callGatewayMock({ method, params });
      }),
      getRuntimeConfig: () => hoisted.configOverride,
      registerSubagentRunMock: hoisted.registerSubagentRunMock,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      getSubagentDepthFromSessionStore: (sessionKey) => hoisted.depthBySession.get(sessionKey) ?? 0,
      resetModules: false,
    }));
  });

  beforeEach(() => {
    hoisted.depthBySession.clear();
    hoisted.inProcess = true;
    hoisted.transports.length = 0;
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

  it("passes the parent's OBO token to the child's first run, in-process only", async () => {
    const parent = buildEmbeddedAttemptToolRunContext({ senderId: "U-ALICE", oboToken: OBO });
    expect(parent.requesterOboToken).toBe(OBO);

    const child = await spawnFrom(
      "agent:main:main",
      parent.requesterUsageAttribution,
      parent.requesterOboToken,
    );

    expect(child.agentParams?.oboToken).toBe(OBO);
    const agentTransport = hoisted.transports.find((entry) => entry.method === "agent");
    expect(agentTransport?.via).toBe("in-process");
    // Spawn-built params: the only path the agent method trusts these fields from.
    expect(agentTransport?.options).toMatchObject({ inProcessDispatch: true });
    // The bearer rides the agent call only: never on the child's session entry.
    expect(child.persistedJson).not.toContain(OBO);
    expect(child.childEntry).not.toHaveProperty("oboToken");
  });

  it("forwards the OBO token to a depth-2 grandchild whose requester received one", async () => {
    const parent = buildEmbeddedAttemptToolRunContext({ senderId: "U-ALICE", oboToken: OBO });
    const child = await spawnFrom(
      "agent:main:main",
      parent.requesterUsageAttribution,
      parent.requesterOboToken,
    );

    // The child run received oboToken via the agent call; it has no sender of its own.
    const childRun = buildEmbeddedAttemptToolRunContext({
      senderId: undefined,
      usageAttribution: child.childEntry?.usageAttribution as UsageAttribution | undefined,
      oboToken: child.agentParams?.oboToken as string | undefined,
    });
    hoisted.depthBySession.set(child.childSessionKey, 1);
    const grandchild = await spawnFrom(
      child.childSessionKey,
      childRun.requesterUsageAttribution,
      childRun.requesterOboToken,
    );

    expect(grandchild.agentParams?.oboToken).toBe(OBO);
    expect(grandchild.persistedJson).not.toContain(OBO);
  });

  it("keeps in-process-only fields off the socket fallback while still attributing the child", async () => {
    hoisted.inProcess = false;
    const parent = buildEmbeddedAttemptToolRunContext({ senderId: "U-ALICE", oboToken: OBO });

    const child = await spawnFrom(
      "agent:main:main",
      parent.requesterUsageAttribution,
      parent.requesterOboToken,
    );

    const agentTransport = hoisted.transports.find((entry) => entry.method === "agent");
    expect(agentTransport?.via).toBe("socket");
    // An older gateway's closed `agent` schema would reject usageAttribution outright.
    expect(child.agentParams).not.toHaveProperty("oboToken");
    expect(child.agentParams).not.toHaveProperty("usageAttribution");
    expect(JSON.stringify(hoisted.transports)).not.toContain(OBO);
    // The child entry patch still carries the originating user for its runs.
    expect(child.childEntry?.usageAttribution).toEqual({ userId: "U-ALICE" });
  });

  it("omits oboToken when the requester run has none", async () => {
    const blank = buildEmbeddedAttemptToolRunContext({ senderId: "U-ALICE", oboToken: "  " });
    expect(blank).not.toHaveProperty("requesterOboToken");
    const nullToken = buildEmbeddedAttemptToolRunContext({ senderId: "U-ALICE", oboToken: null });
    expect(nullToken).not.toHaveProperty("requesterOboToken");

    const child = await spawnFrom("agent:main:main", blank.requesterUsageAttribution);

    expect(child.agentParams).not.toHaveProperty("oboToken");
  });
});
