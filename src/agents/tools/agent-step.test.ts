// Agent step tests cover nested session handoff, transcript bookkeeping, and
// MCP runtime retirement after completed nested turns.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallGatewayOptions } from "../../gateway/call.js";
import { testing as usageAttributionDispatchTesting } from "../usage-attribution-dispatch.js";
import { runAgentStep, testing } from "./agent-step.js";

const runWaitMocks = vi.hoisted(() => ({
  waitForAgentRunAndReadUpdatedAssistantReply: vi.fn(),
}));

const bundleMcpRuntimeMocks = vi.hoisted(() => ({
  retireSessionMcpRuntimeForSessionKey: vi.fn(async () => true),
}));

vi.mock("../run-wait.js", () => ({
  waitForAgentRunAndReadUpdatedAssistantReply:
    runWaitMocks.waitForAgentRunAndReadUpdatedAssistantReply,
}));

vi.mock("../agent-bundle-mcp-tools.js", () => ({
  retireSessionMcpRuntimeForSessionKey: bundleMcpRuntimeMocks.retireSessionMcpRuntimeForSessionKey,
}));

// Attributed steps dispatch in-process; tests inject that seam instead of loading
// the plugin loader/registry behind the real server-plugins module.
vi.mock("../../gateway/server-plugins.js", () => ({
  dispatchGatewayMethodInProcess: vi.fn(),
  hasInProcessGatewayContext: () => false,
}));

