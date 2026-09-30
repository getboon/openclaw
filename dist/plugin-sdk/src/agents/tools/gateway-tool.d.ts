import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { type AnyAgentTool } from "./common.js";
/** @internal Exposed for regression tests only; do not import from runtime code. */
export declare function assertGatewayConfigMutationAllowedForTest(params: {
    action: "config.apply" | "config.patch";
    currentConfig: Record<string, unknown>;
    raw: string;
    replacePaths?: string[];
}): void;
export declare function createGatewayTool(opts?: {
    agentSessionKey?: string;
    /**
     * The actual live run session key. `agentSessionKey` may be a sandbox/policy
     * key (e.g. a direct-message peer key) that was never itself persisted as a
     * transcript session -- fine for delivery-context/channel routing (which the
     * policy key encodes and the live key does not), but binding a post-restart
     * `continuationMessage` to it makes the continuation dispatch into a fresh,
     * disconnected session instead of resuming the real one. When present, this
     * is the key to bind the continuation to. Mirrors the same fix already
     * applied to session_status and the goal tools.
     */
    runSessionKey?: string;
    config?: OpenClawConfig;
}): AnyAgentTool;
