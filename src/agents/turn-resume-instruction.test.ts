import { describe, expect, it } from "vitest";
import { buildTurnResumeInstruction } from "./turn-resume-instruction.js";

// Pinned byte for byte: this is the string the private builder in
// main-session-restart-recovery.ts emitted before it moved here, and the one
// boon-core / anychat-boon-web send on Continue. Asserting against the
// constant would pass no matter how it drifted.
const GATEWAY_RESTART_TEXT =
  "[System] Your previous turn was interrupted by a gateway restart while OpenClaw was waiting on tool/model work. Continue from the existing transcript and finish the interrupted response.";
const TURN_INTERRUPTED_TEXT =
  "[System] Your previous turn was interrupted before it finished. Continue from the existing transcript and finish the interrupted response. Do not start over.";

describe("buildTurnResumeInstruction", () => {
  it("emits the legacy gateway-restart text unchanged", () => {
    expect(buildTurnResumeInstruction("gateway_restart")).toBe(GATEWAY_RESTART_TEXT);
  });

  it("emits the turn-interrupted text", () => {
    expect(buildTurnResumeInstruction("turn_interrupted")).toBe(TURN_INTERRUPTED_TEXT);
  });

  it.each([
    ["gateway_restart", GATEWAY_RESTART_TEXT],
    ["turn_interrupted", TURN_INTERRUPTED_TEXT],
  ] as const)("appends the captured final reply for %s", (reason, base) => {
    expect(buildTurnResumeInstruction(reason, "half an answer")).toBe(
      `${base}\n\nNote: The interrupted final reply was captured: "half an answer"`,
    );
  });

  it.each([undefined, null, "", "   \n  "])("omits the note for %j pending text", (pending) => {
    expect(buildTurnResumeInstruction("gateway_restart", pending)).toBe(GATEWAY_RESTART_TEXT);
  });
});
