/**
 * Tests for the terminal-block checkpoint guarantee (ENG-16323): a
 * history-preserving restore point must exist even when no compaction ran.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "openclaw/plugin-sdk/agent-sessions";
import type { AssistantMessage } from "openclaw/plugin-sdk/llm";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { ensureOverflowBlockCheckpoint } from "./overflow-recovery-checkpoint.js";

const tempDirs: string[] = [];
const AGENT_ID = "main";
const SESSION_KEY = "agent:main:main";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function setup(): Promise<{
  config: OpenClawConfig;
  storePath: string;
  sessionFile: string;
  sessionId: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "overflow-block-checkpoint-"));
  tempDirs.push(dir);
  const storePath = path.join(dir, "sessions.json");

  const session = SessionManager.create(dir, dir);
  session.appendMessage({ role: "user", content: "a full day of work", timestamp: Date.now() });
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "working on the skill" }],
    api: "responses",
    provider: "openai",
    model: "gpt-test",
    timestamp: Date.now(),
  } as AssistantMessage);
  const sessionFile = session.getSessionFile();
  const sessionId = session.getSessionId();
  if (!sessionFile || !sessionId) {
    throw new Error("session file/id missing");
  }

  await fs.writeFile(
    storePath,
    JSON.stringify({ [SESSION_KEY]: { sessionId, updatedAt: Date.now() } }, null, 2),
    "utf-8",
  );

  const config = {
    session: { store: storePath },
    agents: { list: [{ id: AGENT_ID, default: true }] },
  } as OpenClawConfig;

  return { config, storePath, sessionFile, sessionId };
}

describe("ensureOverflowBlockCheckpoint", () => {
  it("captures a checkpoint when none exists so branch/restore is reachable", async () => {
    const { config, storePath, sessionFile, sessionId } = await setup();

    const checkpointId = await ensureOverflowBlockCheckpoint({
      config,
      sessionKey: SESSION_KEY,
      sessionId,
      sessionFile,
      agentId: AGENT_ID,
      tokensBefore: 123_456,
    });

    expect(checkpointId).toBeTruthy();
    const store = JSON.parse(await fs.readFile(storePath, "utf-8")) as Record<
      string,
      { compactionCheckpoints?: Array<{ checkpointId: string; reason: string }> }
    >;
    const checkpoints = store[SESSION_KEY]?.compactionCheckpoints ?? [];
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.reason).toBe("overflow-block");
    expect(checkpoints[0]?.checkpointId).toBe(checkpointId);
  });

  it("captures a fresh checkpoint at the current position rather than reusing an older one", async () => {
    const { config, storePath, sessionFile, sessionId } = await setup();

    const first = await ensureOverflowBlockCheckpoint({
      config,
      sessionKey: SESSION_KEY,
      sessionId,
      sessionFile,
      agentId: AGENT_ID,
    });
    const second = await ensureOverflowBlockCheckpoint({
      config,
      sessionKey: SESSION_KEY,
      sessionId,
      sessionFile,
      agentId: AGENT_ID,
    });

    // Each block captures a fresh checkpoint at the then-current transcript
    // position; reusing an older boundary would discard later history.
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    const store = JSON.parse(await fs.readFile(storePath, "utf-8")) as Record<
      string,
      { compactionCheckpoints?: Array<{ checkpointId: string }> }
    >;
    expect(store[SESSION_KEY]?.compactionCheckpoints ?? []).toHaveLength(2);
  });

  it("returns undefined when required inputs are missing", async () => {
    const { config, sessionId } = await setup();
    const result = await ensureOverflowBlockCheckpoint({
      config,
      sessionKey: SESSION_KEY,
      sessionId,
      sessionFile: undefined,
      agentId: AGENT_ID,
    });
    expect(result).toBeUndefined();
  });
});
