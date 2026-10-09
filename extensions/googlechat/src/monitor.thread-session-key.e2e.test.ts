// End-to-end integration test that drives the registered webhook event
// processor with realistic Google Chat MESSAGE event payloads. Unlike the
// colocated unit tests, this exercise lets the real bot-loop SDK helper run,
// asserts cross-event session isolation, and verifies the outbound thread
// targeting still routes to the correct thread.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type {
  GoogleChatCoreRuntime,
  GoogleChatRuntimeEnv,
  WebhookTarget,
} from "./monitor-types.js";
import { testing } from "./monitor.js";
import type { GoogleChatEvent } from "./types.js";

const apiMocks = vi.hoisted(() => ({
  downloadGoogleChatMedia: vi.fn(),
  sendGoogleChatMessage: vi.fn().mockResolvedValue({ messageName: "spaces/X/messages/typing" }),
}));
const accessMocks = vi.hoisted(() => ({
  applyGoogleChatInboundAccessPolicy: vi.fn(),
}));

vi.mock("./api.js", () => ({
  downloadGoogleChatMedia: apiMocks.downloadGoogleChatMedia,
  sendGoogleChatMessage: apiMocks.sendGoogleChatMessage,
}));
vi.mock("./monitor-access.js", () => ({
  applyGoogleChatInboundAccessPolicy: accessMocks.applyGoogleChatInboundAccessPolicy,
}));
// NOTE: we deliberately do NOT mock openclaw/plugin-sdk/channel-inbound
// — the real bot-loop SDK helper runs end-to-end.

type CapturedTurn = {
  routeSessionKey: string;
  conversationId: string;
  threadId: string | undefined;
  parentSessionKey: string | undefined;
  outboundThread: string | undefined;
  messageId: string | undefined;
};

// Unique account id per harness call so the process-scoped bot-loop guard
// (keyed by accountId in `resolveGoogleChatBotLoopProtection`) cannot leak
// state across tests. The SDK does not expose its clear helper to plugins.
let harnessSequence = 0;

