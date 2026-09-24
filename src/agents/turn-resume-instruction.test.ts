import { describe, expect, it } from "vitest";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import {
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
} from "./internal-runtime-context.js";
import { buildTurnResumeInstruction } from "./turn-resume-instruction.js";

// Both texts are retyped here rather than imported: asserting against the
// implementation constant would pass no matter how it drifted. GATEWAY_RESTART_TEXT
// is pinned byte for byte to what the private builder in
// main-session-restart-recovery.ts emitted before it moved; TURN_INTERRUPTED_TEXT is
// the string boon-core / anychat-boon-web send on Continue, so a change breaks them.
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

  // These two keep the sanitize pass honest: a plain `.trim()` in place of
  // sanitizePendingFinalDeliveryText satisfies every other assertion in this file,
  // because no other case feeds a payload that trimming alone would not fix.
  it("strips internal runtime metadata out of the captured reply", () => {
    const captured = [
      "Visible answer.",
      INTERNAL_RUNTIME_CONTEXT_BEGIN,
      "internal recovery detail",
      INTERNAL_RUNTIME_CONTEXT_END,
    ].join("\n");
    expect(buildTurnResumeInstruction("turn_interrupted", captured)).toBe(
      `${TURN_INTERRUPTED_TEXT}\n\nNote: The interrupted final reply was captured: "Visible answer."`,
    );
  });

  it("omits the note when the captured reply is only a silent-reply token", () => {
    expect(buildTurnResumeInstruction("turn_interrupted", SILENT_REPLY_TOKEN)).toBe(
      TURN_INTERRUPTED_TEXT,
    );
  });
});
