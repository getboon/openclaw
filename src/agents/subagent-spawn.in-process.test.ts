import os from "node:os";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import type { PluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import {
  createSubagentSpawnTestConfig,
  loadSubagentSpawnModuleForTest,
} from "./subagent-spawn.test-helpers.js";

const agentHandler = vi.fn();

vi.doMock("../gateway/server-methods/agent.js", () => ({
  agentHandlers: {
    agent: agentHandler,
  },
}));

type SpawnSubagentDirect = typeof import("./subagent-spawn.js").spawnSubagentDirect;
type ServerPluginsModule = typeof import("../gateway/server-plugins.js");
type GatewayRequestScopeModule = typeof import("../plugins/runtime/gateway-request-scope.js");

let spawnSubagentDirect: SpawnSubagentDirect;
let serverPlugins: ServerPluginsModule;
let gatewayRequestScope: GatewayRequestScopeModule;

function createGatewayContext(cfg: Record<string, unknown>): GatewayRequestContext {
  return {
    getRuntimeConfig: () => cfg,
  } as unknown as GatewayRequestContext;
}

function createPluginScope(context: GatewayRequestContext): PluginRuntimeGatewayRequestScope {
  return {
    context,
    client: { connect: { scopes: [] } },
    isWebchatConnect: () => false,
  };
}

beforeAll(async () => {
  const loaded = await loadSubagentSpawnModuleForTest({
    callGatewayMock: vi.fn(),
    dispatchGatewayMethodInProcessImpl: (await import("../gateway/server-plugins.js"))
      .dispatchGatewayMethodInProcess,
    hasInProcessGatewayContextMock: vi.fn(() => true),
    getRuntimeConfig: () => createSubagentSpawnTestConfig(os.tmpdir()),
    resolveSubagentSpawnModelSelection: () => undefined,
    sessionStorePath: "/tmp/subagent-spawn-in-process-test.json",
  });
  spawnSubagentDirect = loaded.spawnSubagentDirect;
  serverPlugins = await import("../gateway/server-plugins.js");
  gatewayRequestScope = await import("../plugins/runtime/gateway-request-scope.js");
});

afterEach(() => {
  agentHandler.mockReset();
  serverPlugins.clearFallbackGatewayContext();
});

describe("subagent spawn in-process gateway authorization", () => {
  it("rejects the unpinned scope-less dispatch and accepts the pinned spawn", async () => {
    const cfg = createSubagentSpawnTestConfig(os.tmpdir());
    const context = createGatewayContext(cfg);
    serverPlugins.setFallbackGatewayContext(context);
    agentHandler.mockImplementation(async ({ respond }) => {
      respond(true, { runId: "run-real-dispatch", status: "accepted" });
    });

    await gatewayRequestScope.withPluginRuntimeGatewayRequestScope(
      createPluginScope(context),
      async () => {
        await expect(
          serverPlugins.dispatchGatewayMethodInProcess(
            "agent",
            { message: "un pinned", idempotencyKey: "un-pinned" },
            { timeoutMs: 1_000 },
          ),
        ).rejects.toThrow("missing scope: operator.write");

        const result = await spawnSubagentDirect(
          { task: "spawn through actual in-process dispatch" },
          { agentSessionKey: "agent:main:main" },
        );

        expect(result.status).toBe("accepted");
        expect(result.runId).toBe("run-real-dispatch");
      },
    );

    expect(agentHandler).toHaveBeenCalledTimes(1);
    const pinnedClient = agentHandler.mock.calls[0]?.[0]?.client;
    expect(pinnedClient?.connect?.scopes).toEqual(["operator.write"]);
  });
});
