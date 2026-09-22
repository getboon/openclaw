// End-to-end coverage proving the delegated tool-evidence chain
// (registry write -> announce completion event -> run.ts merge -> final audit
// trace) actually connects across every layer, not just in isolation.
//
// The repo's only existing spawn+yield integration harness
// (subagent-announce.live.test.ts) drives a real gateway against a live LLM
// provider and is gated behind OPENCLAW_LIVE_SUBAGENT_E2E + a real API key --
// unsuitable for a deterministic test that must run in every PR. Instead this
// file composes the REAL production functions from every task in the chain
// (runSubagentAnnounceFlow, collectDelegatedToolInvocationsFromInternalEvents,
// buildTraceToolSummary, buildAgentDecisionTrace), mocking only the same
// external boundaries subagent-announce.test.ts already mocks (gateway calls,
// session store, registry runtime lookup) -- reusing that exact harness shape
// rather than inventing a new one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDecisionTrace } from "../auto-reply/reply-payload.js";
import { buildAgentDecisionTrace } from "../auto-reply/reply/agent-decision-trace.js";
import {
  buildTraceToolSummary,
  collectDelegatedToolInvocationsFromInternalEvents,
  mergeDelegatedToolEvidenceIntoSummary,
} from "./embedded-agent-runner/run.js";
import type { EmbeddedAgentQueueMessageOutcome } from "./embedded-agent-runner/runs.js";
import { createSubagentAnnounceDeliveryRuntimeMock } from "./subagent-announce.test-support.js";

type AgentCallRequest = { method?: string; params?: Record<string, unknown> };
type AgentCallResponse = { runId?: string; status: string; error?: string };
type RegistryRow = {
  runId?: string;
  childSessionKey: string;
  task?: string;
  createdAt?: number;
  endedAt?: number;
  outcome?: { status: "ok" | "error" | "timeout" | "unknown" };
  completion?: {
    required?: boolean;
    resultText?: string | null;
    resultAuditTrace?: AgentDecisionTrace;
  };
};

const agentSpy = vi.fn(
  async (_req: AgentCallRequest): Promise<AgentCallResponse> => ({
    runId: "run-main",
    status: "ok",
  }),
);
const callGatewayMock = vi.fn(async (_request: unknown) => ({}));
const loadSessionStoreMock = vi.fn((_storePath: string) => ({}));
const resolveAgentIdFromSessionKeyMock = vi.fn(
  (sessionKey: string) => sessionKey.match(/^agent:([^:]+)/)?.[1] ?? "main",
);
const resolveStorePathMock = vi.fn((_store: unknown, _options: unknown) => "/tmp/sessions.json");
const resolveMainSessionKeyMock = vi.fn((_cfg: unknown) => "agent:main:main");
const isEmbeddedAgentRunActiveMock = vi.fn((_sessionId: string) => false);
const queueEmbeddedAgentMessageWithOutcomeMock = vi.fn(
  (sessionId: string, _text: string, _options?: unknown): EmbeddedAgentQueueMessageOutcome => ({
    queued: false,
    sessionId,
    reason: "not_streaming" as const,
    gatewayHealth: "live" as const,
  }),
);
const waitForEmbeddedAgentRunEndMock = vi.fn(
  async (_sessionId: string, _timeoutMs?: number) => true,
);
const deliverSubagentAnnouncementArgsMock = vi.hoisted(() => vi.fn());
let mockConfig: Record<string, unknown> = { session: { mainKey: "main", scope: "per-sender" } };

const registryRows = vi.hoisted(() => ({ map: new Map<string, RegistryRow>() }));

