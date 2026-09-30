import type { AgentDecisionTrace, ReplyPayload } from "../reply-payload.js";
type ToolSummary = {
    calls: number;
    tools: string[];
    failures?: number;
    visibleTools?: string[];
    invocations?: Array<{
        name: string;
        status: "ok" | "partial" | "error" | "blocked";
        detail?: string;
    }>;
    /**
     * Errored calls still unresolved when the turn ended — every failure the
     * runtime did not mark `retried` (fixed by a later identical call). `0` means
     * every error was recovered before the turn finished; `undefined` means the
     * producer does not track recovery, so keep the legacy disposition.
     */
    unrecoveredFailures?: number;
};
/** Projects runtime-owned facts into the portable, chain-of-thought-free audit contract. */
export declare function buildAgentDecisionTrace(params: {
    toolSummary?: ToolSummary;
    completion?: {
        refusal?: boolean;
    };
    error?: unknown;
    failureSignal?: {
        kind?: string;
        code?: string;
    };
    payloads?: readonly ReplyPayload[];
}): AgentDecisionTrace;
/** Attaches audit facts to one terminal assistant payload without decorating notices. */
export declare function attachAgentDecisionTrace(payloads: readonly ReplyPayload[], auditTrace: AgentDecisionTrace): ReplyPayload[];
export {};
