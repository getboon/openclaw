// Coverage for subagent runs that were stopped before their attempt became active.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_ENDED_REASON_KILLED } from "../../subagent-lifecycle-events.js";
import { markSubagentRunTerminated } from "../../subagent-registry.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../../subagent-registry.test-helpers.js";
import {
  cleanupTempPaths,
  createContextEngineBootstrapAndAssemble,
  createDefaultEmbeddedSession,
  createContextEngineAttemptRunner,
  preloadRunEmbeddedAttemptForTests,
  resetEmbeddedAttemptHarness,
} from "./attempt.spawn-workspace.test-support.js";

const runId = "run-killed-before-start";
const childSessionKey = "agent:main:subagent:rand-printer";

function addSubagentRun(params: { killed: boolean }) {
  const now = Date.now();
  addSubagentRunForTests({
    runId,
    childSessionKey,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "print random numbers",
    cleanup: "keep",
    createdAt: now - 2_000,
    startedAt: now - 2_000,
    ...(params.killed
      ? {
          endedAt: now - 1_000,
          endedReason: SUBAGENT_ENDED_REASON_KILLED,
          outcome: { status: "error", error: "killed" },
        }
      : {}),
  });
}

describe("runEmbeddedAttempt killed subagent gate", () => {
  const tempPaths: string[] = [];

  beforeAll(async () => {
    await preloadRunEmbeddedAttemptForTests();
  });

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
    resetSubagentRegistryForTests();
  });

  afterEach(async () => {
    resetSubagentRegistryForTests();
    await cleanupTempPaths(tempPaths);
    vi.restoreAllMocks();
  });

  async function runAttempt(sessionKey: string, options?: { killDuringAssemble?: boolean }) {
    const session = createDefaultEmbeddedSession();
    const baseStreamFn = session.agent.streamFn;
    const streamFn = vi.fn(async () => await baseStreamFn?.());
    session.agent.streamFn = streamFn;
    const contextEngine = createContextEngineBootstrapAndAssemble();
    if (options?.killDuringAssemble) {
      contextEngine.assemble.mockImplementation(async ({ messages }) => {
        markSubagentRunTerminated({ runId, childSessionKey, reason: "killed" });
        return { messages, estimatedTokens: 1 };
      });
    }
    const result = await createContextEngineAttemptRunner({
      contextEngine,
      createSession: () => session,
      sessionKey,
      tempPaths,
      attemptOverrides: { runId },
    });
    return { result, streamFn };
  }

  it("aborts a subagent attempt whose run was killed before it started", async () => {
    addSubagentRun({ killed: true });

    const { result, streamFn } = await runAttempt(childSessionKey);

    expect(result.aborted).toBe(true);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("aborts a subagent attempt whose run was killed during a pre-prompt await", async () => {
    addSubagentRun({ killed: false });

    const { result, streamFn } = await runAttempt(childSessionKey, { killDuringAssemble: true });

    expect(result.aborted).toBe(true);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("does not gate a non-subagent session with the same run id", async () => {
    addSubagentRun({ killed: true });

    const { result, streamFn } = await runAttempt("agent:main:main");

    expect(result.aborted).toBe(false);
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("does not gate a subagent attempt whose run was not killed", async () => {
    addSubagentRun({ killed: false });

    const { result, streamFn } = await runAttempt(childSessionKey);

    expect(result.aborted).toBe(false);
    expect(streamFn).toHaveBeenCalledTimes(1);
  });
});
