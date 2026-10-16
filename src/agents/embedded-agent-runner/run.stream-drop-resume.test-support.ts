// ENG-21265 — full-entry replay of thread 15003: a long generation whose provider stream drops
// mid-output after the agent already ran tools. Before the fix the first drop ended the run
// (replay-unsafe ⇒ "proceed"), so the outer fallback / parent re-spawn restarted from zero.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedClassifyFailoverReason,
  mockedGlobalHookRunner,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetSharedRunIntegrationHarnessMocks,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;

const PROVIDER = "anthropic";
const MODEL = "claude-opus-4-7";
const RAN_TOOLS = { hadPotentialSideEffects: true, replaySafe: false };

function assistant(
  stopReason: "error" | "stop",
  text: string,
  errorMessage?: string,
): NonNullable<EmbeddedRunAttemptResult["lastAssistant"]> {
  return {
    role: "assistant",
    stopReason,
    provider: PROVIDER,
    model: MODEL,
    content: [{ type: "text", text }],
    usage: { input: 100, output: 400, totalTokens: 500 },
    ...(errorMessage ? { errorMessage } : {}),
  } as unknown as NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>;
}

function droppedAttempt(errorMessage: string, partial: string): EmbeddedRunAttemptResult {
  const dropped = assistant("error", partial, errorMessage);
  return makeAttemptResult({
    assistantTexts: [partial],
    lastAssistant: dropped,
    currentAttemptAssistant: dropped,
    toolMetas: [{ toolName: "exec", replaySafe: false }],
    replayMetadata: RAN_TOOLS,
    currentAttemptReplayMetadata: RAN_TOOLS,
  });
}

function completedAttempt(text: string): EmbeddedRunAttemptResult {
  const done = assistant("stop", text);
  return makeAttemptResult({
    assistantTexts: [text],
    lastAssistant: done,
    currentAttemptAssistant: done,
  });
}

describe("runEmbeddedAgent resume on mid-stream drop (ENG-21265)", () => {
  beforeAll(async () => {
    runEmbeddedAgent = await loadSharedRunIntegrationHarness();
  });

  beforeEach(() => {
    resetSharedRunIntegrationHarnessMocks();
    mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
    mockedClassifyFailoverReason.mockReturnValue(null);
  });

  it("resumes the same model after two mid-output drops and completes the work", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(droppedAttempt("upstream error during stream", "| 26-0500 | 12.5 |"))
      .mockResolvedValueOnce(
        droppedAttempt("Anthropic stream ended before message_stop", "\n| 26-0510 | 8.0 |"),
      )
      .mockResolvedValueOnce(completedAttempt("\n| 26-0520 | 4.0 |\nWorkbook complete."));

    const result = await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: PROVIDER,
      model: MODEL,
      runId: "run-stream-drop-resume",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(3);
    expect(mockedRunEmbeddedAttempt.mock.calls[1]?.[0]?.prompt).toMatch(/continue exactly where/i);
    expect(mockedRunEmbeddedAttempt.mock.calls[2]?.[0]?.prompt).toMatch(/continue exactly where/i);
    // Same model throughout (no outer model fallback, which used to restart from zero) and the
    // run completes on the resumed attempt instead of failing.
    for (const [attemptParams] of mockedRunEmbeddedAttempt.mock.calls) {
      expect(attemptParams).toMatchObject({ provider: PROVIDER, modelId: MODEL });
    }
    expect(result.meta.executionTrace?.fallbackUsed).toBe(false);
    expect(result.meta.error).toBeUndefined();
  });

  it("stops after the resume ceiling instead of looping forever", async () => {
    for (let i = 0; i < 6; i += 1) {
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(
        droppedAttempt("Anthropic stream ended before message_stop", `partial ${i}`),
      );
    }

    await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: PROVIDER,
      model: MODEL,
      runId: "run-stream-drop-resume-ceiling",
    }).catch(() => undefined);

    // 1 original attempt + 3 bounded resumes, then today's failure handling.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
  });
});
