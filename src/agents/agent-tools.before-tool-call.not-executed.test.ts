/**
 * A tool call the agent loop rejects BEFORE execution (schema-validation
 * failure, unknown tool name) never reaches the wrapped `tool.execute`, so the
 * tool-loop detector used to never see it. A gateway that seals a transport
 * error into a schema-valid `tool_use` with empty arguments therefore looped
 * unbounded (ENG-20206). These cover the not-executed reporting path.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  getDiagnosticSessionState,
  resetDiagnosticSessionStateForTest,
} from "../logging/diagnostic-session-state.js";
import { runNotExecutedToolCallHook } from "./agent-tools.before-tool-call.js";
import { CRITICAL_THRESHOLD } from "./tool-loop-detection.js";

const VALIDATION_ERROR =
  'Validation failed for tool "exec":\n  - command: must have required properties command\nReceived arguments: {}';

function ctxFor(sessionKey: string) {
  return { agentId: "main", sessionKey, loopDetection: { enabled: true } };
}

describe("runNotExecutedToolCallHook", () => {
  beforeEach(() => {
    resetDiagnosticSessionStateForTest();
  });

  it("records a schema-validation failure in the loop detector history", async () => {
    const sessionKey = "sess-validation";
    const outcome = await runNotExecutedToolCallHook({
      toolName: "exec",
      params: {},
      toolCallId: "call-1",
      error: VALIDATION_ERROR,
      ctx: ctxFor(sessionKey),
    });

    expect(outcome.blocked).toBe(false);
    const history = getDiagnosticSessionState({ sessionKey }).toolCallHistory ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ toolName: "exec" });
    expect(typeof history[0]?.resultHash).toBe("string");
  });

  it("blocks once identical validation failures reach the critical threshold", async () => {
    const sessionKey = "sess-loop";
    const call = (i: number) =>
      runNotExecutedToolCallHook({
        toolName: "exec",
        params: {},
        toolCallId: `call-${i}`,
        error: VALIDATION_ERROR,
        ctx: ctxFor(sessionKey),
      });

    for (let i = 0; i < CRITICAL_THRESHOLD; i += 1) {
      expect((await call(i)).blocked).toBe(false);
    }

    const blocked = await call(CRITICAL_THRESHOLD);
    expect(blocked.blocked).toBe(true);
    expect(String(blocked.reason)).toContain("CRITICAL");
  });

  it("records an unknown tool name so the unknown-tool detector can see it", async () => {
    const sessionKey = "sess-unknown";
    await runNotExecutedToolCallHook({
      toolName: "ghost",
      params: {},
      toolCallId: "call-ghost",
      error: "Tool ghost not found",
      ctx: ctxFor(sessionKey),
    });

    const history = getDiagnosticSessionState({ sessionKey }).toolCallHistory ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ toolName: "ghost", unknownToolName: "ghost" });
  });
});
