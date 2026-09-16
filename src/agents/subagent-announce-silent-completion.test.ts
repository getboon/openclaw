// Integration cover for the silent-completion delivery path: the real announce
// flow drives the real delivery module, and only the gateway call and the
// channel send are stubbed. A parent that answers the silent token over a
// finished child must still put the child's text in front of the user; without
// that the completion is dropped while the turn reports success.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedAgentQueueMessageOutcome } from "./embedded-agent-runner/runs.js";
import { createSubagentAnnounceDeliveryRuntimeMock } from "./subagent-announce.test-support.js";

const CHILD_RESULT = "Proposed feeder manifest: 53 feeders, 12 flagged for review.";

type GatewayRequest = { method?: string; params?: Record<string, unknown> };

const gatewayCalls: GatewayRequest[] = [];
const callGatewayMock = vi.fn(async (request: unknown) => {
  const typed = (request ?? {}) as GatewayRequest;
  gatewayCalls.push(typed);
  // The announce delivery run: the parent is handed the child's result and
  // answers with the silent token instead of calling the message tool.
  if (typed.method === "agent") {
    return { runId: "run-parent", status: "ok", payloads: [{ text: "NO_REPLY" }] };
  }
  return {};
});

const sendMessageMock = vi.fn(async () => ({ ok: true }));
const loadSessionStoreMock = vi.fn((_storePath: string) => ({
  "agent:main:discord:dm:U123": {
    sessionId: "requester-session",
    channel: "discord",
    origin: { provider: "discord", to: "dm:U123", accountId: "acct-1" },
  },
}));

const mockConfig = {
  session: { mainKey: "main", scope: "per-sender" },
} as ReturnType<(typeof import("../config/config.js"))["getRuntimeConfig"]>;

const { subagentRegistryRuntimeMock } = vi.hoisted(() => ({
  subagentRegistryRuntimeMock: {
    shouldIgnorePostCompletionAnnounceForSession: vi.fn(() => false),
    isSubagentSessionRunActive: vi.fn(() => false),
    countActiveDescendantRuns: vi.fn(() => 0),
    countPendingDescendantRuns: vi.fn(() => 0),
    countPendingDescendantRunsExcludingRun: vi.fn(() => 0),
    listSubagentRunsForRequester: vi.fn(() => []),
    replaceSubagentRunAfterSteer: vi.fn(() => true),
    resolveRequesterForChildSession: vi.fn(() => null),
  },
}));

vi.mock("./subagent-announce.runtime.js", () => ({
  callGateway: (request: unknown) => callGatewayMock(request),
  dispatchGatewayMethodInProcess: (
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ) => callGatewayMock({ method, params, timeoutMs: options?.timeoutMs }),
  isEmbeddedAgentRunActive: () => false,
  getRuntimeConfig: () => mockConfig,
  loadSessionStore: (storePath: string) => loadSessionStoreMock(storePath),
  readSessionMessagesAsync: vi.fn(async () => []),
  readSessionEntry: (storePath: string, sessionKey: string) =>
    (loadSessionStoreMock(storePath) as Record<string, unknown>)[sessionKey],
  resolveAgentIdFromSessionKey: (sessionKey: string) =>
    sessionKey.match(/^agent:([^:]+)/)?.[1] ?? "main",
  resolveMainSessionKey: () => "agent:main:main",
  resolveStorePath: () => "/tmp/sessions.json",
  waitForEmbeddedAgentRunEnd: async () => true,
}));

vi.mock("./subagent-announce-delivery.runtime.js", () => ({
  // Explicit factory, no importOriginal: the delivery module imports four names the
  // shared factory does not cover, and a missing one fails at import time.
  isEmbeddedRunAbandoned: () => false,
  resolveActiveEmbeddedRunSessionId: () => undefined,
  queueEmbeddedAgentMessageWithOutcomeAsync: async (sessionId: string) => ({
    queued: false,
    sessionId,
    reason: "not_streaming" as const,
    gatewayHealth: "live" as const,
  }),
  sendMessage: (params: unknown) => sendMessageMock(params as never),
  ...createSubagentAnnounceDeliveryRuntimeMock({
    callGateway: (request: unknown) => callGatewayMock(request),
    getRuntimeConfig: () => mockConfig,
    loadSessionStore: (storePath: string) => loadSessionStoreMock(storePath),
    resolveAgentIdFromSessionKey: (sessionKey: string) =>
      sessionKey.match(/^agent:([^:]+)/)?.[1] ?? "main",
    resolveMainSessionKey: () => "agent:main:main",
    resolveStorePath: () => "/tmp/sessions.json",
    isEmbeddedAgentRunActive: () => false,
    queueEmbeddedAgentMessageWithOutcome: (
      sessionId: string,
    ): EmbeddedAgentQueueMessageOutcome => ({
      queued: false,
      sessionId,
      reason: "not_streaming" as const,
      gatewayHealth: "live" as const,
    }),
  }),
}));

vi.mock("./subagent-announce.registry.runtime.js", () => subagentRegistryRuntimeMock);

// Deliberately NOT mocked: ./subagent-announce-delivery.js. That module owns the
// decision under test, so the real one runs here.
import { testing as deliveryTesting } from "./subagent-announce-delivery.js";
import { runSubagentAnnounceFlow } from "./subagent-announce.js";

describe("subagent completion with a silent parent reply", () => {
  beforeEach(() => {
    gatewayCalls.length = 0;
    callGatewayMock.mockClear();
    sendMessageMock.mockClear();
    deliveryTesting.setDepsForTest({
      callGateway: (request: unknown) => callGatewayMock(request),
      sendMessage: sendMessageMock as never,
      getRequesterSessionActivity: () => ({ sessionId: "requester-session", isActive: false }),
      getRuntimeConfig: () => mockConfig,
    });
  });

  it("puts the child's result in front of the user", async () => {
    const didAnnounce = await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:feeder-extract",
      childRunId: "run-child",
      requesterSessionKey: "agent:main:discord:dm:U123",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "discord", to: "dm:U123", accountId: "acct-1" },
      task: "feeder extraction",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: CHILD_RESULT,
      expectsCompletionMessage: true,
    });

    expect(didAnnounce).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "discord",
        to: "dm:U123",
        content: expect.stringContaining("53 feeders"),
      }),
    );
  });
});
