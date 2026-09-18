import { afterEach, describe, expect, it } from "vitest";
import {
  getSubagentCompletionOwner,
  registerSubagentCompletionOwner,
  resetSubagentCompletionOwnersForTest,
} from "./subagent-completion-owner.js";
import type { SubagentCompletionOwner } from "./subagent-completion-owner.js";

const createOwner = (channel: string): SubagentCompletionOwner => ({
  channel,
  accepts: () => true,
  deliver: async () => ({ status: "not_handled" }),
});

describe("subagent completion owner registry", () => {
  afterEach(() => {
    resetSubagentCompletionOwnersForTest();
  });

  it("registers and looks up a normalized channel", () => {
    const owner = createOwner("AnyChat-Boon-Web");

    registerSubagentCompletionOwner(owner);

    expect(getSubagentCompletionOwner("anychat-boon-web")).toBe(owner);
  });

  it("rejects duplicate owners for one channel", () => {
    registerSubagentCompletionOwner(createOwner("anychat-boon-web"));

    expect(() => registerSubagentCompletionOwner(createOwner("ANYCHAT-BOON-WEB"))).toThrow(
      "Subagent completion owner already registered",
    );
  });

  it("disposes only the registered owner", () => {
    const owner = createOwner("anychat-boon-web");
    const otherOwner = createOwner("anychat-boon-web");
    const registration = registerSubagentCompletionOwner(owner);

    registration.dispose();

    expect(getSubagentCompletionOwner("anychat-boon-web")).toBeUndefined();
    expect(() => registerSubagentCompletionOwner(otherOwner)).not.toThrow();
  });

  it("returns undefined for an unknown channel", () => {
    expect(getSubagentCompletionOwner("missing-channel")).toBeUndefined();
    expect(getSubagentCompletionOwner(undefined)).toBeUndefined();
  });
});