const { subagentRegistryRuntimeMock } = vi.hoisted(() => ({
  subagentRegistryRuntimeMock: {
    shouldIgnorePostCompletionAnnounceForSession: vi.fn(() => false),
    isSubagentSessionRunActive: vi.fn(() => true),
    countActiveDescendantRuns: vi.fn(() => 0),
    countPendingDescendantRuns: vi.fn(() => 0),
    countPendingDescendantRunsExcludingRun: vi.fn(() => 0),
    listSubagentRunsForRequester: vi.fn(() => [] as RegistryRow[]),
    replaceSubagentRunAfterSteer: vi.fn(() => true),
    resolveRequesterForChildSession: vi.fn(() => null),
    getLatestSubagentRunByChildSessionKey: vi.fn(
      (childSessionKey: string): RegistryRow | undefined => registryRows.map.get(childSessionKey),
    ),
  },
}));

vi.mock("./subagent-announce.runtime.js", () => ({
  callGateway: (request: unknown) => callGatewayMock(request),
  dispatchGatewayMethodInProcess: (
    method: string,
    params: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ) => callGatewayMock({ method, params, timeoutMs: options?.timeoutMs }),
  isEmbeddedAgentRunActive: (sessionId: string) => isEmbeddedAgentRunActiveMock(sessionId),
  getRuntimeConfig: () => mockConfig,
  loadSessionStore: (storePath: string) => loadSessionStoreMock(storePath),
  readSessionMessagesAsync: vi.fn(async () => []),
  readSessionEntry: (storePath: string, sessionKey: string) =>
    (loadSessionStoreMock(storePath) as Record<string, unknown>)[sessionKey],
  resolveAgentIdFromSessionKey: (sessionKey: string) =>
    resolveAgentIdFromSessionKeyMock(sessionKey),
  resolveMainSessionKey: (cfg: unknown) => resolveMainSessionKeyMock(cfg),
  resolveStorePath: (store: unknown, options: unknown) => resolveStorePathMock(store, options),
  waitForEmbeddedAgentRunEnd: (sessionId: string, timeoutMs?: number) =>
    waitForEmbeddedAgentRunEndMock(sessionId, timeoutMs),
}));

vi.mock("./subagent-announce-delivery.runtime.js", () =>
  createSubagentAnnounceDeliveryRuntimeMock({
    callGateway: (request: unknown) => callGatewayMock(request),
    getRuntimeConfig: () => mockConfig,
    loadSessionStore: (storePath: string) => loadSessionStoreMock(storePath),
    resolveAgentIdFromSessionKey: (sessionKey: string) =>
      resolveAgentIdFromSessionKeyMock(sessionKey),
    resolveMainSessionKey: (cfg: unknown) => resolveMainSessionKeyMock(cfg),
    resolveStorePath: (store: unknown, options: unknown) => resolveStorePathMock(store, options),
    isEmbeddedAgentRunActive: (sessionId: string) => isEmbeddedAgentRunActiveMock(sessionId),
    queueEmbeddedAgentMessageWithOutcome: (sessionId: string, text: string, options?: unknown) =>
      queueEmbeddedAgentMessageWithOutcomeMock(sessionId, text, options),
  }),
);

