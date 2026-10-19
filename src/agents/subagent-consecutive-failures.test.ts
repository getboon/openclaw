import { describe, expect, test } from "vitest";
import {
  evaluateConsecutiveFailureCap,
  getConsecutiveFailureStreakResetAt,
  markConsecutiveFailureStreakReset,
} from "./subagent-consecutive-failures.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const rec = (status: string | undefined, createdAt: number, taskName?: string): SubagentRunRecord =>
  ({
    createdAt,
    ...(status === undefined ? {} : { outcome: { status } }),
    ...(taskName ? { taskName } : {}),
  }) as unknown as SubagentRunRecord;

// Runs in creation order: statuses[i] is created at time i + 1.
const chain = (...statuses: (string | undefined)[]) => statuses.map((s, i) => rec(s, i + 1));

const blocks = (runs: SubagentRunRecord[], cap: number | undefined, sinceMs?: number) =>
  evaluateConsecutiveFailureCap({ runs, cap, sinceMs }) !== null;

describe("evaluateConsecutiveFailureCap — streak", () => {
  test("counts trailing consecutive failures, stopping at a success", () => {
    expect(blocks(chain("ok", "timeout", "error"), 2)).toBe(true);
    expect(blocks(chain("ok", "timeout", "error"), 3)).toBe(false);
  });

  test("a trailing success means no streak", () => {
    expect(blocks(chain("timeout", "ok"), 1)).toBe(false);
  });

  test("unknown counts as a failure", () => {
    expect(blocks(chain("unknown", "timeout"), 2)).toBe(true);
  });

  test("a success in the middle breaks the streak", () => {
    expect(blocks(chain("timeout", "ok", "timeout"), 2)).toBe(false);
  });

  test("no runs never blocks", () => {
    expect(blocks([], 1)).toBe(false);
  });

  test("a run without a terminal outcome does not extend the streak (in-flight safety)", () => {
    expect(blocks(chain("timeout", undefined), 1)).toBe(false);
  });
});

describe("evaluateConsecutiveFailureCap — cap", () => {
  test("cap unset or zero never blocks", () => {
    expect(blocks(chain("timeout", "timeout", "timeout"), undefined)).toBe(false);
    expect(blocks(chain("timeout", "timeout", "timeout"), 0)).toBe(false);
  });

  test("blocks at or above the cap, not below", () => {
    expect(blocks(chain("timeout", "timeout", "timeout"), 3)).toBe(true);
    expect(blocks(chain("timeout", "timeout", "timeout", "timeout"), 3)).toBe(true);
    expect(blocks(chain("timeout", "timeout"), 3)).toBe(false);
  });

  test("returns a user-facing message naming the attempts when blocked", () => {
    const msg = evaluateConsecutiveFailureCap({
      runs: [rec("timeout", 1, "pass3"), rec("error", 2, "pass3_retry")],
      cap: 2,
    });
    expect(msg).not.toBeNull();
    expect(msg!).toContain("pass3");
    expect(msg!).toContain("timeout");
    expect(msg!).toContain("pass3_retry");
    expect(msg!).toContain("error");
    expect(msg!.toLowerCase()).toMatch(/ask the user/);
    expect(msg!.toLowerCase()).toMatch(/do not spawn again/);
  });

  test("counts in creation order, not registry iteration order", () => {
    // Chronological: ok@1, timeout@2, timeout@3 → trailing streak 2.
    expect(blocks([rec("timeout", 3), rec("ok", 1), rec("timeout", 2)], 2)).toBe(true);
  });

  test("only counts failures since the current streak started", () => {
    const runs = [rec("timeout", 1_000), rec("timeout", 2_000)];
    expect(blocks(runs, 2, 1_500)).toBe(false);
    expect(blocks(runs, 2, 500)).toBe(true);
  });

  test("lists the 5 most recent attempts by creation time", () => {
    // Supplied newest-first so the assertion fails if chronological sorting is removed.
    const runs = Array.from({ length: 7 }, (_, i) => rec("timeout", i + 1, `r${i}`)).toReversed();
    const msg = evaluateConsecutiveFailureCap({ runs, cap: 3 })!;
    expect(msg).toContain("r6");
    expect(msg).toContain("r2");
    expect(msg).not.toContain("r1");
    expect(msg).not.toContain("r0");
  });
});

describe("consecutive-failure streak reset marker", () => {
  test("records the reset time per parent session", () => {
    markConsecutiveFailureStreakReset("agent:main:a", 1_234);
    expect(getConsecutiveFailureStreakResetAt("agent:main:a")).toBe(1_234);
    expect(getConsecutiveFailureStreakResetAt("agent:main:other")).toBeUndefined();
  });

  test("resets once per requester turn: later spawns in the same turn keep the start", () => {
    markConsecutiveFailureStreakReset("agent:main:turns", 1_000, "turn-1");
    markConsecutiveFailureStreakReset("agent:main:turns", 5_000, "turn-1");
    expect(getConsecutiveFailureStreakResetAt("agent:main:turns")).toBe(1_000);

    markConsecutiveFailureStreakReset("agent:main:turns", 9_000, "turn-2");
    expect(getConsecutiveFailureStreakResetAt("agent:main:turns")).toBe(9_000);
  });
});