function buildE2EHarness() {
  harnessSequence += 1;
  const accountId = `e2e-${harnessSequence}-${Date.now()}`;
  const captured: CapturedTurn[] = [];

  const run = vi.fn(
    async (params: {
      raw: unknown;
      adapter: {
        ingest: () => { id: string };
        resolveTurn: () => { routeSessionKey: string; ctxPayload: unknown };
      };
    }) => {
      const ingested = params.adapter.ingest();
      const turn = params.adapter.resolveTurn();
      const ctx = turn.ctxPayload as {
        conversation: { id: string; threadId?: string };
        route: { parentSessionKey?: string };
        reply: { replyToId?: string };
      };
      captured.push({
        routeSessionKey: turn.routeSessionKey,
        conversationId: ctx.conversation.id,
        threadId: ctx.conversation.threadId,
        parentSessionKey: ctx.route.parentSessionKey,
        outboundThread: ctx.reply.replyToId,
        messageId: ingested.id,
      });
    },
  );

  const core = {
    logging: { shouldLogVerbose: () => false },
    channel: {
      routing: {
        resolveAgentRoute: vi.fn((params: { peer: { kind: string; id: string } }) => ({
          agentId: "main",
          channel: "googlechat",
          accountId,
          sessionKey: `agent:main:googlechat:${accountId}:${params.peer.kind}:${params.peer.id}`,
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/e2e-store.json"),
        readSessionUpdatedAt: vi.fn(() => undefined),
        recordInboundSession: vi.fn(),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(({ body }: { body: string }) => body),
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      },
      media: {
        saveMediaBuffer: vi.fn(),
        readRemoteMediaBuffer: vi.fn(),
      },
      text: {
        chunkMarkdownTextWithMode: vi.fn((s: string) => [s]),
        resolveChunkMode: vi.fn(() => "default"),
      },
      inbound: {
        buildContext: vi.fn((payload: unknown) => payload),
        run,
      },
    },
  } as unknown as GoogleChatCoreRuntime;

  const runtime: GoogleChatRuntimeEnv = { error: vi.fn(), log: vi.fn() };
  const account = {
    accountId,
    config: {
      allowBots: false,
      botUser: "users/app",
      typingIndicator: "none",
    },
    credentialSource: "inline",
  } as unknown as ResolvedGoogleChatAccount;
  const target: WebhookTarget = {
    account,
    config: {},
    runtime,
    core,
    path: "/webhook/googlechat",
    mediaMaxMb: 0,
  };

  return { captured, target, run };
}

// Realistic MESSAGE event payload modeled on Google Chat REST docs:
// https://developers.google.com/workspace/chat/api/reference/rest/v1/Event
// and https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
function buildRealisticMessageEvent(opts: {
  spaceId: string;
  spaceDisplayName?: string;
  threadName?: string;
  messageId: string;
  text: string;
  senderName?: string;
  senderDisplayName?: string;
  senderType?: "HUMAN" | "BOT";
  eventTime?: string;
  spaceType?: string;
  spaceThreadingState?: string;
}): GoogleChatEvent {
  return {
    type: "MESSAGE",
    eventTime: opts.eventTime ?? "2026-05-21T10:00:00.000Z",
    space: {
      name: opts.spaceId,
      displayName: opts.spaceDisplayName ?? "Engineering",
      spaceType: opts.spaceType ?? "SPACE",
      spaceThreadingState: opts.spaceThreadingState ?? "THREADED_MESSAGES",
    },
    message: {
      name: `${opts.spaceId}/messages/${opts.messageId}`,
      text: opts.text,
      argumentText: opts.text,
      sender: {
        name: opts.senderName ?? "users/alice",
        displayName: opts.senderDisplayName ?? "Alice",
        type: opts.senderType ?? "HUMAN",
      },
      ...(opts.threadName ? { thread: { name: opts.threadName } } : {}),
    },
  };
}

beforeEach(() => {
  apiMocks.sendGoogleChatMessage.mockClear();
  apiMocks.downloadGoogleChatMedia.mockReset();
  accessMocks.applyGoogleChatInboundAccessPolicy.mockReset();
  accessMocks.applyGoogleChatInboundAccessPolicy.mockResolvedValue({
    ok: true,
    commandAuthorized: undefined,
    effectiveWasMentioned: true,
    groupBotLoopProtection: undefined,
    groupSystemPrompt: undefined,
  });
});

describe("googlechat thread-session-key e2e", () => {
  it("dispatches three messages across two threads into two isolated sessions", async () => {
    const { captured, target } = buildE2EHarness();

    const events: GoogleChatEvent[] = [
      buildRealisticMessageEvent({
        spaceId: "spaces/AAAA-engineering",
        threadName: "spaces/AAAA-engineering/threads/T-deploy",
        messageId: "m1",
        text: "@OpenClaw can you check the deploy status?",
        eventTime: "2026-05-21T10:00:00.000Z",
      }),
      buildRealisticMessageEvent({
        spaceId: "spaces/AAAA-engineering",
        threadName: "spaces/AAAA-engineering/threads/T-incident",
        messageId: "m2",
        text: "@OpenClaw summarize the incident timeline",
        senderName: "users/bob",
        senderDisplayName: "Bob",
        eventTime: "2026-05-21T10:01:00.000Z",
      }),
      buildRealisticMessageEvent({
        spaceId: "spaces/AAAA-engineering",
        threadName: "spaces/AAAA-engineering/threads/T-deploy",
        messageId: "m3",
        text: "and what about the canary?",
        eventTime: "2026-05-21T10:02:00.000Z",
      }),
    ];

    for (const event of events) {
      await testing.processGoogleChatEvent(event, target);
    }

    expect(captured).toHaveLength(3);

    // m1 and m3 (same thread T-deploy) share one session.
    expect(captured[0].routeSessionKey).toBe(captured[2].routeSessionKey);
    // m2 (different thread T-incident) is isolated.
    expect(captured[1].routeSessionKey).not.toBe(captured[0].routeSessionKey);

    // All three carry the parent (space-level) session for first-turn continuity.
    const expectedParent = `agent:main:googlechat:${target.account.accountId}:group:spaces/AAAA-engineering`;
    expect(captured.every((c) => c.parentSessionKey === expectedParent)).toBe(true);

    // Outbound thread targeting still uses the inbound thread name (unchanged).
    expect(captured[0].outboundThread).toBe("spaces/AAAA-engineering/threads/T-deploy");
    expect(captured[1].outboundThread).toBe("spaces/AAAA-engineering/threads/T-incident");
    expect(captured[2].outboundThread).toBe("spaces/AAAA-engineering/threads/T-deploy");

    // conversation.id remains the native space id; conversation.threadId carries the thread.
    expect(captured.every((c) => c.conversationId === "spaces/AAAA-engineering")).toBe(true);
    expect(captured[0].threadId).toBe("spaces/AAAA-engineering/threads/T-deploy");
    expect(captured[1].threadId).toBe("spaces/AAAA-engineering/threads/T-incident");
  });

  it("collapses to one space-scoped session across all messages in a DIRECT_MESSAGE space", async () => {
    const { captured, target } = buildE2EHarness();

    // Google Chat DM payload — modern shape, no deprecated `type` field.
    const events: GoogleChatEvent[] = [
      buildRealisticMessageEvent({
        spaceId: "spaces/BBBB-dm",
        threadName: "spaces/BBBB-dm/threads/T-1",
        messageId: "m1",
        text: "hi",
        spaceType: "DIRECT_MESSAGE",
        spaceThreadingState: "UNTHREADED_MESSAGES",
      }),
      buildRealisticMessageEvent({
        spaceId: "spaces/BBBB-dm",
        threadName: "spaces/BBBB-dm/threads/T-2",
        messageId: "m2",
        text: "follow-up",
        spaceType: "DIRECT_MESSAGE",
        spaceThreadingState: "UNTHREADED_MESSAGES",
      }),
    ];

    for (const event of events) {
      await testing.processGoogleChatEvent(event, target);
    }

    expect(captured).toHaveLength(2);
    expect(captured[0].routeSessionKey).toBe(captured[1].routeSessionKey);
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
    expect(captured.every((c) => c.threadId === undefined)).toBe(true);
    expect(captured.every((c) => c.parentSessionKey === undefined)).toBe(true);
  });

  it("ignores non-MESSAGE events (e.g. ADDED_TO_SPACE) without dispatching a turn", async () => {
    const { captured, target } = buildE2EHarness();
    await testing.processGoogleChatEvent(
      {
        type: "ADDED_TO_SPACE",
        eventTime: "2026-05-21T09:00:00.000Z",
        space: {
          name: "spaces/CCCC",
          spaceType: "SPACE",
          spaceThreadingState: "THREADED_MESSAGES",
        },
      },
      target,
    );
    expect(captured).toHaveLength(0);
  });

  it("exercises the real bot-loop SDK: suppresses a tight bot-to-bot ping-pong within one space", async () => {
    const { captured, target } = buildE2EHarness();
    // Allow bot senders so bot-loop protection actually engages.
    target.account.config.allowBots = true;
    target.account.config.botUser = "users/openclaw-app";
    target.account.config.botLoopProtection = {
      maxEventsPerWindow: 1,
      windowSeconds: 60,
      cooldownSeconds: 60,
    };

    const baseEvent = (messageId: string, eventTime: string): GoogleChatEvent =>
      buildRealisticMessageEvent({
        spaceId: "spaces/DDDD-noisy-bot",
        threadName: "spaces/DDDD-noisy-bot/threads/T-A",
        messageId,
        text: "PING",
        senderName: "users/other-bot",
        senderDisplayName: "Other Bot",
        senderType: "BOT",
        eventTime,
      });

    // First bot message: passes the guard, turn dispatched.
    await testing.processGoogleChatEvent(baseEvent("m1", "2026-05-21T10:00:00.000Z"), target);
    // Second bot message in the same space within the window: real guard
    // should suppress and the turn must NOT be dispatched.
    await testing.processGoogleChatEvent(baseEvent("m2", "2026-05-21T10:00:01.000Z"), target);

    expect(captured).toHaveLength(1);
    expect(captured[0].messageId).toBe("spaces/DDDD-noisy-bot/messages/m1");
  });

  it("real bot-loop SDK does NOT cross-suppress across different spaces (regression for scope isolation)", async () => {
    const { captured, target } = buildE2EHarness();
    target.account.config.allowBots = true;
    target.account.config.botUser = "users/openclaw-app";
    target.account.config.botLoopProtection = {
      maxEventsPerWindow: 1,
      windowSeconds: 60,
      cooldownSeconds: 60,
    };

    const inSpace = (spaceId: string, messageId: string, eventTime: string): GoogleChatEvent =>
      buildRealisticMessageEvent({
        spaceId,
        threadName: `${spaceId}/threads/T-A`,
        messageId,
        text: "PING",
        senderName: "users/other-bot",
        senderType: "BOT",
        eventTime,
      });

    await testing.processGoogleChatEvent(
      inSpace("spaces/EEEE", "m1", "2026-05-21T10:00:00.000Z"),
      target,
    );
    await testing.processGoogleChatEvent(
      inSpace("spaces/FFFF", "m2", "2026-05-21T10:00:01.000Z"),
      target,
    );

    expect(captured).toHaveLength(2);
    expect(captured[0].conversationId).toBe("spaces/EEEE");
    expect(captured[1].conversationId).toBe("spaces/FFFF");
  });
});
