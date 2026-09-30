import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import { type GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AnyAgentTool } from "./common.js";
type GatewayCaller = typeof callGateway;
export declare function createSessionsSendTool(opts?: {
    agentSessionKey?: string;
    /**
     * The actual live run session key. `agentSessionKey` may be a sandbox/policy
     * key (e.g. a direct-message peer key scoped only for permission checks) that
     * was never itself persisted as a transcript session. When present, this is
     * the real key to report as the sender identity — otherwise a receiving
     * session is told to address a reply to a key nothing can resume. Mirrors the
     * same fix already applied to session_status and the goal tools.
     */
    runSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    sandboxed?: boolean;
    config?: OpenClawConfig;
    callGateway?: GatewayCaller;
}): AnyAgentTool;
export {};