vi.mock("./subagent-announce-delivery.js", () => ({
  deliverSubagentAnnouncement: async (params: {
    targetRequesterSessionKey: string;
    triggerMessage: string;
    requesterIsSubagent?: boolean;
    requesterOrigin?: { channel?: string; to?: string; accountId?: string; threadId?: string };
    completionDirectOrigin?: {
      channel?: string;
      to?: string;
      accountId?: string;
      threadId?: string;
    };
    directOrigin?: { channel?: string; to?: string; accountId?: string; threadId?: string };
    requesterSessionOrigin?: { provider?: string; channel?: string };
    bestEffortDeliver?: boolean;
    internalEvents?: unknown;
  }) => {
    deliverSubagentAnnouncementArgsMock(params);
    const effectiveOrigin =
      params.completionDirectOrigin ?? params.requesterOrigin ?? params.directOrigin;
    const response = (await callGatewayMock({
      method: "agent",
      params: {
        sessionKey: params.targetRequesterSessionKey,
        message: params.triggerMessage,
        internalEvents: params.internalEvents,
        deliver:
          !params.requesterIsSubagent &&
          effectiveOrigin?.channel !== "webchat" &&
          Boolean(effectiveOrigin?.channel && effectiveOrigin?.to),
        bestEffortDeliver: params.bestEffortDeliver,
        ...(params.requesterIsSubagent
          ? {}
          : {
              channel: effectiveOrigin?.channel,
              to: effectiveOrigin?.to,
              accountId: effectiveOrigin?.accountId,
              threadId: effectiveOrigin?.threadId,
            }),
      },
    })) as { status?: string; error?: string };
    if (response.status === "error") {
      return { delivered: false, path: "direct", error: response.error ?? "agent delivery failed" };
    }
    return { delivered: true, path: "direct" };
  },
  loadRequesterSessionEntry: (sessionKey: string) => {
    const store = loadSessionStoreMock("/tmp/sessions.json") as Record<string, unknown>;
    return { entry: store?.[sessionKey] };
  },
  loadSessionEntryByKey: (sessionKey: string) => {
    const store = loadSessionStoreMock("/tmp/sessions.json") as Record<string, unknown>;
    return store?.[sessionKey] ?? { sessionId: sessionKey };
  },
  resolveAnnounceOrigin: (
    entry:
      | {
          lastChannel?: string;
          lastTo?: string;
          lastAccountId?: string;
          lastThreadId?: string;
          origin?: { provider?: string; channel?: string; accountId?: string };
        }
      | undefined,
    requesterOrigin?: { channel?: string; to?: string; accountId?: string; threadId?: string },
  ) => ({
    channel:
      requesterOrigin?.channel ??
      entry?.lastChannel ??
      entry?.origin?.provider ??
      entry?.origin?.channel,
    to: requesterOrigin?.to ?? entry?.lastTo,
    accountId: requesterOrigin?.accountId ?? entry?.lastAccountId ?? entry?.origin?.accountId,
    threadId: requesterOrigin?.threadId ?? entry?.lastThreadId,
  }),
  resolveSubagentCompletionOrigin: async (params: { requesterOrigin?: unknown }) =>
    params.requesterOrigin,
  resolveSubagentAnnounceTimeoutMs: () => 10_000,
  runAnnounceDeliveryWithRetry: async <T>(params: { run: () => Promise<T> }) => await params.run(),
}));

vi.mock("./subagent-announce.registry.runtime.js", () => subagentRegistryRuntimeMock);

import { runSubagentAnnounceFlow } from "./subagent-announce.js";

function requireAgentCallInternalEvents(callIndex: number) {
  const call = agentSpy.mock.calls[callIndex]?.[0];
  if (!call) {
    throw new Error(`expected agent call #${callIndex}`);
  }
  const internalEvents = (call.params as { internalEvents?: unknown[] })?.internalEvents;
  if (!internalEvents) {
    throw new Error(`expected internalEvents on agent call #${callIndex}`);
  }
  return internalEvents as Array<{ type: string; childToolEvidence?: unknown }>;
}

/**
 * Simulates what run.ts/agent-runner.ts compute for a resumed parent's own
 * reply -- calling the REAL production merge (mergeDelegatedToolEvidenceIntoSummary)
 * rather than reimplementing it, so a regression in that function (e.g.
 * dropping the viaSubagent tag or the calls/tools accounting) fails this
 * chain test too, not just run.trace-tool-summary.test.ts in isolation.
 */
function computeResumedTurnAuditTrace(internalEvents: unknown): AgentDecisionTrace {
  const direct = buildTraceToolSummary({ toolMetas: [], visibleToolNames: [], hadFailure: false });
  const delegated = collectDelegatedToolInvocationsFromInternalEvents(
    internalEvents as Parameters<typeof collectDelegatedToolInvocationsFromInternalEvents>[0],
  );
  const merged = mergeDelegatedToolEvidenceIntoSummary(direct, delegated);
  return buildAgentDecisionTrace({
    toolSummary: merged,
    completion: { refusal: false },
    payloads: [{ text: "Reviewed the delegated work; all good." }],
  });
}

