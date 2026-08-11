// Implements /retry: asks the agent to redo the step named in its last reply.
// Always takes the same path as /steer's no-active-run fallback
// (continueAsNormalPrompt) — this command never targets an active run (the
// note it attaches to only ever appears after a turn has already completed
// and delivered a reply), so there is no steering/queue-mode case to check for.
import { continueAsNormalPrompt, rejectUnauthorizedCommand } from "./command-gates.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

export const RETRY_NUDGE_TEXT =
  "Please look at the step that didn't finish in your last reply and redo it.";

const RETRY_COMMAND_PATTERN = /^\/retry\s*$/i;

export const handleRetryCommand: CommandHandler = async (
  params,
  allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  if (!allowTextCommands) {
    return null;
  }
  if (!RETRY_COMMAND_PATTERN.test(params.command.commandBodyNormalized)) {
    return null;
  }

  const unauthorized = rejectUnauthorizedCommand(params, "/retry");
  if (unauthorized) {
    return unauthorized;
  }

  return continueAsNormalPrompt(params, RETRY_NUDGE_TEXT);
};
