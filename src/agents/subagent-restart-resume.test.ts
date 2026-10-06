// Covers the shared closing-gateway guard used by the sub-agent run and task registries.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  markGatewayClosing,
  resetAllLanes,
  resetCommandQueueStateForTest,
} from "../process/command-queue.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import {
  resolveRestoredSubagentRunResumeAction,
  shouldKeepSubagentRunUnendedOnGatewayClose,
} from "./subagent-restart-resume.js";

const enabled = () => ({});
const disabled = () => ({ agents: { defaults: { subagents: { restartResume: false } } } });

function keep(params: {
  childSessionKey?: string;
  outcomeStatus?: "ok" | "error" | "timeout";
  explicitKill?: boolean;
  run?: Pick<SubagentRunRecord, "createdAt" | "startedAt" | "runTimeoutSeconds">;
  getConfig?: () => object;
}) {
  return shouldKeepSubagentRunUnendedOnGatewayClose({
    childSessionKey: params.childSessionKey ?? "agent:main:subagent:child",
    outcomeStatus: params.outcomeStatus ?? "error",
    explicitKill: params.explicitKill ?? false,
    run: params.run,
    getConfig: params.getConfig ?? enabled,
  });
}

describe("shouldKeepSubagentRunUnendedOnGatewayClose", () => {
  afterEach(() => {
    resetCommandQueueStateForTest();
  });

  it("keeps a native sub-agent interruption unended only while the gateway is closing", () => {
    expect(keep({})).toBe(false);
    markGatewayClosing();
    expect(keep({})).toBe(true);
    expect(keep({ outcomeStatus: "timeout" })).toBe(true);
  });

  it("never keeps successful completions, explicit kills, ACP or plugin runs unended", () => {
    markGatewayClosing();
    expect(keep({ outcomeStatus: "ok" })).toBe(false);
    expect(keep({ explicitKill: true })).toBe(false);
    expect(keep({ childSessionKey: "agent:main:acp:4f2c" })).toBe(false);
    expect(keep({ childSessionKey: "agent:main:dreaming:narrative" })).toBe(false);
  });

  it("follows the restartResume switch", () => {
    markGatewayClosing();
    expect(keep({ getConfig: disabled })).toBe(false);
  });

  it("does not keep a run past its run deadline", () => {
    const now = Date.parse("2026-03-24T12:00:00Z");
    vi.useFakeTimers({ now });
    try {
      markGatewayClosing();
      const run = { createdAt: now - 120_000, startedAt: now - 120_000 };
      expect(keep({ outcomeStatus: "timeout", run: { ...run, runTimeoutSeconds: 60 } })).toBe(
        false,
      );
      expect(keep({ outcomeStatus: "timeout", run: { ...run, runTimeoutSeconds: 600 } })).toBe(
        true,
      );
      expect(keep({ outcomeStatus: "timeout", run: { ...run, runTimeoutSeconds: 0 } })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops guarding after an in-process restart resets the lanes", () => {
    markGatewayClosing();
    resetAllLanes();
    expect(keep({})).toBe(false);
  });
});

describe("resolveRestoredSubagentRunResumeAction", () => {
  const now = Date.parse("2026-03-24T12:00:00Z");
  const hours = (count: number) => count * 60 * 60_000;
  const crashedSession = {
    sessionId: "sess-child",
    status: "running" as const,
    updatedAt: now - 1,
  };
  const run = (overrides: Partial<SubagentRunRecord>) =>
    ({
      runId: "run-restored",
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
      requesterDisplayKey: "main",
      task: "long task",
      cleanup: "keep",
      createdAt: now - hours(1),
      ...overrides,
    }) as SubagentRunRecord;
  const action = (overrides: Partial<SubagentRunRecord>) =>
    resolveRestoredSubagentRunResumeAction({
      run: run(overrides),
      session: crashedSession,
      now,
      processStartedAt: now,
    });

  it("measures the two-hour bound from the first session start across resumes", () => {
    expect(action({ startedAt: now - hours(1) })).toBe("mark-and-hold");
    expect(action({ startedAt: now - hours(1), sessionStartedAt: now - hours(3) })).toBe("too-old");
  });
});
