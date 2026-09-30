import { i as rejectUnauthorizedCommand, n as continueAsNormalPrompt } from "./command-gates-w3e8ITzO.js";
//#region src/auto-reply/reply/commands-retry.ts
const RETRY_NUDGE_TEXT = "Please look at what didn't finish in your last reply and redo it.";
const RETRY_COMMAND_PATTERN = /^\/retry\s*$/i;
const handleRetryCommand = async (params, allowTextCommands) => {
	if (!allowTextCommands) return null;
	if (!RETRY_COMMAND_PATTERN.test(params.command.commandBodyNormalized)) return null;
	const unauthorized = rejectUnauthorizedCommand(params, "/retry");
	if (unauthorized) return unauthorized;
	return continueAsNormalPrompt(params, RETRY_NUDGE_TEXT);
};
//#endregion
export { handleRetryCommand as n, RETRY_NUDGE_TEXT as t };
