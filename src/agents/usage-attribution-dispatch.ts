/**
 * Starts an `agent` run that carries the current turn's billing-only user.
 *
 * The agent method trusts `usageAttribution` only from core-built in-process dispatch,
 * so a run started on behalf of the current turn (sessions_send, subagent steer/send)
 * dispatches in-process when the gateway lives in this process. Otherwise it uses the
 * caller's socket path without the field and the run falls back to the target session's
 * persisted attribution.
 */
import type { callGateway, CallGatewayOptions } from "../gateway/call.js";
import { WRITE_SCOPE } from "../gateway/method-scopes.js";
import {
  dispatchGatewayMethodInProcess,
  hasInProcessGatewayContext,
} from "../gateway/server-plugins.js";
import type { UsageAttribution } from "./usage-attribution.js";

type AgentRunRequest = Omit<CallGatewayOptions, "method" | "params"> & {
  params: Record<string, unknown>;
};

const defaultDeps = { dispatchGatewayMethodInProcess, hasInProcessGatewayContext };
let deps = defaultDeps;

/** Starts an `agent` run, attributing it to `usageAttribution` when trusted dispatch is available. */
export async function callAgentWithUsageAttribution<T = Record<string, unknown>>(params: {
  callGateway: typeof callGateway;
  request: AgentRunRequest;
  usageAttribution: UsageAttribution | undefined;
}): Promise<T> {
  const { request, usageAttribution } = params;
  if (!usageAttribution || !deps.hasInProcessGatewayContext()) {
    // An older gateway's closed `agent` schema rejects unknown params, so the socket
    // path never carries the field.
    return await params.callGateway<T>({ ...request, method: "agent" });
  }
  return await deps.dispatchGatewayMethodInProcess<T>(
    "agent",
    { ...request.params, usageAttribution },
    {
      expectFinal: request.expectFinal,
      timeoutMs: request.timeoutMs ?? undefined,
      // Same client shape and scope the socket call would use for `agent`.
      forceSyntheticClient: true,
      syntheticScopes: [WRITE_SCOPE],
      inProcessDispatch: true,
    },
  );
}

export const testing = {
  setDepsForTest(overrides?: Partial<typeof defaultDeps>) {
    deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
  },
};
export { testing as __testing };
