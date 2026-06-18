import { describe, it, expect } from "vitest";
import { normalizeCronRunErrorText } from "./timer.js";

const TIMEOUT_MSG = "cron: job execution timed out";

describe("normalizeCronRunErrorText — timeout-induced session takeover (ENG-14120 / ENG-13437)", () => {
  it("surfaces a clean timeout message for a wrapped takeover whose prompt error was a model-call timeout", () => {
    // Mirrors the live arguijo lane error: a cron model-call timed out, the run
    // aborted, and cleanup synthesized a takeover error whose message carries the
    // prompt (timeout) text. Before the fix this fell through to String(err) and
    // leaked the internal class name to the customer channel.
    const err = new Error(
      "aborted | cron: job execution timed out (last phase: model-call-started)",
    );
    err.name = "EmbeddedAttemptSessionTakeoverError";

    const out = normalizeCronRunErrorText(err);

    expect(out).toBe(TIMEOUT_MSG);
    expect(out).not.toContain("EmbeddedAttemptSessionTakeoverError");
    expect(out).not.toContain("session file changed");
  });

  it("does not leak the session file path when the timeout is in the error's cause chain", () => {
    // The customer-reported form: the surfaced error's own message is the raw
    // takeover string (incl. an absolute session path), with the timeout as cause.
    const cause = new Error(
      "aborted | cron: job execution timed out (last phase: model-call-started)",
    );
    cause.name = "AbortError";
    const err = new Error(
      "session file changed while embedded prompt lock was released: /home/ubuntu/.openclaw/agents/main/sessions/9073de3b.jsonl",
    );
    err.name = "EmbeddedAttemptSessionTakeoverError";
    (err as { cause?: unknown }).cause = cause;

    const out = normalizeCronRunErrorText(err);

    expect(out).toBe(TIMEOUT_MSG);
    expect(out).not.toContain(".jsonl");
    expect(out).not.toContain("/home/ubuntu");
  });

  it("leaves unrelated errors unchanged (regression guard)", () => {
    expect(normalizeCronRunErrorText(new Error("boom"))).toBe("Error: boom");
    expect(normalizeCronRunErrorText("plain string error")).toBe("plain string error");
  });

  it("does not over-normalize a non-timeout takeover (still distinct from a timeout)", () => {
    // A takeover with no timeout/abort anywhere in the chain is NOT the confirmed
    // arguijo case; this guards against the fix silently swallowing every takeover
    // into the timeout bucket. Current scope: such an error is left as-is.
    const err = new Error(
      "session file changed while embedded prompt lock was released: /home/ubuntu/x.jsonl",
    );
    err.name = "EmbeddedAttemptSessionTakeoverError";

    expect(normalizeCronRunErrorText(err)).not.toBe(TIMEOUT_MSG);
  });
});