describe("runAgentStep", () => {
  afterEach(() => {
    testing.setDepsForTest();
    vi.clearAllMocks();
  });

  it("retires bundle MCP runtime after successful nested agent steps", async () => {
    // Nested steps disable automatic delivery and carry provenance so the reply
    // returns through the message tool path instead of the channel.
    const gatewayCalls: CallGatewayOptions[] = [];
    testing.setDepsForTest({
      callGateway: async <T = unknown>(opts: CallGatewayOptions): Promise<T> => {
        gatewayCalls.push(opts);
        return { runId: "run-nested" } as T;
      },
    });
    runWaitMocks.waitForAgentRunAndReadUpdatedAssistantReply.mockResolvedValue({
      status: "ok",
      replyText: "done",
    });

    await expect(
      runAgentStep({
        sessionKey: "agent:main:subagent:child",
        message: "hello",
        extraSystemPrompt: "reply briefly",
        timeoutMs: 10_000,
      }),
    ).resolves.toBe("done");

    const params = gatewayCalls[0]?.params as
      | {
          message?: string;
          sessionKey?: string;
          deliver?: boolean;
          sourceReplyDeliveryMode?: string;
          lane?: string;
          inputProvenance?: { kind?: string; sourceTool?: string };
        }
      | undefined;
    expect(params?.message).toContain("[Inter-session message");
    expect(params?.sessionKey).toBe("agent:main:subagent:child");
    expect(params?.deliver).toBe(false);
    expect(params?.sourceReplyDeliveryMode).toBe("message_tool_only");
    expect(params?.lane).toBe("nested:agent:main:subagent:child");
    expect(params?.inputProvenance?.kind).toBe("inter_session");
    expect(params?.inputProvenance?.sourceTool).toBe("sessions_send");
    expect(params?.message).toContain("isUser=false");
    expect(params?.message).toContain("hello");
    expect(bundleMcpRuntimeMocks.retireSessionMcpRuntimeForSessionKey).toHaveBeenCalledWith({
      sessionKey: "agent:main:subagent:child",
      reason: "nested-agent-step-complete",
    });
  });

  it("does not retire bundle MCP runtime while nested agent steps are still pending", async () => {
    testing.setDepsForTest({
      callGateway: async <T = unknown>(): Promise<T> => ({ runId: "run-pending" }) as T,
    });
    runWaitMocks.waitForAgentRunAndReadUpdatedAssistantReply.mockResolvedValue({
      status: "timeout",
    });

    await expect(
      runAgentStep({
        sessionKey: "agent:main:subagent:child",
        message: "hello",
        extraSystemPrompt: "reply briefly",
        timeoutMs: 10_000,
      }),
    ).resolves.toBeUndefined();

    expect(bundleMcpRuntimeMocks.retireSessionMcpRuntimeForSessionKey).not.toHaveBeenCalled();
  });

  it("forwards explicit transcript bodies for nested bookkeeping turns", async () => {
    const gatewayCalls: CallGatewayOptions[] = [];
    const agentCommandFromIngress = vi.fn(async () => ({
      payloads: [{ text: "done", mediaUrl: null }],
      meta: { durationMs: 1 },
    }));
    testing.setDepsForTest({
      agentCommandFromIngress,
      callGateway: async <T = unknown>(opts: CallGatewayOptions): Promise<T> => {
        gatewayCalls.push(opts);
        return { runId: "run-nested" } as T;
      },
    });
    runWaitMocks.waitForAgentRunAndReadUpdatedAssistantReply.mockResolvedValue({
      status: "ok",
      replyText: "done",
    });

    await runAgentStep({
      sessionKey: "agent:main:subagent:child",
      message: "internal announce step",
      transcriptMessage: "",
      extraSystemPrompt: "announce only",
      timeoutMs: 10_000,
    });

    expect(gatewayCalls).toStrictEqual([]);
    expect(agentCommandFromIngress).toHaveBeenCalledTimes(1);
    const ingressCalls = agentCommandFromIngress.mock.calls as unknown as Array<
      [{ message?: string; sourceReplyDeliveryMode?: string; transcriptMessage?: string }]
    >;
    const ingress = ingressCalls[0]?.[0];
    expect(ingress?.message).toContain("internal announce step");
    expect(ingress?.sourceReplyDeliveryMode).toBe("message_tool_only");
    expect(ingress?.transcriptMessage).toBe("");
  });

  it("attributes nested steps to the originating user on both execution paths", async () => {
    const bob = { userId: "U-BOB", userName: "Bob", userSource: "slack" };
    const dispatched: unknown[][] = [];
    const gatewayCalls: CallGatewayOptions[] = [];
    const agentCommandFromIngress = vi.fn(async () => ({
      payloads: [{ text: "done", mediaUrl: null }],
      meta: { durationMs: 1 },
    }));
    testing.setDepsForTest({
      agentCommandFromIngress,
      callGateway: async <T = unknown>(opts: CallGatewayOptions): Promise<T> => {
        gatewayCalls.push(opts);
        return { runId: "run-socket" } as T;
      },
    });
    usageAttributionDispatchTesting.setDepsForTest({
      hasInProcessGatewayContext: () => true,
      dispatchGatewayMethodInProcess: (async (...args: unknown[]) => {
        dispatched.push(args);
        return { runId: "run-in-process" };
      }) as never,
    });
    runWaitMocks.waitForAgentRunAndReadUpdatedAssistantReply.mockResolvedValue({
      status: "ok",
      replyText: "done",
    });
    const step = {
      sessionKey: "agent:main:subagent:child",
      message: "hello",
      extraSystemPrompt: "reply briefly",
      timeoutMs: 10_000,
      usageAttribution: bob,
    };

    try {
      await runAgentStep(step);
      const [method, params, options] = dispatched[0] ?? [];
      expect(method).toBe("agent");
      expect((params as { usageAttribution?: unknown }).usageAttribution).toEqual(bob);
      expect(options).toMatchObject({ inProcessDispatch: true });
      expect(gatewayCalls).toStrictEqual([]);

      // Without an in-process gateway the socket call stays unchanged.
      usageAttributionDispatchTesting.setDepsForTest({ hasInProcessGatewayContext: () => false });
      await runAgentStep(step);
      expect(gatewayCalls[0]?.method).toBe("agent");
      expect(gatewayCalls[0]?.params).not.toHaveProperty("usageAttribution");

      // The transcript path runs the command in-process and carries the user directly.
      await runAgentStep({ ...step, transcriptMessage: "" });
      const ingressCalls = agentCommandFromIngress.mock.calls as unknown as Array<
        [{ usageAttribution?: unknown }]
      >;
      expect(ingressCalls[0]?.[0]?.usageAttribution).toEqual(bob);
    } finally {
      usageAttributionDispatchTesting.setDepsForTest();
    }
  });
});
