import { type CommandFlagKey } from "../../config/commands.flags.js";
import type { ReplyPayload } from "../types.js";
import type { CommandHandlerResult, HandleCommandsParams } from "./commands-types.js";
export declare function rejectUnauthorizedCommand(params: HandleCommandsParams, commandLabel: string): CommandHandlerResult | null;
/**
 * Rewrites the current inbound turn (ctx, rootCtx, and command) so it
 * continues as a normal prompt with the given text, and returns the
 * standard "continue as a new prompt" result. Shared by /steer's
 * no-active-run fallback and /retry, which always takes this path.
 */
export declare function continueAsNormalPrompt(params: HandleCommandsParams, message: string): CommandHandlerResult;
export declare function rejectNonOwnerCommand(params: HandleCommandsParams, commandLabel: string): CommandHandlerResult | null;
export declare function requireGatewayClientScope(params: HandleCommandsParams, config: {
    label: string;
    allowedScopes: string[];
    missingText: string;
}): CommandHandlerResult | null;
export declare function buildDisabledCommandReply(params: {
    label: string;
    configKey: CommandFlagKey;
    disabledVerb?: "is" | "are";
    docsUrl?: string;
}): ReplyPayload;
export declare function requireCommandFlagEnabled(cfg: {
    commands?: unknown;
} | undefined, params: {
    label: string;
    configKey: CommandFlagKey;
    disabledVerb?: "is" | "are";
    docsUrl?: string;
}): CommandHandlerResult | null;
