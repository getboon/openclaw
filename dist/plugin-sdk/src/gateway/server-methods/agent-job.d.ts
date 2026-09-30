import type { AgentWaitTerminalSnapshot } from "./agent-wait-dedupe.js";
type AgentRunSnapshot = AgentWaitTerminalSnapshot & {
    runId: string;
    ts: number;
};
export declare function waitForAgentJob(params: {
    runId: string;
    timeoutMs: number;
    signal?: AbortSignal;
    ignoreCachedSnapshot?: boolean;
}): Promise<AgentRunSnapshot | null>;
export declare const testing: {
    getWaiterCount(runId?: string): number;
    resetWaiters(): void;
    getAgentRunCacheSize(): number;
    resetAgentRunCache(): void;
    agentRunCacheMaxEntries: number;
};
export { testing as __testing };
