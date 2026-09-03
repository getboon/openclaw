// Transport stream shared tests cover payload sanitization, header merging, and
// final/error stream termination helpers used by provider transports.
import { describe, expect, it, vi } from "vitest";
import {
  failTransportStream,
  finalizeTransportStream,
  mergeTransportHeaders,
  preserveProvisioningSmokeSessionHeader,
  sanitizeNonEmptyTransportPayloadText,
  sanitizeTransportPayloadText,
} from "./transport-stream-shared.js";

describe("transport stream shared helpers", () => {
  it("sanitizes unpaired surrogate code units", () => {
    const high = String.fromCharCode(0xd83d);
    const low = String.fromCharCode(0xdc00);

    expect(sanitizeTransportPayloadText(`left${high}right`)).toBe("leftright");
    expect(sanitizeTransportPayloadText(`left${low}right`)).toBe("leftright");
    expect(sanitizeTransportPayloadText("emoji 🙈 ok")).toBe("emoji 🙈 ok");
  });

  it("returns empty string for nullish payloads instead of throwing", () => {
    expect(sanitizeTransportPayloadText(undefined as unknown as string)).toBe("");
    expect(sanitizeTransportPayloadText(null as unknown as string)).toBe("");
    expect(sanitizeNonEmptyTransportPayloadText(undefined as unknown as string)).toBe(
      "(no output)",
    );
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \n\t "],
    ["invalid-surrogate-only", String.fromCharCode(0xd83d)],
  ])("falls back for %s tool payload text", (_label, value) => {
    expect(sanitizeNonEmptyTransportPayloadText(value)).toBe("(no output)");
  });

  it("preserves non-empty sanitized tool payload text", () => {
    expect(sanitizeNonEmptyTransportPayloadText(" ok ")).toBe(" ok ");
    expect(sanitizeNonEmptyTransportPayloadText(`left${String.fromCharCode(0xd83d)}right`)).toBe(
      "leftright",
    );
  });

  it("merges transport headers in source order", () => {
    expect(
      mergeTransportHeaders(
        { accept: "text/event-stream", "x-base": "one" },
        { authorization: "Bearer token" },
        { "x-base": "two" },
      ),
    ).toEqual({
      accept: "text/event-stream",
      authorization: "Bearer token",
      "x-base": "two",
    });
    expect(mergeTransportHeaders(undefined, undefined)).toBeUndefined();
  });

  it("collapses a generic header name across mixed casing, not just Boon-specific names", () => {
    // Every existing case-collapse test elsewhere in this suite uses
    // X-Boon-Session-ID variants. Prove the mechanism itself is generic by
    // exercising it with an arbitrary header name and cross-casing collision
    // (not merely the same casing appearing twice, which line 46's test above
    // already covers).
    expect(
      mergeTransportHeaders({ "X-Custom-Header": "one" }, { "x-custom-header": "two" }),
    ).toEqual({ "x-custom-header": "two" });
  });

  it("reasserts the run-id and capability headers together with the session id, not just the session id alone", () => {
    // The Gateway needs all three provisioning-smoke headers to identify and
    // refund a turn. A stale/incomplete upstream header set (e.g. a resolved
    // auth response that predates this turn's smoke capability) must not
    // silently drop the run-id/capability headers while the session id
    // alone survives -- that looks like the smoke session is intact but
    // breaks refund attribution.
    expect(
      preserveProvisioningSmokeSessionHeader(
        { "x-boon-session-id": "stale-ordinary-session" },
        {
          "X-Boon-Session-ID": "provisioning-smoke-run",
          "X-Boon-Provisioning-Smoke-Run-ID": "run-123",
          "X-Boon-Provisioning-Smoke-Capability": "signed-token",
        },
      ),
    ).toEqual({
      "X-Boon-Session-ID": "provisioning-smoke-run",
      "X-Boon-Provisioning-Smoke-Run-ID": "run-123",
      "X-Boon-Provisioning-Smoke-Capability": "signed-token",
    });
  });

  it("preserves only signed smoke sessions over later runtime attribution", () => {
    expect(
      preserveProvisioningSmokeSessionHeader(
        mergeTransportHeaders(
          { "X-Boon-Session-ID": "ordinary-model-session" },
          { "x-boon-session-id": "ordinary-runtime-session" },
        ),
        { "X-Boon-Session-ID": "provisioning-smoke-run" },
      ),
    ).toEqual({ "X-Boon-Session-ID": "provisioning-smoke-run" });

    expect(
      preserveProvisioningSmokeSessionHeader(
        mergeTransportHeaders(
          { "X-Boon-Session-ID": "ordinary-model-session" },
          { "x-boon-session-id": "ordinary-runtime-session" },
        ),
        { "X-Boon-Session-ID": "ordinary-model-session" },
      ),
    ).toEqual({ "x-boon-session-id": "ordinary-runtime-session" });
  });

  it("finalizes successful transport streams", () => {
    const push = vi.fn();
    const end = vi.fn();
    const output = { stopReason: "stop" };

    finalizeTransportStream({
      stream: { push, end },
      output,
    });

    expect(push).toHaveBeenCalledWith({
      type: "done",
      reason: "stop",
      message: output,
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("marks transport stream failures and runs cleanup", () => {
    // Failure finalization mutates the output message before emitting it so
    // downstream transcript consumers see the same error state as the stream.
    const push = vi.fn();
    const end = vi.fn();
    const cleanup = vi.fn();
    const output: { stopReason: string; errorMessage?: string } = { stopReason: "stop" };

    failTransportStream({
      stream: { push, end },
      output,
      error: new Error("boom"),
      cleanup,
    });

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(output.stopReason).toBe("error");
    expect(output.errorMessage).toBe("boom");
    expect(push).toHaveBeenCalledWith({
      type: "error",
      reason: "error",
      error: output,
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("captures a numeric HTTP status from the thrown transport error", () => {
    const push = vi.fn();
    const end = vi.fn();
    const output: {
      stopReason: string;
      errorMessage?: string;
      errorStatus?: number;
    } = { stopReason: "stop" };

    const error = Object.assign(
      new Error(
        '{"type":"error","error":{"type":"api_error","message":"Bedrock is unable to process your request."}}',
      ),
      { status: 503 },
    );

    failTransportStream({ stream: { push, end }, output, error });

    expect(output.stopReason).toBe("error");
    expect(output.errorStatus).toBe(503);
  });

  it("omits errorStatus when the thrown error has no numeric status", () => {
    const push = vi.fn();
    const end = vi.fn();
    const output: { stopReason: string; errorStatus?: number } = { stopReason: "stop" };

    failTransportStream({ stream: { push, end }, output, error: new Error("boom") });

    expect(output.errorStatus).toBeUndefined();
  });
});
