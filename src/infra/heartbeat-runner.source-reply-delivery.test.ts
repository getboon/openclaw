// Covers delivery of staged message-tool source replies from heartbeat turns.
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markReplyPayloadForSourceSuppressionDelivery,
  setReplyPayloadMetadata,
} from "../auto-reply/reply-payload.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { sendDurableMessageBatch } from "../channels/message/runtime.js";
import type {
  ChannelHeartbeatAdapter,
  ChannelOutboundAdapter,
} from "../channels/plugins/types.public.js";
import type { OpenClawConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { getLastHeartbeatEvent, resetHeartbeatEventsForTest } from "./heartbeat-events.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  type HeartbeatReplySpy,
  seedSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, peekSystemEvents, resetSystemEventsForTest } from "./system-events.js";

vi.mock("../channels/message/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../channels/message/runtime.js")>();
  return { ...actual, sendDurableMessageBatch: vi.fn(actual.sendDurableMessageBatch) };
});

const MAIN_KEY = "agent:main:main";
const DM_KEY = "agent:main:msteams:direct:29:peer-1";
const DM_TO = "user:29:peer-1";
const DONE = "Exec completed (abcd1234, code 0) :: live smoke done";

type SendText = NonNullable<ChannelOutboundAdapter["sendText"]>;
type ReplyResult = ReplyPayload | ReplyPayload[];

function staged(text: string, sessionKey: string): ReplyPayload {
  const payload = markReplyPayloadForSourceSuppressionDelivery<ReplyPayload>({ text });
  return setReplyPayloadMetadata(payload, {
    sourceReplyTranscriptMirror: { sessionKey, text },
  });
}

function installMsteams(heartbeat?: ChannelHeartbeatAdapter) {
  const sendText = vi.fn<SendText>(async () => ({ channel: "msteams", messageId: "m1" }));
  setActivePluginRegistry(
    createTestRegistry([
      {
        pluginId: "msteams",
        plugin: {
          ...createOutboundTestPlugin({
            id: "msteams",
            outbound: { deliveryMode: "direct", sendText },
          }),
          ...(heartbeat ? { heartbeat } : {}),
        },
        source: "test",
      },
    ]),
  );
  return sendText;
}

function sentTexts(sendText: ReturnType<typeof installMsteams>) {
  return sendText.mock.calls.map(([params]) => params.text);
}

function buildConfig(
  tmpDir: string,
  storePath: string,
  overrides: { heartbeat?: Record<string, unknown>; channels?: Record<string, unknown> } = {},
): OpenClawConfig {
  return {
    agents: {
      defaults: { workspace: tmpDir, heartbeat: { every: "1h", ...overrides.heartbeat } },
    },
    session: { store: storePath, dmScope: "per-channel-peer" },
    ...(overrides.channels ? { channels: overrides.channels } : {}),
  } as OpenClawConfig;
}

async function seedSession(storePath: string, sessionKey: string, extra: object = {}) {
  await seedSessionStore(storePath, sessionKey, {
    lastChannel: "msteams",
    lastProvider: "msteams",
    lastTo: DM_TO,
    ...extra,
  });
}

// The reply mock stages against the run's own session key, as the embedded runner does.
function replyWith(replySpy: HeartbeatReplySpy, build: (sessionKey: string) => ReplyResult) {
  replySpy.mockImplementation(async (ctx) => build(ctx.SessionKey ?? ""));
}

function enqueueCompletion(sessionKey = DM_KEY) {
  enqueueSystemEvent(DONE, {
    sessionKey,
    deliveryContext: { channel: "msteams", to: DM_TO },
  });
}

function runCompletion(cfg: OpenClawConfig, replySpy: HeartbeatReplySpy, nowMs?: number) {
  return runHeartbeatOnce({
    cfg,
    agentId: "main",
    sessionKey: DM_KEY,
    source: "exec-event",
    intent: "event",
    reason: "exec-event",
    deps: { getReplyFromConfig: replySpy, ...(nowMs ? { nowMs: () => nowMs } : {}) },
  });
}

