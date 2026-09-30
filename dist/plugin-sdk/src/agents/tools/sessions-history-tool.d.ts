import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import type { AnyAgentTool } from "./common.js";
type GatewayCaller = typeof callGateway;
export declare function createSessionsHistoryTool(opts?: {
    agentSessionKey?: string;
    /**
     * The actual live run session key. `agentSessionKey` may be a sandbox/
     * policy key that was never itself persisted as a transcript session --
     * binding a `sessionKey: "current"` request to it addresses a session that
     * can never be resumed. Mirrors the same fix already applied to
     * session_status and the goal tools.
     */
    runSessionKey?: string;
    sandboxed?: boolean;
    config?: OpenClawConfig;
    callGateway?: GatewayCaller;
}): AnyAgentTool;
export {};
