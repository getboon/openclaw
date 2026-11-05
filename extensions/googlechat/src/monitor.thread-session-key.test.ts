import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type { GoogleChatCoreRuntime, GoogleChatRuntimeEnv } from "./monitor-types.js";
import { testing } from "./monitor.js";
import type { GoogleChatEvent, GoogleChatSpace } from "./types.js";

const apiMocks = vi.hoisted(() => ({
  downloadGoogleChatMedia: vi.fn(),
  sendGoogleChatMessage: vi.fn().mockResolvedValue({ messageName: "spaces/X/messages/typing" }),
}));
const accessMocks = vi.hoisted(() => ({
  applyGoogleChatInboundAccessPolicy: vi.fn(),
}));
const botLoopMocks = vi.hoisted(() => ({
  recordChannelBotPairLoopAndCheckSuppression: vi.fn(() => ({ suppressed: false })),
}));

vi.mock("./api.js", () => ({
  downloadGoogleChatMedia: apiMocks.downloadGoogleChatMedia,
  sendGoogleChatMessage: apiMocks.sendGoogleChatMessage,
}));
vi.mock("./monitor-access.js", () => ({
  applyGoogleChatInboundAccessPolicy: accessMocks.applyGoogleChatInboundAccessPolicy,
}));
vi.mock("openclaw/plugin-sdk/channel-inbound", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/channel-inbound")>(
    "openclaw/plugin-sdk/channel-inbound",
  );
  return {
    ...actual,
    recordChannelBotPairLoopAndCheckSuppression:
      botLoopMocks.recordChannelBotPairLoopAndCheckSuppression,
  };
});

type CapturedTurn = {
  routeSessionKey: string;
  ctxConversationId: string;
  ctxConversationKind: string;
  ctxThreadId: string | undefined;
  ctxParentSessionKey: string | undefined;
  resolvedPeerKind: string | undefined;
};

