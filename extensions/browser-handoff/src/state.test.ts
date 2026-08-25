// Browser Login Handoff state helper tests.
import { describe, expect, it } from "vitest";
import { browserHandoffScheduleTag, browserHandoffStateKey } from "./state.js";

describe("browserHandoffStateKey", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(browserHandoffStateKey("  App.Procore.com  ")).toBe("app.procore.com");
  });

  it("treats different-case sites as the same key", () => {
    expect(browserHandoffStateKey("Example.com")).toBe(browserHandoffStateKey("example.com"));
  });
});

describe("browserHandoffScheduleTag", () => {
  it("prefixes the normalized site with handoff-", () => {
    expect(browserHandoffScheduleTag("  App.Procore.com  ")).toBe("handoff-app.procore.com");
  });

  it("strips colons, since cron tags reject the reserved : delimiter", () => {
    expect(browserHandoffScheduleTag("weird:site.com")).not.toContain(":");
  });
});
