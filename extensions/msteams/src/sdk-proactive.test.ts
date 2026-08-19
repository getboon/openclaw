// Msteams tests cover sdk proactive plugin behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MSTeamsReplyStyle } from "../runtime-api.js";
import type { StoredConversationReference } from "./conversation-store.js";
import {
  resolveMSTeamsThreadActivityId,
  sendMSTeamsActivityWithReference,
} from "./sdk-proactive.js";
import type { MSTeamsApp } from "./sdk.js";

const clientState = vi.hoisted(() => ({
  created: [] as Array<{ serviceUrl: string; http: unknown }>,
  create: vi.fn(async (_payload: { conversationId: string; activity: unknown }) => ({
    id: "activity-1",
  })),
}));

vi.mock("@microsoft/teams.api", () => ({
  Client: vi.fn(function MockClient(this: unknown, serviceUrl: string, http: unknown) {
    clientState.created.push({ serviceUrl, http });
    return {
      serviceUrl,
      conversations: {
        activities: (conversationId: string) => ({
          create: (activity: unknown) =>
            clientState.create({
              conversationId,
              activity,
            }),
        }),
      },
    };
  }),
}));

describe("sendMSTeamsActivityWithReference", () => {
  beforeEach(() => {
    clientState.created.length = 0;
    clientState.create.mockClear().mockResolvedValue({ id: "activity-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends through a reference-scoped API client without the protected SDK activitySender", async () => {
    vi.stubEnv("SERVICE_URL", "https://bot.example.com/api/messages");
    const httpClient = { request: vi.fn() };
    const app = {
      client: httpClient,
      api: {
        serviceUrl: "https://smba.trafficmanager.net/teams",
        conversations: {
          activities: () => ({
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          }),
        },
      },
    } as unknown as MSTeamsApp;

    const result = await sendMSTeamsActivityWithReference(
      app,
      {
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        agent: { id: "28:bot", name: "OpenClaw", role: "bot" },
        user: { id: "29:user", aadObjectId: "aad-user" },
        conversation: {
          id: "19:conversation@thread.tacv2",
          conversationType: "personal",
          tenantId: "tenant-1",
        },
        channelId: "msteams",
      },
      { type: "message", text: "hello" },
      { serviceUrlBoundary: { cloud: "Public" } },
    );

    expect(result).toMatchObject({ id: "activity-1" });
    expect(clientState.created).toEqual([
      {
        serviceUrl: "https://smba.trafficmanager.net/amer",
        http: httpClient,
      },
    ]);
    expect(clientState.create).toHaveBeenCalledWith({
      conversationId: "19:conversation@thread.tacv2",
      activity: expect.objectContaining({
        type: "message",
        text: "hello",
        from: { id: "28:bot", name: "OpenClaw", role: "bot" },
        conversation: {
          id: "19:conversation@thread.tacv2",
          conversationType: "personal",
          tenantId: "tenant-1",
        },
        channelData: { tenant: { id: "tenant-1" } },
      }),
    });
  });

  // Locks the mechanism that makes every "forgot to pass threadActivityId" bug
  // silent: the `;messageid=` suffix is what threads, and its absence STRIPS an
  // existing one rather than erroring.
  it("appends the thread suffix when a thread root is supplied", async () => {
    const app = {
      client: {},
      api: { conversations: { activities: () => ({}) } },
    } as unknown as MSTeamsApp;

    await sendMSTeamsActivityWithReference(
      app,
      {
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        agent: { id: "28:bot", role: "bot" },
        conversation: { id: "19:channel@thread.tacv2", conversationType: "channel" },
        channelId: "msteams",
      },
      { type: "message", text: "hello" },
      { threadActivityId: "thread-root-1" },
    );

    expect(clientState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "19:channel@thread.tacv2;messageid=thread-root-1",
      }),
    );
  });

  it("strips an existing thread suffix when no thread root is supplied", async () => {
    const app = {
      client: {},
      api: { conversations: { activities: () => ({}) } },
    } as unknown as MSTeamsApp;

    await sendMSTeamsActivityWithReference(
      app,
      {
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        agent: { id: "28:bot", role: "bot" },
        conversation: {
          id: "19:channel@thread.tacv2;messageid=stale-root",
          conversationType: "channel",
        },
        channelId: "msteams",
      },
      { type: "message", text: "hello" },
    );

    expect(clientState.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "19:channel@thread.tacv2" }),
    );
  });
});

describe("resolveMSTeamsThreadActivityId", () => {
  const channel = { id: "19:channel@thread.tacv2", conversationType: "channel" };
  const cases: Array<{
    name: string;
    ref: StoredConversationReference;
    replyStyle: MSTeamsReplyStyle;
    expected: string | undefined;
  }> = [
    {
      name: "channel thread reply uses the stored thread root",
      ref: { threadId: "thread-root-1", activityId: "activity-9", conversation: channel },
      replyStyle: "thread",
      expected: "thread-root-1",
    },
    {
      name: "falls back to activityId for refs predating threadId",
      ref: { activityId: "activity-9", conversation: channel },
      replyStyle: "thread",
      expected: "activity-9",
    },
    {
      name: "top-level ignores a stored thread root",
      ref: { threadId: "thread-root-1", conversation: channel },
      replyStyle: "top-level",
      expected: undefined,
    },
    {
      name: "groupChat has no thread suffix concept",
      ref: {
        threadId: "thread-root-1",
        conversation: { id: "19:group@thread.v2", conversationType: "groupChat" },
      },
      replyStyle: "thread",
      expected: undefined,
    },
    {
      name: "personal DM has no thread suffix concept",
      ref: {
        threadId: "thread-root-1",
        conversation: { id: "a:1abc", conversationType: "personal" },
      },
      replyStyle: "thread",
      expected: undefined,
    },
    {
      // Guards real drift: the old messenger check compared === "channel"
      // case-sensitively while send-context normalized to lowercase.
      name: "conversationType casing is normalized",
      ref: {
        threadId: "thread-root-1",
        conversation: { id: "19:channel@thread.tacv2", conversationType: "Channel" },
      },
      replyStyle: "thread",
      expected: "thread-root-1",
    },
    {
      name: "missing conversationType is not treated as a channel",
      ref: { threadId: "thread-root-1", conversation: { id: "19:channel@thread.tacv2" } },
      replyStyle: "thread",
      expected: undefined,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        resolveMSTeamsThreadActivityId({ ref: testCase.ref, replyStyle: testCase.replyStyle }),
      ).toBe(testCase.expected);
    });
  }
});
