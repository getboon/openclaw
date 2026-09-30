import { type ToolErrorSummary } from "../tool-error-summary.js";
import type { RunEmbeddedAgentParams } from "./run/params.js";
import type { EmbeddedAgentRunResult, ToolSummaryTrace } from "./types.js";
export declare function buildTraceToolSummary(params: {
    toolMetas?: Array<{
        toolName: string;
        meta?: string;
        errored?: boolean;
        status?: "blocked" | "partial";
        detail?: string;
        asyncStarted?: boolean;
    }>;
    visibleToolNames?: readonly string[];
    hadFailure: boolean;
    /**
     * Errored calls with recovery flags. Omit to keep the legacy disposition.
     * Widened to optionally expose the classifier-relevant fields
     * too: the real runtime value here has always been `attempt.toolFailures`
     * (`Array<ToolErrorSummary & {retried?}>`, see run/types.ts), this type just
     * didn't surface them. All new fields stay optional so existing bare
     * `{retried}` callers/tests remain valid.
     */
    toolFailures?: ReadonlyArray<Partial<Pick<ToolErrorSummary, "toolName" | "error" | "errorCode" | "timedOut">> & {
        retried?: boolean;
    }>;
}): ToolSummaryTrace | undefined;
export declare function runEmbeddedAgent(paramsInput: RunEmbeddedAgentParams): Promise<EmbeddedAgentRunResult>;
