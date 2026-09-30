import { r as logVerbose } from "./globals-C-cvQH14.js";
import { t as isCommandFlagEnabled } from "./commands.flags-Hkig_lvj.js";
import { t as redactIdentifier } from "./redact-identifier-DB2Y_vWY.js";
import { a as isNativeCommandTurn, s as resolveCommandTurnContext } from "./command-turn-context-DXqYoJ8B.js";
//#region src/auto-reply/reply/command-gates.ts
function buildNativeCommandGateReply(text) {
	return {
		shouldContinue: false,
		reply: { text }
	};
}
function rejectUnauthorizedCommand(params, commandLabel) {
	if (params.command.isAuthorizedSender) return null;
	logVerbose(`Ignoring ${commandLabel} from unauthorized sender: ${redactIdentifier(params.command.senderId)}`);
	if (isNativeCommandTurn(resolveCommandTurnContext(params.ctx))) return buildNativeCommandGateReply("You are not authorized to use this command.");
	return { shouldContinue: false };
}
/**
* Rewrites the current inbound turn (ctx, rootCtx, and command) so it
* continues as a normal prompt with the given text, and returns the
* standard "continue as a new prompt" result. Shared by /steer's
* no-active-run fallback and /retry, which always takes this path.
*/
function continueAsNormalPrompt(params, message) {
	applyNormalPromptRewrite(params.ctx, message);
	if (params.rootCtx && params.rootCtx !== params.ctx) applyNormalPromptRewrite(params.rootCtx, message);
	params.command.rawBodyNormalized = message;
	params.command.commandBodyNormalized = message;
	return { shouldContinue: true };
}
function applyNormalPromptRewrite(ctx, message) {
	const mutableCtx = ctx;
	mutableCtx.Body = message;
	mutableCtx.RawBody = message;
	mutableCtx.CommandBody = message;
	mutableCtx.BodyForCommands = message;
	mutableCtx.BodyForAgent = message;
	mutableCtx.BodyStripped = message;
}
function rejectNonOwnerCommand(params, commandLabel) {
	if (params.command.senderIsOwner) return null;
	logVerbose(`Ignoring ${commandLabel} from non-owner sender: ${redactIdentifier(params.command.senderId)}`);
	if (isNativeCommandTurn(resolveCommandTurnContext(params.ctx))) return buildNativeCommandGateReply("You are not authorized to use this command.");
	return { shouldContinue: false };
}
function requireGatewayClientScope(params, config) {
	const scopes = params.ctx.GatewayClientScopes;
	if (!Array.isArray(scopes)) return null;
	if (config.allowedScopes.some((scope) => scopes.includes(scope))) return null;
	logVerbose(`Ignoring ${config.label} from gateway client missing scope: ${config.allowedScopes.join(" or ")}`);
	return {
		shouldContinue: false,
		reply: { text: config.missingText }
	};
}
function buildDisabledCommandReply(params) {
	const disabledVerb = params.disabledVerb ?? "is";
	const docsSuffix = params.docsUrl ? ` Docs: ${params.docsUrl}` : "";
	return { text: `⚠️ ${params.label} ${disabledVerb} disabled. Set commands.${params.configKey}=true to enable.${docsSuffix}` };
}
function requireCommandFlagEnabled(cfg, params) {
	if (isCommandFlagEnabled(cfg, params.configKey)) return null;
	return {
		shouldContinue: false,
		reply: buildDisabledCommandReply(params)
	};
}
//#endregion
export { requireCommandFlagEnabled as a, rejectUnauthorizedCommand as i, continueAsNormalPrompt as n, requireGatewayClientScope as o, rejectNonOwnerCommand as r, buildDisabledCommandReply as t };
