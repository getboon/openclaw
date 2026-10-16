// Full-entry coverage for a long generation whose provider stream is cut off mid-output after
// the agent already ran tools. Without the same-model retry the first cut-off ended the run
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

describe("runEmbeddedAgent retry of a cut-off generation", () => {
  beforeAll(async () => {
    runEmbeddedAgent = await loadSharedRunIntegrationHarness();
  });

  beforeEach(() => {
    resetSharedRunIntegrationHarnessMocks();
    mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
    mockedClassifyFailoverReason.mockReturnValue(null);
  });

  it("retries the same model in smaller steps after a mid-output cut-off and completes", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(droppedAttempt("upstream error during stream", "| 26-0500 | 12.5 |"))
      .mockResolvedValueOnce(completedAttempt("Workbook complete."));

    const result = await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: PROVIDER,
      model: MODEL,
      runId: "run-stream-drop-resume",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(mockedRunEmbeddedAttempt.mock.calls[1]?.[0]?.prompt).toMatch(/smaller/i);
    // Same model throughout (no outer model fallback, which used to restart from zero) and the
    // run completes on the retried attempt instead of failing.
    for (const [attemptParams] of mockedRunEmbeddedAttempt.mock.calls) {
      expect(attemptParams).toMatchObject({ provider: PROVIDER, modelId: MODEL });
    }
    expect(result.meta.executionTrace?.fallbackUsed).toBe(false);
    expect(result.meta.error).toBeUndefined();
  });

  it("stops after one autonomous retry instead of looping", async () => {
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

    // 1 original attempt + 1 retry, then today's failure handling.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
  });
});
