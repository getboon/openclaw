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
  it("prefixes the normalized, base64url-encoded site with handoff-", () => {
    const expected = `handoff-${Buffer.from("app.procore.com").toString("base64url")}`;
    expect(browserHandoffScheduleTag("  App.Procore.com  ")).toBe(expected);
  });

  it("never contains a colon, since cron tags reject the reserved : delimiter", () => {
    expect(browserHandoffScheduleTag("weird:site.com")).not.toContain(":");
  });

  it("does not collide between sites that differ only by : vs -", () => {
    const colonTag = browserHandoffScheduleTag("example.com:8080");
    const dashTag = browserHandoffScheduleTag("example.com-8080");
    expect(colonTag).not.toBe(dashTag);
  });
});
