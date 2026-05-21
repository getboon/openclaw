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
// NOTE: we deliberately do NOT mock openclaw/plugin-sdk/inbound-reply-dispatch
// — the real bot-loop SDK helper runs end-to-end.

type CapturedTurn = {
  routeSessionKey: string;
  conversationId: string;
  threadId: string | undefined;
  parentSessionKey: string | undefined;
  outboundThread: string | undefined;
  messageId: string | undefined;
};

function buildE2EHarness() {
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
          accountId: "default",
          sessionKey: `agent:main:googlechat:default:${params.peer.kind}:${params.peer.id}`,
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
      turn: {
        buildContext: vi.fn((payload: unknown) => payload),
        run,
      },
    },
  } as unknown as GoogleChatCoreRuntime;

  const runtime: GoogleChatRuntimeEnv = { error: vi.fn(), log: vi.fn() };
  const account = {
    accountId: "default",
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
  threadReply?: boolean;
  messageId: string;
  text: string;
  senderName?: string;
  senderDisplayName?: string;
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
        type: "HUMAN",
      },
      ...(opts.threadName ? { thread: { name: opts.threadName } } : {}),
      ...(typeof opts.threadReply === "boolean" ? { threadReply: opts.threadReply } : {}),
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
        threadReply: false,
        messageId: "m1",
        text: "@OpenClaw can you check the deploy status?",
        eventTime: "2026-05-21T10:00:00.000Z",
      }),
      buildRealisticMessageEvent({
        spaceId: "spaces/AAAA-engineering",
        threadName: "spaces/AAAA-engineering/threads/T-incident",
        threadReply: false,
        messageId: "m2",
        text: "@OpenClaw summarize the incident timeline",
        senderName: "users/bob",
        senderDisplayName: "Bob",
        eventTime: "2026-05-21T10:01:00.000Z",
      }),
      buildRealisticMessageEvent({
        spaceId: "spaces/AAAA-engineering",
        threadName: "spaces/AAAA-engineering/threads/T-deploy",
        threadReply: true,
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
    const expectedParent = "agent:main:googlechat:default:group:spaces/AAAA-engineering";
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
});
