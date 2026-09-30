import { type TSchema } from "typebox";
import type { DeliveryContext } from "../../utils/delivery-context.shared.js";
import { type AnyAgentTool } from "./common.js";
import { callGatewayTool } from "./gateway.js";
export declare function createCronToolSchema(): TSchema;
type CronToolOptions = {
    agentSessionKey?: string;
    /**
     * The actual live run session key. `agentSessionKey` may be a sandbox/policy
     * key (e.g. a direct-message peer key used only to scope permissions) that
     * was never itself persisted as a transcript session — binding a `current`
     * cron job to it schedules against a session that can never be resumed.
     * When present, this is the real key to stamp on `sessionTarget: "current"`
     * jobs instead. Mirrors the same fix already applied to session_status and
     * the goal tools.
     */
    runSessionKey?: string;
    currentDeliveryContext?: DeliveryContext;
    /**
     * Effective tool surface visible to the caller that created or edited a cron job.
     * Isolated cron runs use a fresh session, so agent-origin jobs need this cap
     * persisted on agentTurn payloads before the original session policy is lost.
     */
    creatorToolAllowlist?: CronCreatorToolAllowlistEntry[];
    selfRemoveOnlyJobId?: string;
};
export type CronCreatorToolAllowlistEntry = string | {
    name: string;
    pluginId?: string;
};
export declare function replaceWithEffectiveCronCreatorToolAllowlist<T extends {
    name: string;
}>(target: CronCreatorToolAllowlistEntry[], tools: readonly T[], toolMeta?: (tool: T) => {
    pluginId?: string;
} | undefined): void;
type GatewayToolCaller = typeof callGatewayTool;
type CronToolDeps = {
    callGatewayTool?: GatewayToolCaller;
};
export declare function createCronTool(opts?: CronToolOptions, deps?: CronToolDeps): AnyAgentTool;
export {};
