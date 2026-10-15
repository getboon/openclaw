import { describe, expect, test } from "vitest";
import type { SubagentRunRecord } from "../registry/subagent-registry.types";
import { shouldBlockSpawn, trailingFailureStreak } from "./consecutive-failure-cap";

const r = (status: string): SubagentRunRecord =>
  ({ execution: { outcome: { status } } }) as unknown as SubagentRunRecord;
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
