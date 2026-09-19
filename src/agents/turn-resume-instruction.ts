/**
 * Wording of the turn-resume protocol.
 *
 * The `[System] …` instruction that tells the agent to continue an unfinished
 * turn from the existing transcript instead of starting over. Owned here rather
 * than at a call site because more than one producer sends it: gateway restart
 * recovery (in-process) and the Continue affordance (boon-core /
 * anychat-boon-web, which send the string over the wire). Changing a string
 * here changes what those producers must send, so treat them as stable.
 */
import { sanitizePendingFinalDeliveryText } from "../auto-reply/reply/pending-final-delivery.js";

/** Why the turn being resumed stopped short. */
export type TurnResumeReason =
  /** The gateway restarted while the run was waiting on tool/model work. */
  | "gateway_restart"
  /** The run was stopped by a budget/step/latency interruption, not a restart. */
  | "turn_interrupted";

const RESUME_INSTRUCTION: Record<TurnResumeReason, string> = {
  gateway_restart:
    "[System] Your previous turn was interrupted by a gateway restart while " +
    "OpenClaw was waiting on tool/model work. Continue from the existing " +
    "transcript and finish the interrupted response.",
  turn_interrupted:
    "[System] Your previous turn was interrupted before it finished. " +
    "Continue from the existing transcript and finish the interrupted " +
    "response. Do not start over.",
};

/** Builds the continuation instruction, appending the captured final reply when there is one. */
export function buildTurnResumeInstruction(
  reason: TurnResumeReason,
  pendingFinalDeliveryText?: string | null,
): string {
  const base = RESUME_INSTRUCTION[reason];
  const sanitizedPendingText =
    typeof pendingFinalDeliveryText === "string"
      ? sanitizePendingFinalDeliveryText(pendingFinalDeliveryText)
      : "";
  if (sanitizedPendingText) {
    return `${base}\n\nNote: The interrupted final reply was captured: "${sanitizedPendingText}"`;
  }
  return base;
}
