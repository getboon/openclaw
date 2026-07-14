// ENG-14117: cron --reply-style flag parsing for top-level vs threaded completion posts.
import { describe, expect, it } from "vitest";
import { parseCronReplyStyleOption } from "./reply-style-shared.js";

describe("parseCronReplyStyleOption", () => {
  it("accepts top-level", () => {
    expect(parseCronReplyStyleOption("top-level")).toBe("top-level");
  });

  it("accepts thread", () => {
    expect(parseCronReplyStyleOption("thread")).toBe("thread");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(parseCronReplyStyleOption("  Top-Level ")).toBe("top-level");
  });

  it("returns undefined for an unset flag", () => {
    expect(parseCronReplyStyleOption(undefined)).toBeUndefined();
    expect(parseCronReplyStyleOption("")).toBeUndefined();
  });

  it("rejects unknown values with an actionable error", () => {
    expect(() => parseCronReplyStyleOption("topLevel")).toThrow(
      /--reply-style must be "thread" or "top-level"/,
    );
  });
});
