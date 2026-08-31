import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPendingFollowupReplays } from "../../../infra/followup-delivery-queue-storage.js";
import { closeOpenClawStateDatabase } from "../../../state/openclaw-state-db.js";
import { createQueueTestRun } from "../queue.test-helpers.js";
import { scheduleFollowupDrain } from "./drain.js";
import { enqueueFollowupRun } from "./enqueue.js";
import { FOLLOWUP_QUEUES } from "./state.js";
import type { QueueSettings } from "./types.js";

// Each test gets its own OPENCLAW_STATE_DIR so the production write path
// (enqueueFollowupRun -> enqueueFollowupReplay, which passes no explicit
// stateDir) and the reads below share one fresh, isolated SQLite state DB.
describe("followup replay persistence wiring", () => {
  const key = "test-queue-key";
  const settings: QueueSettings = { mode: "followup" };
  let tmpDir: string;
  let prevStateDir: string | undefined;
  let prevTestFast: string | undefined;

  beforeEach(() => {
    FOLLOWUP_QUEUES.clear();
    tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "followup-persist-"));
    prevStateDir = process.env.OPENCLAW_STATE_DIR;
    prevTestFast = process.env.OPENCLAW_TEST_FAST;
    process.env.OPENCLAW_STATE_DIR = tmpDir;
    // Skip the 500ms queue debounce so the drain completes deterministically.
    process.env.OPENCLAW_TEST_FAST = "1";
  });

  afterEach(() => {
    FOLLOWUP_QUEUES.clear();
    closeOpenClawStateDatabase();
    if (prevStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = prevStateDir;
    }
    if (prevTestFast === undefined) {
      delete process.env.OPENCLAW_TEST_FAST;
    } else {
      process.env.OPENCLAW_TEST_FAST = prevTestFast;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists a record when a run is successfully enqueued", async () => {
    const run = createQueueTestRun({
      prompt: "hello",
      messageId: "m1",
      originatingChannel: "telegram",
      originatingTo: "123",
    });
    const ok = enqueueFollowupRun(key, run, settings, "message-id", undefined, false);
    expect(ok).toBe(true);
    const pending = await loadPendingFollowupReplays();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ queueKey: key, messageId: "m1", prompt: "hello" });
  });

  it("clears all persisted records for a queue key once the drain goes idle", async () => {
    const run = createQueueTestRun({ prompt: "hello", messageId: "m2" });
    enqueueFollowupRun(key, run, settings, "message-id", undefined, false);
    expect(await loadPendingFollowupReplays()).toHaveLength(1);

    await new Promise<void>((resolve) => {
      scheduleFollowupDrain(key, async () => {
        resolve();
      });
    });

    // The drain's cleanup (map delete + persisted-record delete) runs in the
    // finally block of a fire-and-forget IIFE after the run callback resolves,
    // so poll until the record is gone rather than assuming a fixed delay.
    await expect
      .poll(async () => (await loadPendingFollowupReplays()).length, { timeout: 2000 })
      .toBe(0);
  });
});
