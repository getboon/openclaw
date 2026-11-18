// Covers sanitizeForConsole's own contract on top of the shared control-char
// sanitizer: undefined/empty passthrough and length capping.
import { describe, expect, it } from "vitest";
import { sanitizeForConsole } from "./console-sanitize.js";

const hasLoneSurrogate = (value: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

describe("sanitizeForConsole", () => {
  it("truncates on code-point boundaries without splitting a surrogate pair", () => {
    const grin = String.fromCodePoint(0x1f600); // 😀 — two UTF-16 code units
    const out = sanitizeForConsole(grin.repeat(6), 3);
    expect(out).toBe(`${grin.repeat(3)}…`);
    expect(out !== undefined && hasLoneSurrogate(out)).toBe(false);
  });

  it("returns undefined for undefined, empty, or all-whitespace input", () => {
    expect(sanitizeForConsole(undefined)).toBeUndefined();
    expect(sanitizeForConsole("")).toBeUndefined();
    expect(sanitizeForConsole("   ")).toBeUndefined();
  });

  it("returns undefined when the input is entirely stripped control characters", () => {
    // A lone control char survives .trim() (it isn't whitespace) but is fully
    // stripped by the sanitizer, so callers' `?? fallback` must still fire
    // instead of receiving a blank string.
    const c1 = String.fromCharCode(0x9d);
    const esc = String.fromCharCode(0x1b);
    expect(sanitizeForConsole(c1)).toBeUndefined();
    expect(sanitizeForConsole(esc)).toBeUndefined();
    expect(sanitizeForConsole(c1) ?? "-").toBe("-");
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
