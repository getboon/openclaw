// Gateway activity probe tests cover unset, set, aborted-entry filtering, and probe errors.
import { describe, expect, it } from "vitest";
import type { ChatAbortControllerEntry } from "./chat-abort.js";
import {
  clearGatewayActiveRunCountProbe,
  countUnabortedRuns,
  getGatewayActiveRunCount,
  setGatewayActiveRunCountProbe,
} from "./gateway-activity.js";

function entry(aborted: boolean): ChatAbortControllerEntry {
  const controller = new AbortController();
  if (aborted) {
    controller.abort();
  }
  return {
    controller,
    sessionId: "s",
    sessionKey: "k",
    startedAtMs: 0,
    expiresAtMs: 0,
  };
}

describe("gateway activity probe", () => {
  it("a stale runtime's clear does not drop the probe a newer runtime installed", () => {
    // Runtime lifecycles overlap: the replacement installs its probe before the outgoing
    // one finishes releasing. An unconditional clear on that late release would make every
    // later read report "unknown" while runs were in flight — readers treat unknown as
    // "do not act", so the gateway would look undrainable for the rest of the process.
    const oldProbe = () => 1;
    const newProbe = () => 7;
    setGatewayActiveRunCountProbe(oldProbe);
    setGatewayActiveRunCountProbe(newProbe);

    clearGatewayActiveRunCountProbe(oldProbe);

    expect(getGatewayActiveRunCount()).toBe(7);
    setGatewayActiveRunCountProbe(null);
  });

  it("the owning runtime's clear does remove its own probe", () => {
    const probe = () => 3;
    setGatewayActiveRunCountProbe(probe);
    expect(getGatewayActiveRunCount()).toBe(3);

    clearGatewayActiveRunCountProbe(probe);

    expect(getGatewayActiveRunCount()).toBeNull();
  });
  it("is null until a probe is set", () => {
    setGatewayActiveRunCountProbe(null);
    expect(getGatewayActiveRunCount()).toBeNull();
  });

  it("counts only unaborted runs", () => {
    const runs = new Map<string, ChatAbortControllerEntry>([
      ["a", entry(false)],
      ["b", entry(true)],
      ["c", entry(false)],
    ]);
    expect(countUnabortedRuns(runs)).toBe(2);
    setGatewayActiveRunCountProbe(() => countUnabortedRuns(runs));
    expect(getGatewayActiveRunCount()).toBe(2);
    setGatewayActiveRunCountProbe(null);
  });

  it("returns null instead of throwing when the probe throws", () => {
    setGatewayActiveRunCountProbe(() => {
      throw new Error("boom");
    });
    expect(getGatewayActiveRunCount()).toBeNull();
    setGatewayActiveRunCountProbe(null);
  });

  it("returns null for a probe result that is not a non-negative count", () => {
    setGatewayActiveRunCountProbe(() => Number.NaN);
    expect(getGatewayActiveRunCount()).toBeNull();
    setGatewayActiveRunCountProbe(() => -1);
    expect(getGatewayActiveRunCount()).toBeNull();
    setGatewayActiveRunCountProbe(null);
  });
});
