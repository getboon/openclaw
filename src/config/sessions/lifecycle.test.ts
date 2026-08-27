// Terminal-main-session-transcript-vs-registry checks gate whether a stale-looking
// registry entry is still safe to reuse. See resolveTerminalMainSessionTranscriptRegistryCheck.
import { describe, expect, it } from "vitest";
import { resolveTerminalMainSessionTranscriptRegistryCheck } from "./lifecycle.js";
import type { SessionEntry } from "./types.js";

function buildEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "11111111-1111-1111-1111-111111111111",
    sessionFile: "/tmp/does-not-matter.jsonl",
    status: "done",
    updatedAt: 1_000,
    ...overrides,
  } as SessionEntry;
}

const baseParams = {
  sessionKey: "agent:main:main",
  agentId: "main",
} as const;

describe("resolveTerminalMainSessionTranscriptRegistryCheck", () => {
  it("returns a check for a terminal 'done' entry with a registry timestamp", () => {
    const check = resolveTerminalMainSessionTranscriptRegistryCheck({
      ...baseParams,
      entry: buildEntry({ status: "done", updatedAt: 1_000 }),
    });
    expect(check).toEqual({
      sessionId: "11111111-1111-1111-1111-111111111111",
      registryTimestampMs: 1_000,
    });
  });

  it("exempts a 'failed' entry so it stays reusable for retry/recovery", () => {
    const check = resolveTerminalMainSessionTranscriptRegistryCheck({
      ...baseParams,
      entry: buildEntry({ status: "failed", updatedAt: 1_000 }),
    });
    expect(check).toBeUndefined();
  });

  it("exempts an entry whose last run was aborted (e.g. a concurrent-turn lock conflict or a gateway-restart interruption), so it stays reusable instead of forcing a fresh session that silently drops history", () => {
    const check = resolveTerminalMainSessionTranscriptRegistryCheck({
      ...baseParams,
      entry: buildEntry({ status: "done", updatedAt: 1_000, abortedLastRun: true }),
    });
    expect(check).toBeUndefined();
  });

  it("still returns a check for a cleanly 'done' entry with abortedLastRun explicitly false", () => {
    const check = resolveTerminalMainSessionTranscriptRegistryCheck({
      ...baseParams,
      entry: buildEntry({ status: "done", updatedAt: 1_000, abortedLastRun: false }),
    });
    expect(check).toEqual({
      sessionId: "11111111-1111-1111-1111-111111111111",
      registryTimestampMs: 1_000,
    });
  });
});
