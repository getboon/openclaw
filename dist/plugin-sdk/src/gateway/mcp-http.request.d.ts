import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { type McpLoopbackRequestContext } from "./mcp-grant-store.js";
type McpRequestContext = McpLoopbackRequestContext;
type McpLoopbackRequestAuth = {
    senderIsOwner: boolean;
    boundSessionKey?: string;
    boundContext?: McpLoopbackRequestContext;
    boundCaptureKey?: string;
};
export declare function validateMcpLoopbackRequest(params: {
    req: IncomingMessage;
    res: ServerResponse;
    ownerToken: string;
    nonOwnerToken: string;
    onSseResponse?: (res: ServerResponse) => void;
}): McpLoopbackRequestAuth | null;
export declare function readMcpHttpBody(req: IncomingMessage, options?: {
    maxBytes?: number;
    timeoutMs?: number;
}): Promise<string>;
export declare function isMcpHttpBodyTooLargeError(error: unknown): error is Error & {
    code: string;
};
export declare function isMcpHttpBodyTimeoutError(error: unknown): error is Error & {
    code: string;
};
export declare function resolveMcpHttpBodyTimeoutMs(): number;
export declare function resolveMcpCliCaptureKey(req: IncomingMessage, auth: McpLoopbackRequestAuth): string | undefined;
export declare function resolveMcpRequestContext(req: IncomingMessage, cfg: OpenClawConfig, auth: McpLoopbackRequestAuth): McpRequestContext;
export {};