describe("delegated audit-trace evidence reaches the parent's final trace", () => {
  beforeEach(() => {
    registryRows.map.clear();
    agentSpy.mockClear();
    deliverSubagentAnnouncementArgsMock.mockClear();
    callGatewayMock.mockReset().mockImplementation(async (req: unknown) => {
      const typed = req as AgentCallRequest;
      if (typed.method === "agent") {
        return await agentSpy(typed);
      }
      if (typed.method === "agent.wait") {
        return { status: "ok", startedAt: 10, endedAt: 20 };
      }
      if (typed.method === "chat.history") {
        return { messages: [] as Array<unknown> };
      }
      if (typed.method === "sessions.patch" || typed.method === "sessions.delete") {
        return {};
      }
      return {};
    });
    loadSessionStoreMock.mockReset().mockImplementation(() => ({}));
    resolveAgentIdFromSessionKeyMock.mockReset().mockImplementation(() => "main");
    resolveStorePathMock.mockReset().mockImplementation(() => "/tmp/sessions.json");
    resolveMainSessionKeyMock.mockReset().mockImplementation(() => "agent:main:main");
    isEmbeddedAgentRunActiveMock.mockReset().mockReturnValue(false);
    queueEmbeddedAgentMessageWithOutcomeMock
      .mockReset()
      .mockImplementation((sessionId: string) => ({
        queued: false,
        sessionId,
        reason: "not_streaming",
        gatewayHealth: "live",
      }));
    waitForEmbeddedAgentRunEndMock.mockReset().mockResolvedValue(true);
    mockConfig = { session: { mainKey: "main", scope: "per-sender" } };
    subagentRegistryRuntimeMock.shouldIgnorePostCompletionAnnounceForSession
      .mockReset()
      .mockReturnValue(false);
    subagentRegistryRuntimeMock.isSubagentSessionRunActive.mockReset().mockReturnValue(true);
    subagentRegistryRuntimeMock.countActiveDescendantRuns.mockReset().mockReturnValue(0);
    subagentRegistryRuntimeMock.countPendingDescendantRuns.mockReset().mockReturnValue(0);
    subagentRegistryRuntimeMock.countPendingDescendantRunsExcludingRun
      .mockReset()
      .mockReturnValue(0);
    subagentRegistryRuntimeMock.listSubagentRunsForRequester.mockReset().mockReturnValue([]);
    subagentRegistryRuntimeMock.replaceSubagentRunAfterSteer.mockReset().mockReturnValue(true);
    subagentRegistryRuntimeMock.resolveRequesterForChildSession.mockReset().mockReturnValue(null);
    subagentRegistryRuntimeMock.getLatestSubagentRunByChildSessionKey
      .mockReset()
      .mockImplementation((childSessionKey: string) => registryRows.map.get(childSessionKey));
  });

  it("single child: the child's own tool call reaches the parent's final auditTrace tagged viaSubagent, disposition flips to completed/tool_execution_succeeded", async () => {
    const childTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [{ kind: "tool_outcome", tool: "takeoff_dispatch", status: "ok" }],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    registryRows.map.set("agent:main:subagent:child-1", {
      runId: "run-child-1",
      childSessionKey: "agent:main:subagent:child-1",
      completion: { required: true, resultAuditTrace: childTrace },
    });

    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:child-1",
      childRunId: "run-child-1",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "run steel takeoff",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "Steel takeoff complete: 7 scopes.",
      expectsCompletionMessage: true,
    });

    const internalEvents = requireAgentCallInternalEvents(0);
    const parentAuditTrace = computeResumedTurnAuditTrace(internalEvents);

    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_dispatch",
      status: "ok",
      viaSubagent: true,
    });
    expect(parentAuditTrace.disposition).toBe("completed");
    expect(parentAuditTrace.reason).toBe("tool_execution_succeeded");
  });

  it("multi-child: both children's tool calls reach the parent's final auditTrace in the same wake", async () => {
    const childATrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    const childBTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_status_poll"],
      toolInvocations: [{ name: "takeoff_status_poll", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    subagentRegistryRuntimeMock.listSubagentRunsForRequester.mockReturnValue([
      {
        childSessionKey: "agent:main:subagent:child-a",
        task: "steel scope",
        createdAt: 1,
        outcome: { status: "ok" },
        completion: { resultText: "steel done", resultAuditTrace: childATrace },
      },
      {
        childSessionKey: "agent:main:subagent:child-b",
        task: "concrete scope",
        createdAt: 2,
        outcome: { status: "ok" },
        completion: { resultText: "concrete done", resultAuditTrace: childBTrace },
      },
    ]);

    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:child-b",
      childRunId: "run-child-b",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "concrete scope",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "concrete done",
      expectsCompletionMessage: true,
    });

    const internalEvents = requireAgentCallInternalEvents(0);
    const parentAuditTrace = computeResumedTurnAuditTrace(internalEvents);

    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_dispatch",
      status: "ok",
      viaSubagent: true,
    });
    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_status_poll",
      status: "ok",
      viaSubagent: true,
    });
  });

  it("multi-child: a settled descendant's tool evidence is not discarded when its own text reply is a silent skip", async () => {
    // buildChildCompletionFindings returns undefined for an all-ANNOUNCE_SKIP
    // wake (nothing worth announcing in prose), but the descendant still made
    // a real tool call -- that evidence must survive even though the prose
    // findings string is falsy.
    const descendantTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    subagentRegistryRuntimeMock.listSubagentRunsForRequester.mockReturnValue([
      {
        childSessionKey: "agent:main:subagent:silent-descendant",
        task: "silent scope",
        createdAt: 1,
        outcome: { status: "ok" },
        completion: { resultText: "ANNOUNCE_SKIP", resultAuditTrace: descendantTrace },
      },
    ]);

    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:parent-of-silent",
      childRunId: "run-parent-of-silent",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "outer scope",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "outer scope complete.",
      expectsCompletionMessage: true,
    });

    const internalEvents = requireAgentCallInternalEvents(0);
    const parentAuditTrace = computeResumedTurnAuditTrace(internalEvents);

    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_dispatch",
      status: "ok",
      viaSubagent: true,
    });
  });

  it("multi-child: a child's own direct tool calls and its settled descendant's tool calls both reach the parent", async () => {
    // The completing child made its own tool call AND has a settled
    // descendant with its own tool call -- both are independent evidence
    // sources and must both survive, not just whichever the ternary picks.
    const ownTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["read"],
      toolInvocations: [{ name: "read", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    const descendantTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    registryRows.map.set("agent:main:subagent:mid", {
      runId: "run-mid",
      childSessionKey: "agent:main:subagent:mid",
      completion: { required: true, resultAuditTrace: ownTrace },
    });
    subagentRegistryRuntimeMock.listSubagentRunsForRequester.mockReturnValue([
      {
        childSessionKey: "agent:main:subagent:mid-descendant",
        task: "descendant scope",
        createdAt: 1,
        outcome: { status: "ok" },
        completion: { resultText: "descendant done", resultAuditTrace: descendantTrace },
      },
    ]);

    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:mid",
      childRunId: "run-mid",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "mid scope",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "mid scope complete, descendant done too.",
      expectsCompletionMessage: true,
    });

    const internalEvents = requireAgentCallInternalEvents(0);
    const parentAuditTrace = computeResumedTurnAuditTrace(internalEvents);

    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "read",
      status: "ok",
      viaSubagent: true,
    });
    expect(parentAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_dispatch",
      status: "ok",
      viaSubagent: true,
    });
  });

  it("orphaned child: no resultAuditTrace on the registry row -- delivery still succeeds, no delegated evidence added, no crash", async () => {
    registryRows.map.set("agent:main:subagent:orphan", {
      runId: "run-orphan",
      childSessionKey: "agent:main:subagent:orphan",
      completion: { required: true, resultText: "done" },
    });

    const didAnnounce = await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:orphan",
      childRunId: "run-orphan",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "orphaned task",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "done",
      expectsCompletionMessage: true,
    });

    expect(didAnnounce).toBe(true);
    const internalEvents = requireAgentCallInternalEvents(0);
    expect(internalEvents[0]?.childToolEvidence).toBeUndefined();
    const parentAuditTrace = computeResumedTurnAuditTrace(internalEvents);
    expect(parentAuditTrace.toolInvocations).toEqual([]);
    expect(parentAuditTrace.disposition).toBe("completed");
    expect(parentAuditTrace.reason).toBe("no_tools_visible");
  });

  it("nested grandchild: the grandchild's tool call reaches the top-level parent's auditTrace with no special-casing (comes for free)", async () => {
    const grandchildTrace: AgentDecisionTrace = {
      schemaVersion: 1,
      visibleTools: ["takeoff_dispatch"],
      toolInvocations: [{ name: "takeoff_dispatch", status: "ok" }],
      evidence: [],
      confidence: "high",
      disposition: "completed",
      reason: "tool_execution_succeeded",
    };
    registryRows.map.set("agent:main:subagent:c1:subagent:grandchild", {
      runId: "run-grandchild",
      childSessionKey: "agent:main:subagent:c1:subagent:grandchild",
      completion: { required: true, resultAuditTrace: grandchildTrace },
    });

    // Hop 1: grandchild completes, announces to mid-level child C1.
    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:c1:subagent:grandchild",
      childRunId: "run-grandchild",
      requesterSessionKey: "agent:main:subagent:c1",
      requesterDisplayKey: "c1",
      task: "run grandchild scope",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "grandchild scope complete.",
      expectsCompletionMessage: true,
    });
    const c1InternalEvents = requireAgentCallInternalEvents(0);
    // Simulates agent-runner.ts computing C1's own reply trace for its
    // resumed turn, then Task 3 recording it onto C1's own registry row --
    // the same real functions the single-child test above exercises.
    const c1OwnAuditTrace = computeResumedTurnAuditTrace(c1InternalEvents);
    registryRows.map.set("agent:main:subagent:c1", {
      runId: "run-c1",
      childSessionKey: "agent:main:subagent:c1",
      completion: { required: true, resultAuditTrace: c1OwnAuditTrace },
    });

    // Hop 2: C1 completes, announces to the top-level parent. No special-
    // casing for "this child's evidence came from two hops down" anywhere --
    // it's just another registry row read the exact same way.
    await runSubagentAnnounceFlow({
      childSessionKey: "agent:main:subagent:c1",
      childRunId: "run-c1",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      requesterOrigin: { channel: "telegram", to: "-100123" },
      task: "run c1 task",
      timeoutMs: 10,
      cleanup: "keep",
      waitForCompletion: false,
      outcome: { status: "ok" },
      roundOneReply: "c1 task complete.",
      expectsCompletionMessage: true,
    });
    const topLevelInternalEvents = requireAgentCallInternalEvents(1);
    const topLevelAuditTrace = computeResumedTurnAuditTrace(topLevelInternalEvents);

    expect(topLevelAuditTrace.toolInvocations).toContainEqual({
      name: "takeoff_dispatch",
      status: "ok",
      viaSubagent: true,
    });
    expect(topLevelAuditTrace.disposition).toBe("completed");
    expect(topLevelAuditTrace.reason).toBe("tool_execution_succeeded");
  });
});
