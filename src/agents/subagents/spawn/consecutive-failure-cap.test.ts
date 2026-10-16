import { describe, expect, test } from "vitest";
import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";
import {
  evaluateConsecutiveFailureCap,
  getConsecutiveFailureStreakResetAt,
  markConsecutiveFailureStreakReset,
  shouldBlockSpawn,
  trailingFailureStreak,
} from "./consecutive-failure-cap.js";

const rec = (
  status: string,
  createdAt: number,
  extra: Partial<Pick<SubagentRunRecord, "collect" | "swarmRunId">> = {},
): SubagentRunRecord =>
  ({ createdAt, execution: { outcome: { status } }, ...extra }) as unknown as SubagentRunRecord;

const r = (status: string): SubagentRunRecord =>
  ({ execution: { outcome: { status } } }) as unknown as SubagentRunRecord;
const named = (taskName: string, status: string): SubagentRunRecord =>
  ({ taskName, execution: { outcome: { status } } }) as unknown as SubagentRunRecord;
const noOutcome = (): SubagentRunRecord => ({ execution: {} }) as unknown as SubagentRunRecord;

describe("trailingFailureStreak", () => {
  test("counts trailing consecutive failures, stopping at a success", () => {
    expect(trailingFailureStreak([r("ok"), r("timeout"), r("error")])).toBe(2);
  });

  test("a trailing success means streak zero", () => {
    expect(trailingFailureStreak([r("timeout"), r("ok")])).toBe(0);
  });

  test("unknown counts as a failure", () => {
    expect(trailingFailureStreak([r("unknown"), r("timeout")])).toBe(2);
  });

  test("a success in the middle breaks the streak", () => {
    expect(trailingFailureStreak([r("timeout"), r("ok"), r("timeout")])).toBe(1);
  });

  test("empty list is zero", () => {
    expect(trailingFailureStreak([])).toBe(0);
  });

  test("a run without a terminal outcome does not extend the streak (in-flight safety)", () => {
    expect(trailingFailureStreak([r("timeout"), noOutcome()])).toBe(0);
  });
});

describe("shouldBlockSpawn", () => {
  test("cap unset never blocks", () => {
    expect(shouldBlockSpawn(99, undefined)).toBe(false);
  });

  test("cap of zero never blocks (disabled)", () => {
    expect(shouldBlockSpawn(99, 0)).toBe(false);
  });

  test("blocks at or above the cap", () => {
    expect(shouldBlockSpawn(3, 3)).toBe(true);
    expect(shouldBlockSpawn(4, 3)).toBe(true);
  });

  test("does not block below the cap", () => {
    expect(shouldBlockSpawn(2, 3)).toBe(false);
  });
});

describe("evaluateConsecutiveFailureCap", () => {
  test("returns null when under the cap", () => {
    expect(evaluateConsecutiveFailureCap({ runs: [r("timeout"), r("ok")], cap: 3 })).toBeNull();
  });

  test("returns null when cap is unset", () => {
    expect(
      evaluateConsecutiveFailureCap({
        runs: [r("timeout"), r("timeout"), r("timeout")],
        cap: undefined,
      }),
    ).toBeNull();
  });

  test("returns a user-facing message naming the attempts when blocked", () => {
    const msg = evaluateConsecutiveFailureCap({
      runs: [named("pass3", "timeout"), named("pass3_retry", "error")],
      cap: 2,
    });
    expect(msg).not.toBeNull();
    expect(msg!).toContain("pass3");
    expect(msg!).toContain("timeout");
    expect(msg!).toContain("pass3_retry");
    expect(msg!).toContain("error");
    // Must instruct the agent to check in with the user rather than retry.
    expect(msg!.toLowerCase()).toMatch(/ask the user|check in with the user/);
    expect(msg!.toLowerCase()).toMatch(/do not .*(spawn|retry)|stop/);
  });

  test("counts in creation order, not registry iteration order", () => {
    // Chronological: ok@1, timeout@2, timeout@3 → trailing streak 2.
    const runs = [rec("timeout", 3), rec("ok", 1), rec("timeout", 2)];
    expect(evaluateConsecutiveFailureCap({ runs, cap: 2 })).not.toBeNull();
  });

  test("ignores collector and swarm runs (independent parallel children)", () => {
    const runs = [
      rec("timeout", 1),
      rec("timeout", 2, { collect: true }),
      rec("timeout", 3, { swarmRunId: "swarm-1" }),
    ];
    expect(evaluateConsecutiveFailureCap({ runs, cap: 2 })).toBeNull();
  });

  test("only counts failures since the last user-originated spawn", () => {
    const runs = [rec("timeout", 1_000), rec("timeout", 2_000)];
    expect(evaluateConsecutiveFailureCap({ runs, cap: 2, sinceMs: 1_500 })).toBeNull();
    expect(evaluateConsecutiveFailureCap({ runs, cap: 2, sinceMs: 500 })).not.toBeNull();
  });

  test("lists at most the 5 most recent attempts in the message", () => {
    const runs = Array.from({ length: 7 }, (_, i) => named(`r${i}`, "timeout"));
    const msg = evaluateConsecutiveFailureCap({ runs, cap: 3 })!;
    expect(msg).toContain("r6");
    expect(msg).not.toContain("r1");
  });
});

describe("consecutive-failure streak reset marker", () => {
  test("records the reset time per parent session", () => {
    markConsecutiveFailureStreakReset("agent:main:a", 1_234);
    expect(getConsecutiveFailureStreakResetAt("agent:main:a")).toBe(1_234);
    expect(getConsecutiveFailureStreakResetAt("agent:main:other")).toBeUndefined();
  });
});
