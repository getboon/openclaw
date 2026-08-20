// Browser Login Handoff state helper tests.
import { describe, expect, it } from "vitest";
import { browserHandoffStateKey } from "./state.js";

describe("browserHandoffStateKey", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(browserHandoffStateKey("  App.Procore.com  ")).toBe("app.procore.com");
  });

  it("treats different-case sites as the same key", () => {
    expect(browserHandoffStateKey("Example.com")).toBe(browserHandoffStateKey("example.com"));
  });
});
