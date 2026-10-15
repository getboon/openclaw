import { describe, expect, test } from "vitest";
import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";
import { buildPriorAttemptsNote } from "./prior-attempts-note.js";

// Minimal record builder: outcome is nested under `execution` on the real type.
const run = (taskName: string | undefined, status: string): SubagentRunRecord =>
  ({ taskName, execution: { outcome: { status } } }) as unknown as SubagentRunRecord;

describe("buildPriorAttemptsNote", () => {
  test("returns null when not inherited (sandboxed spawn)", () => {
    expect(buildPriorAttemptsNote([run("pass3", "timeout")], { inherited: false })).toBeNull();
  });

  test("returns null when there are no prior runs", () => {
    expect(buildPriorAttemptsNote([], { inherited: true })).toBeNull();
  });

  test("lists prior runs with task name and outcome", () => {
    const note = buildPriorAttemptsNote(
      [run("pass3_build", "ok"), run("pass3_build_retry", "timeout")],
      { inherited: true },
    );
    expect(note).toContain("pass3_build");
    expect(note).toContain("ok");
    expect(note).toContain("pass3_build_retry");
    expect(note).toContain("timeout");
  });

  test("caps the listing at the 5 most recent", () => {
    const runs = Array.from({ length: 8 }, (_, i) => run(`r${i}`, "timeout"));
    const note = buildPriorAttemptsNote(runs, { inherited: true, max: 5 })!;
    // Count parenthesized run entries "(timeout)"; the explanatory boilerplate
    // mentions quoted 'timeout' separately, so match the entry form specifically.
    expect(note.match(/\(timeout\)/g)!.length).toBe(5);
    // most-recent kept: r7 present, r0 dropped
    expect(note).toContain("r7");
    expect(note).not.toContain("r0");
  });

  test("labels an unnamed run without crashing", () => {
    const note = buildPriorAttemptsNote([run(undefined, "error")], { inherited: true })!;
    expect(note).toContain("error");
    expect(note).toContain("(unlabeled)");
  });

  test("missing outcome falls back to unknown", () => {
    const bare = { taskName: "x" } as unknown as SubagentRunRecord;
    const note = buildPriorAttemptsNote([bare], { inherited: true })!;
    expect(note).toContain("unknown");
  });
});
