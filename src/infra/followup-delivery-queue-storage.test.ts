import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteFollowupReplay,
  deleteFollowupReplaysForQueueKey,
  enqueueFollowupReplay,
  failFollowupReplay,
  loadPendingFollowupReplays,
} from "./followup-delivery-queue-storage.js";

describe("followup-delivery-queue-storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "followup-queue-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists an entry and returns its durable id", () => {
    const id = enqueueFollowupReplay(
      { queueKey: "session:agent-1", prompt: "hello", channel: "telegram", to: "123" },
      tmpDir,
    );
    expect(typeof id).toBe("string");
  });

  it("round-trips through loadPendingFollowupReplays", async () => {
    enqueueFollowupReplay(
      { queueKey: "session:agent-1", prompt: "hello", channel: "telegram", to: "123" },
      tmpDir,
    );
    const pending = await loadPendingFollowupReplays(tmpDir);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      queueKey: "session:agent-1",
      prompt: "hello",
      channel: "telegram",
      to: "123",
      retryCount: 0,
    });
  });

  it("deletes a single entry by id", async () => {
    const id = enqueueFollowupReplay({ queueKey: "k1", prompt: "p1" }, tmpDir);
    await deleteFollowupReplay(id, tmpDir);
    expect(await loadPendingFollowupReplays(tmpDir)).toHaveLength(0);
  });

  it("deletes only entries matching a queue key", async () => {
    enqueueFollowupReplay({ queueKey: "k1", prompt: "p1" }, tmpDir);
    enqueueFollowupReplay({ queueKey: "k1", prompt: "p2" }, tmpDir);
    enqueueFollowupReplay({ queueKey: "k2", prompt: "p3" }, tmpDir);
    await deleteFollowupReplaysForQueueKey("k1", tmpDir);
    const remaining = await loadPendingFollowupReplays(tmpDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.queueKey).toBe("k2");
  });

  it("increments retryCount on failFollowupReplay", async () => {
    const id = enqueueFollowupReplay({ queueKey: "k1", prompt: "p1" }, tmpDir);
    await failFollowupReplay(id, "send failed", tmpDir);
    const pending = await loadPendingFollowupReplays(tmpDir);
    expect(pending[0]).toMatchObject({ retryCount: 1, lastError: "send failed" });
  });
});