describe("runHeartbeatOnce staged source reply delivery", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
    resetHeartbeatEventsForTest();
    vi.mocked(sendDurableMessageBatch).mockClear();
  });

  afterEach(() => {
    resetSystemEventsForTest();
    resetHeartbeatEventsForTest();
  });

  it("sends a staged reply before the final reply in a chat completion turn", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      const result = await runCompletion(cfg, replySpy);

      expect(result.status).toBe("ran");
      expect(sentTexts(sendText)).toEqual(["live smoke done", "Done."]);
      for (const [params] of sendText.mock.calls) {
        expect(params.to).toBe(DM_TO);
      }
      expect(peekSystemEvents(DM_KEY)).toEqual([]);
    });
  });

  it("sends the staged reply without a literal HEARTBEAT_OK for a token-only final", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "HEARTBEAT_OK" }]);

      const result = await runCompletion(cfg, replySpy);

      expect(result.status).toBe("ran");
      expect(sentTexts(sendText)).toEqual(["live smoke done"]);
      expect(getLastHeartbeatEvent()?.status).toBe("ok-token");
      expect(peekSystemEvents(DM_KEY)).toEqual([]);
    });
  });

  it("clears the owned pending final delivery after a staged-only send", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      const now = Date.now();
      await seedSession(storePath, DM_KEY, {
        updatedAt: now,
        pendingFinalDelivery: true,
        pendingFinalDeliveryText: "HEARTBEAT_OK",
        pendingFinalDeliveryCreatedAt: now,
      });
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "HEARTBEAT_OK" }]);

      await runCompletion(cfg, replySpy, now);

      const store = JSON.parse(await fs.readFile(storePath, "utf-8"));
      expect(store[DM_KEY]?.pendingFinalDelivery).toBeUndefined();
      expect(store[DM_KEY]?.pendingFinalDeliveryText).toBeUndefined();
    });
  });

  it("sends a staged-only reply exactly once", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key)]);

      await runCompletion(cfg, replySpy);

      expect(sentTexts(sendText)).toEqual(["live smoke done"]);
    });
  });

  it("still sends the staged reply when the final reply is a duplicate", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);

      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("first output", key), { text: "Done." }]);
      await runCompletion(cfg, replySpy);

      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("second output", key), { text: "Done." }]);
      await runCompletion(cfg, replySpy);

      expect(sentTexts(sendText)).toEqual(["first output", "Done.", "second output"]);
      expect(getLastHeartbeatEvent()).toMatchObject({ status: "skipped", reason: "duplicate" });
    });
  });

  it("sends a repeated staged-only reply that is the main payload", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      replyWith(replySpy, (key) => [staged("same output", key)]);

      enqueueCompletion();
      await runCompletion(cfg, replySpy);
      enqueueCompletion();
      await runCompletion(cfg, replySpy);

      expect(sentTexts(sendText)).toEqual(["same output", "same output"]);
    });
  });

  it("does not send a staged reply for another session", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, () => [staged("elsewhere", MAIN_KEY), { text: "Done." }]);

      await runCompletion(cfg, replySpy);

      expect(sentTexts(sendText)).toEqual(["Done."]);
    });
  });

  it("does not send a staged reply without a delivery target", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath, { heartbeat: { target: "none" } });
      await seedSession(storePath, DM_KEY);
      enqueueSystemEvent(DONE, { sessionKey: DM_KEY });
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      await runCompletion(cfg, replySpy);

      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it("does not send a staged reply when channel alerts are hidden", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath, {
        channels: { msteams: { heartbeat: { showAlerts: false } } },
      });
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      await runCompletion(cfg, replySpy);

      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it("does not send a staged reply from an isolated heartbeat run", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath, {
        heartbeat: { isolatedSession: true, target: "last" },
      });
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      await runCompletion(cfg, replySpy);

      expect(replySpy.mock.calls[0]?.[0]?.SessionKey).not.toBe(DM_KEY);
      expect(sentTexts(sendText)).toEqual(["Done."]);
    });
  });

  it("does not send a staged reply from a scheduled heartbeat in the heartbeat session", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath, { heartbeat: { target: "last" } });
      await seedSession(storePath, MAIN_KEY);
      replyWith(replySpy, (key) => [staged("staged status", key), { text: "Status update." }]);

      await runHeartbeatOnce({ cfg, agentId: "main", deps: { getReplyFromConfig: replySpy } });

      expect(replySpy.mock.calls[0]?.[0]?.SessionKey).toBe(MAIN_KEY);
      expect(sentTexts(sendText)).toEqual(["Status update."]);
    });
  });

  it("sends a scheduled heartbeat without staged replies as before", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath, { heartbeat: { target: "last" } });
      await seedSession(storePath, MAIN_KEY);
      replySpy.mockResolvedValue({ text: "Status update." });

      await runHeartbeatOnce({ cfg, agentId: "main", deps: { getReplyFromConfig: replySpy } });

      expect(sentTexts(sendText)).toEqual(["Status update."]);
      expect(sendDurableMessageBatch).toHaveBeenCalledTimes(1);
    });
  });

  it("sends staged replies without a transcript mirror", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      await runCompletion(cfg, replySpy);

      const stagedCall = vi.mocked(sendDurableMessageBatch).mock.calls[0]?.[0];
      expect(stagedCall?.payloads).toEqual([{ text: "live smoke done", mediaUrls: [] }]);
      expect(stagedCall).not.toHaveProperty("mirror");
    });
  });

  it("does not send a staged reply when the channel is not ready", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams({
        checkReady: async () => ({ ok: false, reason: "not-linked" }),
      });
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);

      const result = await runCompletion(cfg, replySpy);

      expect(result).toEqual({ status: "skipped", reason: "not-linked" });
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it("keeps the main reply unchanged when the staged send is suppressed", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "HEARTBEAT_OK" }]);
      vi.mocked(sendDurableMessageBatch).mockResolvedValueOnce({
        status: "suppressed",
      } as unknown as Awaited<ReturnType<typeof sendDurableMessageBatch>>);

      const result = await runCompletion(cfg, replySpy);

      expect(result.status).toBe("ran");
      expect(sentTexts(sendText)).toEqual(["HEARTBEAT_OK"]);
    });
  });

  it("fails the run and keeps events queued when the staged send fails", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const sendText = installMsteams();
      const cfg = buildConfig(tmpDir, storePath);
      await seedSession(storePath, DM_KEY);
      enqueueCompletion();
      replyWith(replySpy, (key) => [staged("live smoke done", key), { text: "Done." }]);
      vi.mocked(sendDurableMessageBatch).mockResolvedValueOnce({
        status: "failed",
        error: new Error("channel down"),
      } as unknown as Awaited<ReturnType<typeof sendDurableMessageBatch>>);

      const result = await runCompletion(cfg, replySpy);

      expect(result).toEqual({ status: "failed", reason: "channel down" });
      expect(sendText).not.toHaveBeenCalled();
      expect(peekSystemEvents(DM_KEY)).toEqual([DONE]);
    });
  });
});
