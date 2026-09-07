// Gateway activity probe tests cover unset, set, aborted-entry filtering, and probe errors.
import { describe, expect, it } from "vitest";
import type { ChatAbortControllerEntry } from "./chat-abort.js";
import {
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
