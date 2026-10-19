// Coverage for retrying a generation cut off mid-stream in runEmbeddedAgent: one same-model retry
// that asks for the step in smaller pieces, instead of model fallback / sub-agent re-spawn
// re-sending the same oversized call.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedClassifyFailoverReason,
  mockedGlobalHookRunner,
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
  resetRunOverflowCompactionHarnessMocks,
} from "./run.overflow-compaction.harness.js";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

let runEmbeddedAgent: typeof import("./run.js").runEmbeddedAgent;

const PROVIDER = "anthropic";
const MODEL = "claude-opus-4-7";
const RAN_TOOLS = { hadPotentialSideEffects: true, replaySafe: false };

function cutOffAttempt(errorMessage: string, partial: string): EmbeddedRunAttemptResult {
  const assistant = {
    role: "assistant",
    stopReason: "error",
    provider: PROVIDER,
    model: MODEL,
    content: [{ type: "text", text: partial }],
    usage: { input: 100, output: 400, totalTokens: 500 },
    errorMessage,
  } as unknown as NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>;
  return makeAttemptResult({
    assistantTexts: [partial],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
    toolMetas: [{ toolName: "exec", replaySafe: false }],
    replayMetadata: RAN_TOOLS,
  });
}

function completedAttempt(text: string): EmbeddedRunAttemptResult {
  const assistant = {
    role: "assistant",
    stopReason: "stop",
    provider: PROVIDER,
    model: MODEL,
    content: [{ type: "text", text }],
    usage: { input: 100, output: 5, totalTokens: 105 },
  } as unknown as NonNullable<EmbeddedRunAttemptResult["lastAssistant"]>;
  return makeAttemptResult({
    assistantTexts: [text],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
  });
}

describe("runEmbeddedAgent retry of a cut-off generation", () => {
  beforeAll(async () => {
    ({ runEmbeddedAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    resetRunOverflowCompactionHarnessMocks();
    mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
    mockedClassifyFailoverReason.mockReturnValue(null);
  });

  it("retries the same model in smaller steps after a mid-output cut-off and completes", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(cutOffAttempt("upstream error during stream", "| 26-0500 | 12.5 |"))
      .mockResolvedValueOnce(completedAttempt("Workbook complete."));

    const result = await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: PROVIDER,
      model: MODEL,
      runId: "run-stream-cutoff-retry",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    const retryParams = mockedRunEmbeddedAttempt.mock.calls[1]?.[0] as
      | { prompt?: string }
      | undefined;
    expect(retryParams?.prompt).toMatch(/smaller/i);
    for (const [attemptParams] of mockedRunEmbeddedAttempt.mock.calls) {
      expect(attemptParams).toMatchObject({ provider: PROVIDER, modelId: MODEL });
    }
    expect(result.meta.executionTrace?.fallbackUsed).toBe(false);
    expect(result.meta.error).toBeUndefined();
  });

  it("stops after one autonomous retry instead of looping", async () => {
    for (let i = 0; i < 6; i += 1) {
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(
        cutOffAttempt("Anthropic stream ended before message_stop", `partial ${i}`),
      );
    }

    const result = await runEmbeddedAgent({
      ...overflowBaseRunParams,
      provider: PROVIDER,
      model: MODEL,
      runId: "run-stream-cutoff-retry-ceiling",
    });

    // 1 original attempt + 1 retry, then the existing failure handling.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    expect(result.meta.error?.kind).toBe("incomplete_turn");
    expect(result.payloads?.[0]?.isError).toBe(true);
  });

  it("shares the one retry across model-fallback candidates of the same run", async () => {
    for (let i = 0; i < 6; i += 1) {
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(
        cutOffAttempt("Anthropic stream ended before message_stop", `partial ${i}`),
      );
    }
    // Model fallback re-enters the runner once per candidate model with the same runId.
    for (const model of [MODEL, "claude-sonnet-4-6"]) {
      await runEmbeddedAgent({
        ...overflowBaseRunParams,
        provider: PROVIDER,
        model,
        runId: "run-stream-cutoff-retry-fallback-chain",
      });
    }

    const retryPrompts = mockedRunEmbeddedAttempt.mock.calls.filter(([attemptParams]) =>
      /smaller/i.test(String((attemptParams as { prompt?: string }).prompt ?? "")),
    );
    expect(retryPrompts).toHaveLength(1);
    // primary: original + retry; fallback candidate: its own attempt only.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(3);
  });

  it("gives a different run its own retry", async () => {
    for (let i = 0; i < 4; i += 1) {
      mockedRunEmbeddedAttempt.mockResolvedValueOnce(
        cutOffAttempt("Anthropic stream ended before message_stop", `partial ${i}`),
      );
    }
    for (const runId of ["run-stream-cutoff-retry-turn-a", "run-stream-cutoff-retry-turn-b"]) {
      await runEmbeddedAgent({ ...overflowBaseRunParams, provider: PROVIDER, model: MODEL, runId });
    }

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
  });
});
