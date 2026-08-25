import { describe, expect, it } from "vitest";
import { collapseErrorSnippet } from "./send.js";

describe("collapseErrorSnippet", () => {
  it("strips the ESC byte that drives terminal escape sequences", () => {
    // Only the ESC control byte (0x1b) is a control character; the bracket,
    // digits, and letter that follow it in a real ANSI sequence are ordinary
    // printable text, so they remain — but with ESC gone, a terminal no
    // longer interprets them as an escape sequence.
    const hostile = "before\x1b[2Jclear-screen\x1b[31mred-text\x1b[0mafter";

    expect(collapseErrorSnippet(hostile)).toBe("before[2Jclear-screen[31mred-text[0mafter");
  });

  it("removes C0 and C1 control bytes while preserving normal text", () => {
    const withControls = `nul:\x00 bell:\x07 shift-out:\x0e c1:\x9f del:\x7f end`;

    expect(collapseErrorSnippet(withControls)).toBe("nul: bell: shift-out: c1: del: end");
  });

  it("still collapses ordinary whitespace after stripping control characters", () => {
    expect(collapseErrorSnippet("  too   much\t\twhitespace\n\n")).toBe("too much whitespace");
  });

  it("caps the snippet length after sanitizing", () => {
    const long = "x".repeat(500);
    const result = collapseErrorSnippet(long);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(201);
  });
});
