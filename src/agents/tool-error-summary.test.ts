// Proves the fixed, user-safe reason classification used by the non-terminal
// step-failure note — never the raw error text.
import { describe, expect, it } from "vitest";
import { classifyToolFailureReason } from "./tool-error-summary.js";

describe("classifyToolFailureReason", () => {
  it("classifies the explicit timedOut flag ahead of any text pattern", () => {
    expect(classifyToolFailureReason({ error: "permission denied", timedOut: true })).toEqual({
      code: "timed_out",
      text: "timed out",
    });
  });

  it.each([
    ["ETIMEDOUT", "timed_out", "timed out"],
    ["EACCES", "permission_denied", "permission denied"],
    ["EPERM", "permission_denied", "permission denied"],
    ["ENOENT", "not_found", "not found"],
    ["ENOTDIR", "not_found", "not found"],
    // ENOTFOUND is a DNS lookup failure (getaddrinfo), not a missing
    // resource — it must classify as network, not not_found.
    ["ENOTFOUND", "network", "couldn't reach the network"],
    ["ECONNREFUSED", "network", "couldn't reach the network"],
    ["ECONNRESET", "network", "couldn't reach the network"],
  ] as const)("classifies errorCode %s as %s", (errorCode, code, text) => {
    expect(classifyToolFailureReason({ errorCode, error: "opaque failure" })).toEqual({
      code,
      text,
    });
  });

  it.each([
    ["/bin/bash: line 1: python: command not found", "not_found", "not found"],
    ["find: '/proc': Permission denied", "permission_denied", "permission denied"],
    ["request timed out after 60s", "timed_out", "timed out"],
    ["fetch failed: network unreachable", "network", "couldn't reach the network"],
    ["Process exited with code 1.", "exit_error", "exited with an error"],
  ] as const)("classifies error message %s as %s", (error, code, text) => {
    expect(classifyToolFailureReason({ error })).toEqual({ code, text });
  });

  it("returns undefined for an unclassifiable error instead of a placeholder", () => {
    expect(classifyToolFailureReason({ error: "transient send failure" })).toBeUndefined();
  });

  it("returns undefined when there is no error text or code at all", () => {
    expect(classifyToolFailureReason({})).toBeUndefined();
  });

  it("never echoes the raw error text in the classified copy", () => {
    const result = classifyToolFailureReason({
      error: "/bin/bash: line 1: extract_lines.py: command not found",
    });
    expect(result?.text).toBe("not found");
    expect(result?.text).not.toContain("extract_lines.py");
  });
});
