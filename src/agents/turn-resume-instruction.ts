/**
 * Wording of the turn-resume protocol for a main session.
 *
 * The `[System] …` instruction that tells the agent to continue an unfinished
 * turn from the existing transcript instead of starting over. Owned here rather
 * than at a call site so the two reasons stay side by side and drift is visible
 * in one file.
 *
 * These strings are not importable from outside this package: nothing re-exports
 * them and `package.json` publishes no `./agents/*` subpath. Out-of-process
 * producers (boon-core, which is Ruby and could never import them, and
 * anychat-boon-web) send a copy over the wire, so a change here is a wire break
 * that has to be mirrored by hand in those repos. Treat the text as frozen.
 *
 * Subagent orphan resume is deliberately not here: it restates the original task
 * and the last human message rather than pointing at the transcript, so it is a
 * different instruction rather than another reason. See
 * `subagent-orphan-recovery.ts`.
 */
import { sanitizePendingFinalDeliveryText } from "../auto-reply/reply/pending-final-delivery.js";

/** Why the turn being resumed stopped short. */
export type TurnResumeReason =
  /** The gateway restarted while the run was waiting on tool/model work. */
  | "gateway_restart"
  /**
   * The run stopped short for any other reason (a budget, step or latency bound)
   * and someone asked to continue it, which is what the Continue affordance in
   * boon-core / anychat-boon-web sends.
   */
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
