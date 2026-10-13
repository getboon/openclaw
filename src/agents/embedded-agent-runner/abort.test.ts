// Coverage for abort-shape detection used to classify embedded-runner
// rejections: a caller's own external timeout abort must not be reported
// as a run error.
import { describe, expect, it } from "vitest";
import {
  classifyAsyncTaskWaitTimeout,
  isExternalTimeoutAbortRejection,
  isRunnerAbortError,
} from "./abort.js";
import { abortable } from "./run/abortable.js";

/** Reproduces exactly what a channel plugin's own wall-clock budget sends. */
function makeExternalTimeoutSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort(new DOMException("Turn budget exceeded", "TimeoutError"));
  return controller.signal;
}

/**
 * Reproduces the exact rejection shape OpenClaw's own internal-watchdog
 * timeout produces once it reaches the catch block: like the external case,
 * it passes through abortable()'s makeAbortError wrapper, which always sets
 * name="AbortError" regardless of the original reason's name. The only
 * actual difference between the two cases is the externalAbort/timedOut
 * state flags, not the error's shape — a fixture that skips the wrapper
 * would pass this suite's "stays false" assertion for the wrong reason.
 */
async function makeInternalTimeoutRejection(): Promise<unknown> {
  const controller = new AbortController();
  const reason = new Error("request timed out");
  reason.name = "TimeoutError";
  controller.abort(reason);
  return abortable(controller.signal, new Promise(() => {})).catch((e: unknown) => e);
}

describe("isRunnerAbortError", () => {
  it("matches an AbortError by name", () => {
    const err = new Error("whatever");
    err.name = "AbortError";
    expect(isRunnerAbortError(err)).toBe(true);
  });

  it("matches a lower-level message mentioning aborted", () => {
    expect(isRunnerAbortError(new Error("tool run was aborted"))).toBe(true);
  });

  it("does not match an unrelated error", () => {
    expect(isRunnerAbortError(new Error("provider 500"))).toBe(false);
  });
});

describe("isExternalTimeoutAbortRejection", () => {
  it("is true for the exact external-timeout shape: caller abortSignal, timedOut, AbortError rejection", async () => {
    const signal = makeExternalTimeoutSignal();
    const err = await abortable(signal, new Promise(() => {})).catch((e: unknown) => e);
    expect(isExternalTimeoutAbortRejection({ err, externalAbort: true, timedOut: true })).toBe(
      true,
    );
  });

  it("stays false for OpenClaw's own internal-watchdog timeout (externalAbort never set)", async () => {
    // scheduleAbortTimer/idleTimeoutTrigger call abortRun(true, ...) directly
    // without going through onExternalAbortSignal/onAbort, so externalAbort
    // stays false even though timedOut is true and the error is abort-shaped
    // (confirm isRunnerAbortError(err) is true for this fixture, so the
    // false result below is actually exercising the externalAbort gate, not
    // isRunnerAbortError's own check).
    const err = await makeInternalTimeoutRejection();
    expect(isRunnerAbortError(err)).toBe(true);
    expect(isExternalTimeoutAbortRejection({ err, externalAbort: false, timedOut: true })).toBe(
      false,
    );
  });

  it("stays false for an external non-timeout abort (user cancel/restart)", () => {
    // abortActiveRunExternally calls abortRun(false, ...) for user_abort/
    // restart/superseded, so timedOut is false even though externalAbort is true.
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isExternalTimeoutAbortRejection({ err, externalAbort: true, timedOut: false })).toBe(
      false,
    );
  });

  it("stays false for a genuine prompt error racing an external abort", () => {
    // externalAbort/timedOut can both be true from an unrelated concurrent
    // abort while the real rejection is a provider failure, not the abort
    // itself — the abort-shape check is what keeps that distinguishable.
    const err = new Error("upstream 500");
    expect(isExternalTimeoutAbortRejection({ err, externalAbort: true, timedOut: true })).toBe(
      false,
    );
  });

  it("stays false when isRunnerAbortError's loose message match fires without external timeout state", () => {
    const err = new Error("tool run was aborted");
    expect(isExternalTimeoutAbortRejection({ err, externalAbort: false, timedOut: false })).toBe(
      false,
    );
  });

  it("regression anchor: the raw formatted message still carries the misleading '| 23' suffix", async () => {
    // This locks in WHY the predicate, not a formatter change, is the fix:
    // DOMException.code for TimeoutError is the legacy numeric constant 23,
    // and formatErrorMessage's cause-chain walk appends it verbatim. The fix
    // suppresses this string from ever reaching `error`, it does not change
    // what the string itself would be if read directly.
    const { formatErrorMessage } = await import("../../infra/errors.js");
    const signal = makeExternalTimeoutSignal();
    const err = await abortable(signal, new Promise(() => {})).catch((e: unknown) => e);
    expect(formatErrorMessage(err)).toBe("Turn budget exceeded | 23");
  });
});

describe("classifyAsyncTaskWaitTimeout", () => {
  it("is a no-op when nothing timed out", () => {
    expect(
      classifyAsyncTaskWaitTimeout({ timedOutRunIds: [], externalTimeoutAbortClassified: false }),
    ).toEqual({ kind: "none" });
    expect(
      classifyAsyncTaskWaitTimeout({ timedOutRunIds: [], externalTimeoutAbortClassified: true }),
    ).toEqual({ kind: "none" });
  });

  it("sets a real promptError when the run was not classified as a clean external abort", () => {
    const outcome = classifyAsyncTaskWaitTimeout({
      timedOutRunIds: ["run-1"],
      externalTimeoutAbortClassified: false,
    });
    expect(outcome).toEqual({
      kind: "error",
      message: "Timed out waiting for async task completion: run-1",
    });
  });

  it("logs instead of setting promptError when the run was already classified as a clean external abort", () => {
    // Regression guard: the completion-required async-task wait's own
    // deadline collapses to ~now once the run is already externally
    // aborted, so a still-pending task there must not silently undo the
    // classification by repopulating promptError.
    const outcome = classifyAsyncTaskWaitTimeout({
      timedOutRunIds: ["run-1", "run-2"],
      externalTimeoutAbortClassified: true,
    });
    expect(outcome.kind).toBe("log");
    expect(outcome.message).toContain("run-1, run-2");
  });
});
