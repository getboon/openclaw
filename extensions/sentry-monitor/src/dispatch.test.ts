import { describe, expect, it, vi } from "vitest";
import type { SentryCapture } from "./captures.js";
import { dispatchCapture, type SentryCaptureClient } from "./dispatch.js";

function fakeClient() {
  // Type the mocks with the real arity so `.mock.calls[n]` is a populated
  // tuple, not the zero-arg `[]` that a bare `vi.fn(() => ...)` would infer.
  const captureException = vi.fn<(exception: unknown, hint?: unknown) => string>(() => "evt-ex");
  const captureMessage = vi.fn<(message: string, hint?: unknown) => string>(() => "evt-msg");
  return { captureException, captureMessage } satisfies SentryCaptureClient;
}

describe("dispatchCapture", () => {
  it("does nothing for a null capture", () => {
    const client = fakeClient();
    dispatchCapture(client, null);
    expect(client.captureException).not.toHaveBeenCalled();
    expect(client.captureMessage).not.toHaveBeenCalled();
  });

  it("routes exception captures to captureException with an Error and the scope", () => {
    const client = fakeClient();
    const capture: SentryCapture = {
      kind: "exception",
      message: "boom",
      tags: { hook: "model_call_ended" },
      contexts: { run: { run_id: "r1" } },
      extra: { duration_ms: 5 },
    };
    dispatchCapture(client, capture);
    expect(client.captureMessage).not.toHaveBeenCalled();
    expect(client.captureException).toHaveBeenCalledOnce();
    const [error, scope] = client.captureException.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom");
    expect(scope).toEqual({
      tags: { hook: "model_call_ended" },
      contexts: { run: { run_id: "r1" } },
      extra: { duration_ms: 5 },
    });
  });

  it("routes message captures to captureMessage and threads the level", () => {
    const client = fakeClient();
    const capture: SentryCapture = {
      kind: "message",
      message: "session_end reason=unknown",
      level: "warning",
      tags: { hook: "session_end" },
    };
    dispatchCapture(client, capture);
    expect(client.captureException).not.toHaveBeenCalled();
    expect(client.captureMessage).toHaveBeenCalledOnce();
    const [message, scope] = client.captureMessage.mock.calls[0]!;
    expect(message).toBe("session_end reason=unknown");
    expect(scope).toMatchObject({ level: "warning", tags: { hook: "session_end" } });
  });
});
