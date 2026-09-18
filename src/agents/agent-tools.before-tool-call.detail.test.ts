/**
 * a before_tool_call hook FAILURE (a thrown handler) must carry its
 * real error text downstream as `detail`, while a plain policy VETO must not.
 * Covers buildBlockedToolResult's output plus the pre-execution-block state
 * map round-trip that carries the detail to the tool-execution handler.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBlockedToolResult,
  consumePreExecutionBlockedToolCall,
} from "./agent-tools.before-tool-call.js";
import { resetAdjustedParamsByToolCallIdForTests } from "./agent-tools.before-tool-call.state.js";

afterEach(() => {
  resetAdjustedParamsByToolCallIdForTests();
});

describe("buildBlockedToolResult — detail", () => {
  it("includes detail in the result details when a hook failure supplied it", () => {
    const result = buildBlockedToolResult({
      reason: "Tool call blocked because before_tool_call hook failed",
      deniedReason: "plugin-before-tool-call",
      detail: "Error: kaboom",
      toolCallId: "tc-fail",
      runId: "run-1",
    });
    expect(result.details).toMatchObject({ status: "blocked", detail: "Error: kaboom" });
  });

  it("omits detail entirely for a plain policy veto (no detail supplied)", () => {
    const result = buildBlockedToolResult({
      reason: "Tool call blocked by plugin hook",
      deniedReason: "plugin-before-tool-call",
      toolCallId: "tc-veto",
      runId: "run-1",
    });
    expect(result.details).not.toHaveProperty("detail");
  });
});

describe("consumePreExecutionBlockedToolCall — detail round-trip", () => {
  it("returns blocked:true with the detail a hook-failure block recorded", () => {
    buildBlockedToolResult({
      reason: "blocked",
      detail: "Error: kaboom",
      toolCallId: "tc-1",
      runId: "run-1",
    });
    expect(consumePreExecutionBlockedToolCall("tc-1", "run-1")).toEqual({
      blocked: true,
      detail: "Error: kaboom",
    });
  });

  it("returns blocked:true with NO detail key for a veto block", () => {
    buildBlockedToolResult({ reason: "blocked", toolCallId: "tc-2", runId: "run-1" });
    const consumed = consumePreExecutionBlockedToolCall("tc-2", "run-1");
    expect(consumed).toEqual({ blocked: true });
    expect(consumed).not.toHaveProperty("detail");
  });

  it("returns blocked:false for a tool call that was never blocked", () => {
    expect(consumePreExecutionBlockedToolCall("never", "run-1")).toEqual({ blocked: false });
  });

  it("consumes (deletes) the entry so a second read reports not-blocked", () => {
    buildBlockedToolResult({
      reason: "blocked",
      detail: "Error: kaboom",
      toolCallId: "tc-3",
      runId: "run-1",
    });
    expect(consumePreExecutionBlockedToolCall("tc-3", "run-1").blocked).toBe(true);
    expect(consumePreExecutionBlockedToolCall("tc-3", "run-1")).toEqual({ blocked: false });
  });
});