function buildHarness() {
  const captured: CapturedTurn[] = [];
  const observedPeerKinds: string[] = [];
  const buildContext = vi.fn((payload: unknown) => payload);
  const run = vi.fn(
    async (params: {
      adapter: { resolveTurn: () => { routeSessionKey: string; ctxPayload: unknown } };
    }) => {
      const turn = params.adapter.resolveTurn();
      const ctx = turn.ctxPayload as {
        conversation: { id: string; kind: string; threadId?: string };
        route: { routeSessionKey: string; parentSessionKey?: string };
      };
      captured.push({
        routeSessionKey: turn.routeSessionKey,
        ctxConversationId: ctx.conversation.id,
        ctxConversationKind: ctx.conversation.kind,
        ctxThreadId: ctx.conversation.threadId,
        ctxParentSessionKey: ctx.route.parentSessionKey,
        resolvedPeerKind: observedPeerKinds.at(-1),
      });
    },
  );
  const core = {
    logging: { shouldLogVerbose: () => false },
    channel: {
      routing: {
        resolveAgentRoute: vi.fn((params: { peer: { kind: string; id: string } }) => {
          observedPeerKinds.push(params.peer.kind);
          return {
            agentId: "main",
            channel: "googlechat",
            accountId: "default",
            sessionKey: `agent:main:googlechat:default:${params.peer.kind}:${params.peer.id}`,
          };
        }),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/store.json"),
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
      inbound: { buildContext, run },
    },
  } as unknown as GoogleChatCoreRuntime;
  const runtime = { error: vi.fn(), log: vi.fn() } satisfies GoogleChatRuntimeEnv;
  const account = {
    accountId: "default",
    config: { allowBots: false, botUser: "users/app", typingIndicator: "none" },
    credentialSource: "inline",
  } as unknown as ResolvedGoogleChatAccount;
  return { captured, core, runtime, account };
}

function buildEvent(opts: {
  threadName?: string;
  messageId: string;
  space?: Partial<GoogleChatSpace>;
}): GoogleChatEvent {
  const space = {
    name: "spaces/AAA",
    displayName: "AAA",
    spaceType: "SPACE",
    spaceThreadingState: "THREADED_MESSAGES",
    ...opts.space,
  } as GoogleChatSpace;
  return {
    type: "MESSAGE",
    eventTime: "2026-05-21T00:00:00.000Z",
    space,
    message: {
      name: `spaces/AAA/messages/${opts.messageId}`,
      text: "hello",
      sender: { name: "users/alice", type: "HUMAN" },
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
  botLoopMocks.recordChannelBotPairLoopAndCheckSuppression.mockReset();
  botLoopMocks.recordChannelBotPairLoopAndCheckSuppression.mockReturnValue({ suppressed: false });
});

describe("googlechat monitor thread-scoped session keys", () => {
  it("uses distinct session keys for two threads in a THREADED_MESSAGES space", async () => {
    const { captured, core, runtime, account } = buildHarness();
    for (const [threadName, messageId] of [
      ["spaces/AAA/threads/T1", "m1"],
      ["spaces/AAA/threads/T2", "m2"],
    ] as const) {
      await testing.processMessageWithPipeline({
        event: buildEvent({ threadName, messageId }),
        account,
        config: {},
        runtime,
        core,
        mediaMaxMb: 0,
      });
    }
    expect(captured).toHaveLength(2);
    expect(captured[0].routeSessionKey).not.toBe(captured[1].routeSessionKey);
    expect(captured[0].routeSessionKey).toMatch(/:thread:spaces\/AAA\/threads\/T1$/);
    expect(captured[1].routeSessionKey).toMatch(/:thread:spaces\/AAA\/threads\/T2$/);
  });

  it("groups follow-up replies in the same thread under one session key", async () => {
    const { captured, core, runtime, account } = buildHarness();
    for (const [threadName, messageId] of [
      ["spaces/AAA/threads/T1", "root"],
      ["spaces/AAA/threads/T1", "reply-a"],
      ["spaces/AAA/threads/T1", "reply-b"],
    ] as const) {
      await testing.processMessageWithPipeline({
        event: buildEvent({ threadName, messageId }),
        account,
        config: {},
        runtime,
        core,
        mediaMaxMb: 0,
      });
    }
    expect(captured).toHaveLength(3);
    expect(new Set(captured.map((c) => c.routeSessionKey))).toEqual(
      new Set([captured[0].routeSessionKey]),
    );
  });

  it("does NOT suffix in an UNTHREADED_MESSAGES space (group chat with threading off)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: { spaceThreadingState: "UNTHREADED_MESSAGES", spaceType: "GROUP_CHAT" },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
    expect(captured[0].ctxThreadId).toBeUndefined();
  });

  it("does NOT suffix in a GROUPED_MESSAGES space (topic-style threading off)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: { spaceThreadingState: "GROUPED_MESSAGES" },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
  });

  it("does NOT suffix when spaceType=SPACE has NO threading-state signal (GROUPED is also SPACE)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: { spaceType: "SPACE", spaceThreadingState: undefined, type: undefined },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
  });

  it("suffixes when legacy `space.type === 'ROOM'` and no modern signal is present", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: { type: "ROOM", spaceType: undefined, spaceThreadingState: undefined },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).toMatch(/:thread:spaces\/AAA\/threads\/T1$/);
  });

  it("does NOT suffix in a DIRECT_MESSAGE space (modern spaceType)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: {
          spaceType: "DIRECT_MESSAGE",
          spaceThreadingState: "UNTHREADED_MESSAGES",
          type: undefined,
        },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
  });

  it("routes a modern DIRECT_MESSAGE payload as `direct` peer kind (not group)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        messageId: "m1",
        space: {
          spaceType: "DIRECT_MESSAGE",
          spaceThreadingState: "UNTHREADED_MESSAGES",
          type: undefined,
        },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].resolvedPeerKind).toBe("direct");
    expect(captured[0].ctxConversationKind).toBe("direct");
    expect(captured[0].routeSessionKey).toMatch(/:direct:spaces\/AAA$/);
  });

  it("routes a GROUP_CHAT payload as `group` peer kind", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        messageId: "m1",
        space: {
          spaceType: "GROUP_CHAT",
          spaceThreadingState: "UNTHREADED_MESSAGES",
          type: undefined,
        },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].resolvedPeerKind).toBe("group");
  });

  it("does NOT suffix when only legacy `space.type === 'DM'` is set", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({
        threadName: "spaces/AAA/threads/T1",
        messageId: "m1",
        space: { type: "DM", spaceType: undefined, spaceThreadingState: undefined },
      }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
  });

  it("populates conversation.threadId for threaded space messages", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({ threadName: "spaces/AAA/threads/T1", messageId: "m1" }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].ctxThreadId).toBe("spaces/AAA/threads/T1");
  });

  it("sets parentSessionKey to the space-level key for thread sessions", async () => {
    const { captured, core, runtime, account } = buildHarness();
    await testing.processMessageWithPipeline({
      event: buildEvent({ threadName: "spaces/AAA/threads/T1", messageId: "m1" }),
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].ctxParentSessionKey).toBe("agent:main:googlechat:default:group:spaces/AAA");
  });

  it("omits parentSessionKey when the message is space-scoped (no thread)", async () => {
    const { captured, core, runtime, account } = buildHarness();
    const event = buildEvent({ messageId: "m1" });
    // Force no thread by leaving message.thread undefined and ensure unthreaded space
    event.space = {
      ...(event.space as GoogleChatSpace),
      spaceThreadingState: "UNTHREADED_MESSAGES",
    };
    await testing.processMessageWithPipeline({
      event,
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].ctxParentSessionKey).toBeUndefined();
  });

  it("prefers event.thread.name over message.thread.name for thread identity", async () => {
    const { captured, core, runtime, account } = buildHarness();
    const event = buildEvent({ threadName: "spaces/AAA/threads/FROM_MESSAGE", messageId: "m1" });
    event.thread = { name: "spaces/AAA/threads/FROM_EVENT" };
    await testing.processMessageWithPipeline({
      event,
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).toMatch(/:thread:spaces\/AAA\/threads\/FROM_EVENT$/);
    expect(captured[0].ctxThreadId).toBe("spaces/AAA/threads/FROM_EVENT");
  });

  it("uses the native space id (not the agent session key) as bot-loop conversationId", async () => {
    const { core, runtime, account } = buildHarness();
    account.config.allowBots = true;
    account.config.botUser = "users/app";
    const event = buildEvent({ threadName: "spaces/AAA/threads/T1", messageId: "m1" });
    event.message!.sender = { name: "users/other-bot", type: "BOT" };
    await testing.processMessageWithPipeline({
      event,
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    // Match Slack: bot-loop scope is the channel/space, not the thread.
    // Per-thread suppression would diverge from peer channels without justification.
    expect(botLoopMocks.recordChannelBotPairLoopAndCheckSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "spaces/AAA" }),
    );
    const arg = botLoopMocks.recordChannelBotPairLoopAndCheckSuppression.mock.calls[0]?.[0] as
      | { conversationId?: string }
      | undefined;
    expect(arg?.conversationId).not.toMatch(/^agent:/);
    expect(arg?.conversationId).not.toMatch(/:thread:/);
  });

  it("keeps space-only bot-loop conversationId in unthreaded spaces", async () => {
    const { core, runtime, account } = buildHarness();
    account.config.allowBots = true;
    account.config.botUser = "users/app";
    const event = buildEvent({
      threadName: "spaces/AAA/threads/T1",
      messageId: "m1",
      space: { spaceThreadingState: "UNTHREADED_MESSAGES", spaceType: "GROUP_CHAT" },
    });
    event.message!.sender = { name: "users/other-bot", type: "BOT" };
    await testing.processMessageWithPipeline({
      event,
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(botLoopMocks.recordChannelBotPairLoopAndCheckSuppression).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "spaces/AAA" }),
    );
  });

  it("does not isolate sessions when the message has no thread identity at all", async () => {
    const { captured, core, runtime, account } = buildHarness();
    const event = buildEvent({ messageId: "m1" });
    expect(event.message?.thread).toBeUndefined();
    await testing.processMessageWithPipeline({
      event,
      account,
      config: {},
      runtime,
      core,
      mediaMaxMb: 0,
    });
    expect(captured[0].routeSessionKey).not.toMatch(/:thread:/);
    expect(captured[0].ctxThreadId).toBeUndefined();
  });
});
