import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const sendCrashRecoveryNotice = vi.fn();
vi.mock("./crash-recovery-notice.js", () => ({
  sendCrashRecoveryNotice: (...args: unknown[]) => sendCrashRecoveryNotice(...args),
}));

const { recoverPendingFollowupReplays } = await import("./followup-replay-recovery.js");
const { enqueueFollowupReplay, loadPendingFollowupReplays, failFollowupReplay } =
  await import("./followup-delivery-queue-storage.js");

describe("recoverPendingFollowupReplays", () => {
  let tmpDir: string;
  const cfg = {} as OpenClawConfig;
  const log = { info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "followup-recovery-"));
    sendCrashRecoveryNotice.mockReset();
    log.info.mockReset();
    log.warn.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns zero counts when nothing is pending", async () => {
    const result = await recoverPendingFollowupReplays({ cfg, log, stateDir: tmpDir });
    expect(result).toEqual({ notified: 0, retained: 0 });
    expect(sendCrashRecoveryNotice).not.toHaveBeenCalled();
  });

  it("notifies and deletes the record on a successful send", async () => {
    enqueueFollowupReplay({ queueKey: "k1", prompt: "hi", channel: "telegram", to: "123" }, tmpDir);
    sendCrashRecoveryNotice.mockResolvedValueOnce(true);
    const result = await recoverPendingFollowupReplays({ cfg, log, stateDir: tmpDir });
    expect(result).toEqual({ notified: 1, retained: 0 });
    expect(await loadPendingFollowupReplays(tmpDir)).toHaveLength(0);
  });

  it("retains the record with an incremented retry count when the notice fails", async () => {
    enqueueFollowupReplay({ queueKey: "k1", prompt: "hi", channel: "telegram", to: "123" }, tmpDir);
    sendCrashRecoveryNotice.mockResolvedValueOnce(false);
    const result = await recoverPendingFollowupReplays({ cfg, log, stateDir: tmpDir });
    expect(result).toEqual({ notified: 0, retained: 1 });
    const pending = await loadPendingFollowupReplays(tmpDir);
    expect(pending[0]).toMatchObject({ retryCount: 1 });
  });

  it("gives up and deletes the record once retries are exhausted", async () => {
    const id = enqueueFollowupReplay(
      { queueKey: "k1", prompt: "hi", channel: "telegram", to: "123" },
      tmpDir,
    );
    for (let i = 0; i < 5; i += 1) {
      await failFollowupReplay(id, "prior failure", tmpDir);
    }
    const result = await recoverPendingFollowupReplays({ cfg, log, stateDir: tmpDir });
    expect(result).toEqual({ notified: 0, retained: 0 });
    expect(sendCrashRecoveryNotice).not.toHaveBeenCalled();
    expect(await loadPendingFollowupReplays(tmpDir)).toHaveLength(0);
  });
});
