// Covers sanitizeForConsole's own contract on top of the shared control-char
// sanitizer: undefined/empty passthrough and length capping.
import { describe, expect, it } from "vitest";
import { sanitizeForConsole } from "./console-sanitize.js";

describe("sanitizeForConsole", () => {
  it("returns undefined for undefined, empty, or all-whitespace input", () => {
    expect(sanitizeForConsole(undefined)).toBeUndefined();
    expect(sanitizeForConsole("")).toBeUndefined();
    expect(sanitizeForConsole("   ")).toBeUndefined();
  });

  it("strips control characters and flattens whitespace", () => {
    const esc = String.fromCharCode(0x1b);
    const c1 = String.fromCharCode(0x9d);
    expect(sanitizeForConsole(`bad${esc}text\nwith${c1}control\tchars`)).toBe(
      "badtext withcontrol chars",
    );
  });

  it("caps output at maxChars with an ellipsis", () => {
    const long = "x".repeat(250);
    const result = sanitizeForConsole(long, 200);
    expect(result).toBe(`${"x".repeat(200)}…`);
  });

  it("leaves short plain text untouched", () => {
    expect(sanitizeForConsole("plain text")).toBe("plain text");
  });
});
