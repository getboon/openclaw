import type { AgentInternalEvent } from "./internal-events.js";
export type SubagentCompletionOutcome = {
    status: "ok" | "error" | "timeout" | "unknown";
    error?: string;
    startedAt?: number;
    endedAt?: number;
    elapsedMs?: number;
};
export type SubagentCompletionRoute = {
    channel: string;
    accountId?: string;
    to: string;
    threadId?: string | number;
};
export type SubagentCompletionRequest = {
    completionId: string;
    childSessionKey: string;
    childRunId: string;
    requesterSessionKey: string;
    route: SubagentCompletionRoute;
    event: AgentInternalEvent;
    promptText: string;
    outcome?: SubagentCompletionOutcome;
    startedAt?: number;
    endedAt?: number;
    label?: string;
    signal?: AbortSignal;
    /**
     * True when the owner will not be called again for this completion, even if
     * this attempt fails retryably. A suspended completion (cleanup "keep",
     * outcome ok) can still reach the requester via steering on its next turn.
     * Computed before the call, so a late expiry or new pending descendants can
     * still change the real outcome.
     */
    finalAttempt?: boolean;
};
export type SubagentCompletionResult = {
    status: "delivered";
    deliveredAt?: number;
} | {
    status: "pending";
    error?: string;
} | {
    status: "not_handled";
} | {
    status: "failed";
    retryable: boolean;
    error: string;
};
export type SubagentCompletionOwner = {
    channel: string;
    accepts: (request: SubagentCompletionRequest) => boolean | Promise<boolean>;
    deliver: (request: SubagentCompletionRequest) => Promise<SubagentCompletionResult>;
};
export declare function registerSubagentCompletionOwner(owner: SubagentCompletionOwner): {
    dispose: () => void;
};
export declare function getSubagentCompletionOwner(channel: string | undefined): SubagentCompletionOwner | undefined;
export declare function resetSubagentCompletionOwnersForTest(): void;
