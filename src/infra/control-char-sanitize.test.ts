// Covers the canonical control-char/whitespace sanitizer shared by
// src/agents/console-sanitize.ts and src/infra/diagnostic-error-metadata.ts.
import { describe, expect, it } from "vitest";
import { sanitizeControlCharsForLogging } from "./control-char-sanitize.js";

describe("sanitizeControlCharsForLogging", () => {
  it("strips C0 control characters other than tab/newline/carriage-return", () => {
    const esc = String.fromCharCode(0x1b);
    const bell = String.fromCharCode(0x07);
    const raw = `bad${esc}value${bell}text`;
    expect(sanitizeControlCharsForLogging(raw)).toBe("badvaluetext");
  });

  it("strips C1 control characters (0x7f-0x9f)", () => {
    const del = String.fromCharCode(0x7f);
    const c1 = String.fromCharCode(0x9d);
    const raw = `left${del}middle${c1}right`;
    expect(sanitizeControlCharsForLogging(raw)).toBe("leftmiddleright");
  });

  it("flattens tabs, newlines, and unicode line/paragraph separators to a single space", () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    const raw = `a\tb\nc\rd${lineSeparator}e${paragraphSeparator}f`;
    expect(sanitizeControlCharsForLogging(raw)).toBe("a b c d e f");
  });

  it("trims leading and trailing whitespace after flattening", () => {
    expect(sanitizeControlCharsForLogging("  padded text  ")).toBe("padded text");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeControlCharsForLogging("plain ASCII text 123")).toBe("plain ASCII text 123");
  });
});
