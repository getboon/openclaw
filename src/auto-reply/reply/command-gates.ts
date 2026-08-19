// Applies command feature gates before command handlers execute.
import { isCommandFlagEnabled, type CommandFlagKey } from "../../config/commands.flags.js";
import { logVerbose } from "../../globals.js";
import { redactIdentifier } from "../../logging/redact-identifier.js";
import { isNativeCommandTurn, resolveCommandTurnContext } from "../command-turn-context.js";
import type { ReplyPayload } from "../types.js";
import type { CommandHandlerResult, HandleCommandsParams } from "./commands-types.js";

function buildNativeCommandGateReply(text: string): CommandHandlerResult {
  return {
    shouldContinue: false,
    reply: { text },
  };
}

export function rejectUnauthorizedCommand(
  params: HandleCommandsParams,
  commandLabel: string,
): CommandHandlerResult | null {
  if (params.command.isAuthorizedSender) {
    return null;
  }
  logVerbose(
    `Ignoring ${commandLabel} from unauthorized sender: ${redactIdentifier(params.command.senderId)}`,
  );
  if (isNativeCommandTurn(resolveCommandTurnContext(params.ctx))) {
    return buildNativeCommandGateReply("You are not authorized to use this command.");
  }
  return { shouldContinue: false };
}

/**
 * Rewrites the current inbound turn (ctx, rootCtx, and command) so it
 * continues as a normal prompt with the given text, and returns the
 * standard "continue as a new prompt" result. Shared by /steer's
 * no-active-run fallback and /retry, which always takes this path.
 */
export function continueAsNormalPrompt(
  params: HandleCommandsParams,
  message: string,
): CommandHandlerResult {
  applyNormalPromptRewrite(params.ctx, message);
  if (params.rootCtx && params.rootCtx !== params.ctx) {
    applyNormalPromptRewrite(params.rootCtx, message);
  }
  params.command.rawBodyNormalized = message;
  params.command.commandBodyNormalized = message;
  return { shouldContinue: true };
}

function applyNormalPromptRewrite(ctx: HandleCommandsParams["ctx"], message: string): void {
  const mutableCtx = ctx as Record<string, unknown>;
  mutableCtx.Body = message;
  mutableCtx.RawBody = message;
  mutableCtx.CommandBody = message;
  mutableCtx.BodyForCommands = message;
  mutableCtx.BodyForAgent = message;
  mutableCtx.BodyStripped = message;
}

export function rejectNonOwnerCommand(
  params: HandleCommandsParams,
  commandLabel: string,
): CommandHandlerResult | null {
  if (params.command.senderIsOwner) {
    return null;
  }
  logVerbose(
    `Ignoring ${commandLabel} from non-owner sender: ${redactIdentifier(params.command.senderId)}`,
  );
  if (isNativeCommandTurn(resolveCommandTurnContext(params.ctx))) {
    return buildNativeCommandGateReply("You are not authorized to use this command.");
  }
  return { shouldContinue: false };
}

export function requireGatewayClientScope(
  params: HandleCommandsParams,
  config: {
    label: string;
    allowedScopes: string[];
    missingText: string;
  },
): CommandHandlerResult | null {
  const scopes = params.ctx.GatewayClientScopes;
  if (!Array.isArray(scopes)) {
    return null;
  }
  if (config.allowedScopes.some((scope) => scopes.includes(scope))) {
    return null;
  }
  logVerbose(
    `Ignoring ${config.label} from gateway client missing scope: ${config.allowedScopes.join(" or ")}`,
  );
  return {
    shouldContinue: false,
    reply: { text: config.missingText },
  };
}

export function buildDisabledCommandReply(params: {
  label: string;
  configKey: CommandFlagKey;
  disabledVerb?: "is" | "are";
  docsUrl?: string;
}): ReplyPayload {
  const disabledVerb = params.disabledVerb ?? "is";
  const docsSuffix = params.docsUrl ? ` Docs: ${params.docsUrl}` : "";
  return {
    text: `⚠️ ${params.label} ${disabledVerb} disabled. Set commands.${params.configKey}=true to enable.${docsSuffix}`,
  };
}

export function requireCommandFlagEnabled(
  cfg: { commands?: unknown } | undefined,
  params: {
    label: string;
    configKey: CommandFlagKey;
    disabledVerb?: "is" | "are";
    docsUrl?: string;
  },
): CommandHandlerResult | null {
  if (isCommandFlagEnabled(cfg, params.configKey)) {
    return null;
  }
  return {
    shouldContinue: false,
    reply: buildDisabledCommandReply(params),
  };
}
