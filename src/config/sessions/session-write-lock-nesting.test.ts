// Pins session write-lock nesting on the real transcript write paths: a transcript writer that
// runs while this process already holds the session lock joins it, while two independent
// lock holders on the same session still serialize.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireSessionWriteLock,
  resetSessionWriteLockStateForTest,
} from "../../agents/session-write-lock.js";
import type { OpenClawConfig } from "../types.openclaw.js";
import { resolveSessionTranscriptPathInDir } from "./paths.js";
import { persistSessionTranscriptTurn, upsertSessionEntry } from "./session-accessor.js";
import { useTempSessionsFixture } from "./test-helpers.js";
import {
  appendSessionTranscriptEvent,
  appendSessionTranscriptMessage,
  runSessionTranscriptAppendTransaction,
} from "./transcript-append.js";

// Short acquire timeout: a nested writer that fails to join the held lock times out quickly
// instead of hanging the suite for the 60s production default. The env override wins over
// config, so the suite clears it (see beforeEach).
const SHORT_LOCK_CONFIG = {
  session: { writeLock: { acquireTimeoutMs: 750 } },
} as unknown as OpenClawConfig;

function readTranscriptLines(sessionFile: string): Array<{ type?: string }> {
  return fs
    .readFileSync(sessionFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string });
}

describe("session write lock nesting on transcript write paths", () => {
  const fixture = useTempSessionsFixture("session-write-lock-nesting-");

  beforeEach(() => {
    vi.stubEnv("OPENCLAW_SESSION_WRITE_LOCK_ACQUIRE_TIMEOUT_MS", "");
  });

  afterEach(() => {
    resetSessionWriteLockStateForTest();
    vi.unstubAllEnvs();
  });

  it("lets a transcript append inside an operation that holds the session lock complete", async () => {
    const sessionFile = resolveSessionTranscriptPathInDir("nested-append", fixture.sessionsDir());
    // Outer holder shaped like compaction / transcript rewrite: plain acquire, no owned context.
    const outer = await acquireSessionWriteLock({ sessionFile, timeoutMs: 500 });
    try {
      await appendSessionTranscriptMessage({
        transcriptPath: sessionFile,
        message: { role: "user", content: [{ type: "text", text: "nested" }] },
        config: SHORT_LOCK_CONFIG,
      });
      await appendSessionTranscriptEvent({
        transcriptPath: sessionFile,
        event: { type: "custom", customType: "nested-event", data: {} },
        config: SHORT_LOCK_CONFIG,
      });
      await runSessionTranscriptAppendTransaction(
        { transcriptPath: sessionFile, config: SHORT_LOCK_CONFIG },
        async ({ appendMessage }) => {
          await appendMessage({
            message: { role: "assistant", content: [{ type: "text", text: "tx" }] },
          });
        },
      );
    } finally {
      await outer.release();
    }
    const types = readTranscriptLines(sessionFile).map((line) => line.type);
    expect(types.filter((type) => type === "message")).toHaveLength(2);
    expect(types).toContain("custom");
    expect(fs.existsSync(`${sessionFile}.lock`)).toBe(false);
  });

  it("lets a session-accessor transcript turn inside a held session lock complete", async () => {
    const scope = {
      agentId: "main",
      sessionId: "nested-turn",
      sessionKey: "agent:main:nested-turn",
      storePath: fixture.storePath(),
    };
    await upsertSessionEntry(scope, { sessionId: scope.sessionId, updatedAt: 10 });
    const sessionFile = resolveSessionTranscriptPathInDir(scope.sessionId, fixture.sessionsDir());
    const outer = await acquireSessionWriteLock({ sessionFile, timeoutMs: 500 });
    let appendedCount: number | undefined;
    try {
      const result = await persistSessionTranscriptTurn(
        { ...scope, sessionFile },
        {
          config: SHORT_LOCK_CONFIG,
          messages: [
            { message: { role: "user", content: "hello", timestamp: 100 } },
            { message: { role: "assistant", content: "hi", timestamp: 200 } },
          ],
          publishWhen: "always",
          updateMode: "file-only",
        },
      );
      appendedCount = result.appendedCount;
    } finally {
      await outer.release();
    }
    expect(appendedCount).toBe(2);
    expect(fs.existsSync(`${sessionFile}.lock`)).toBe(false);
  });

  it("keeps two independent lock holders on one session serialized", async () => {
    const sessionFile = path.join(fixture.sessionsDir(), "independent.jsonl");
    const first = await acquireSessionWriteLock({ sessionFile, timeoutMs: 500 });
    let secondAcquired = false;
    const second = acquireSessionWriteLock({ sessionFile, timeoutMs: 5_000 }).then((lock) => {
      secondAcquired = true;
      return lock;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(secondAcquired).toBe(false);
    await first.release();
    const secondLock = await second;
    expect(secondAcquired).toBe(true);
    await secondLock.release();
  });

  it("times out an independent holder instead of sharing a held session lock", async () => {
    const sessionFile = path.join(fixture.sessionsDir(), "independent-timeout.jsonl");
    const first = await acquireSessionWriteLock({ sessionFile, timeoutMs: 500 });
    try {
      await expect(acquireSessionWriteLock({ sessionFile, timeoutMs: 50 })).rejects.toThrow(
        /session file locked/,
      );
    } finally {
      await first.release();
    }
  });
});
