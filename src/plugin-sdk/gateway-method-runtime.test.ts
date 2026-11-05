/**
 * Tests gateway method runtime wrappers exposed to plugins.
 */
import { describe, expect, it, vi } from "vitest";
import { withPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import { dispatchGatewayMethod } from "./gateway-method-runtime.js";

const { dispatchGatewayMethodInProcessRaw } = vi.hoisted(() => ({
  dispatchGatewayMethodInProcessRaw: vi.fn(),
}));

vi.mock("../gateway/server-plugins.js", () => ({
  dispatchGatewayMethodInProcessRaw,
}));

describe("plugin-sdk/gateway-method-runtime", () => {
  it("rejects callers without the gateway method dispatch contract", async () => {
    await expect(
      withPluginRuntimeGatewayRequestScope(
        {
          pluginId: "plain-plugin",
          client: {
            id: "plugin",
            connect: { scopes: ["operator.write"] },
          } as never,
          isWebchatConnect: () => false,
        },
        () => dispatchGatewayMethod("health", {}),
      ),
    ).rejects.toThrow(
      'contracts.gatewayMethodDispatch: ["authenticated-request"] for plugin "plain-plugin"',
    );
    expect(dispatchGatewayMethodInProcessRaw).not.toHaveBeenCalled();
  });

  it("dispatches through the scoped client for entitled plugin HTTP routes", async () => {
    dispatchGatewayMethodInProcessRaw.mockResolvedValueOnce({ ok: true, payload: { ok: true } });

    const result = await withPluginRuntimeGatewayRequestScope(
      {
        pluginId: "admin-http-rpc",
        gatewayMethodDispatchAllowed: true,
        client: {
          id: "plugin",
          connect: { scopes: ["operator.admin"] },
        } as never,
        isWebchatConnect: () => false,
      },
      () => dispatchGatewayMethod("health", {}, { timeoutMs: 500 }),
    );

    expect(result).toEqual({ ok: true, payload: { ok: true } });
    expect(dispatchGatewayMethodInProcessRaw).toHaveBeenCalledWith(
      "health",
      {},
      {
        disableSyntheticClient: true,
        requireScopedClient: true,
        timeoutMs: 500,
      },
    );
  });

  it("never forwards in-process-only agent fields from route callers", async () => {
    dispatchGatewayMethodInProcessRaw.mockResolvedValueOnce({ ok: true, payload: {} });

    await withPluginRuntimeGatewayRequestScope(
      {
        pluginId: "admin-http-rpc",
        gatewayMethodDispatchAllowed: true,
        client: {
          id: "plugin",
          connect: { scopes: ["operator.admin"] },
        } as never,
        isWebchatConnect: () => false,
      },
      () =>
        dispatchGatewayMethod("agent", {
          message: "proxied body",
          idempotencyKey: "idem",
          usageAttribution: { userId: "U-SPOOF" },
          oboToken: "eyJ.spoofed.obo",
        }),
    );

    const [, params, options] = dispatchGatewayMethodInProcessRaw.mock.lastCall ?? [];
    expect(params).toEqual({ message: "proxied body", idempotencyKey: "idem" });
    // The scoped client must not be marked as trusted in-process dispatch either.
    expect(options).not.toHaveProperty("inProcessDispatch");
  });
});
