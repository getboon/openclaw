// Msteams tests cover send plugin behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../runtime-api.js";
import {
  deleteMessageMSTeams,
  editMessageMSTeams,
  sendAdaptiveCardMSTeams,
  sendMessageMSTeams,
  sendPollMSTeams,
} from "./send.js";

const mockState = vi.hoisted(() => ({
  loadOutboundMediaFromUrl: vi.fn(),
  resolveMSTeamsSendContext: vi.fn(),
  resolveMarkdownTableMode: vi.fn(() => "off"),
  convertMarkdownTables: vi.fn((text: string) => text),
  runtimeResolveMarkdownTableMode: vi.fn(() => "off"),
  runtimeConvertMarkdownTables: vi.fn((text: string) => text),
  requiresFileConsent: vi.fn(),
  prepareFileConsentActivity: vi.fn(),
  prepareFileConsentActivityFs: vi.fn(),
  extractFilename: vi.fn(async () => "fallback.bin"),
  sendMSTeamsMessages: vi.fn(),
  sendMSTeamsActivityWithReference: vi.fn(async () => ({ id: "message-1" })),
  updateMSTeamsActivityWithReference: vi.fn(async () => ({ id: "updated" })),
  deleteMSTeamsActivityWithReference: vi.fn(async () => {}),
  uploadAndShareSharePoint: vi.fn(),
  getDriveItemProperties: vi.fn(),
  createMSTeamsTokenProvider: vi.fn(),
  buildMSTeamsPollCard: vi.fn(() => ({
    pollId: "poll-1",
    options: ["a", "b"],
    card: { type: "AdaptiveCard" },
  })),
}));

// `loadOutboundMediaFromUrl` is re-exported from msteams's runtime-api which
// pulls from `openclaw/plugin-sdk/outbound-media` (post-migration). Mock the
// canonical source so the re-export carries our stub through.
vi.mock("openclaw/plugin-sdk/outbound-media", () => ({
  loadOutboundMediaFromUrl: mockState.loadOutboundMediaFromUrl,
}));

vi.mock("openclaw/plugin-sdk/markdown-table-runtime", () => ({
  resolveMarkdownTableMode: mockState.resolveMarkdownTableMode,
}));

vi.mock("openclaw/plugin-sdk/text-chunking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/text-chunking")>();
  return {
    ...actual,
    convertMarkdownTables: mockState.convertMarkdownTables,
  };
});

vi.mock("./send-context.js", () => ({
  resolveMSTeamsSendContext: mockState.resolveMSTeamsSendContext,
}));

vi.mock("./file-consent-helpers.js", () => ({
  requiresFileConsent: mockState.requiresFileConsent,
  prepareFileConsentActivity: mockState.prepareFileConsentActivity,
  prepareFileConsentActivityFs: mockState.prepareFileConsentActivityFs,
}));

vi.mock("./media-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-helpers.js")>();
  return {
    ...actual,
    extractFilename: mockState.extractFilename,
    extractMessageId: () => "message-1",
  };
});

vi.mock("./messenger.js", () => ({
  sendMSTeamsMessages: mockState.sendMSTeamsMessages,
  buildConversationReference: (ref: Record<string, unknown>) => ({
    serviceUrl: (ref as { serviceUrl?: string }).serviceUrl ?? "https://service.example.com",
    conversation: (ref as { conversation?: Record<string, unknown> }).conversation ?? {
      id: "19:conversation@thread.tacv2",
    },
    agent: (ref as { agent?: Record<string, unknown> }).agent,
    user: (ref as { user?: Record<string, unknown> }).user,
    tenantId: (ref as { tenantId?: string }).tenantId,
    aadObjectId: (ref as { aadObjectId?: string }).aadObjectId,
  }),
}));

vi.mock("./runtime.js", () => ({
  getMSTeamsRuntime: () => ({
    channel: {
      text: {
        resolveMarkdownTableMode: mockState.runtimeResolveMarkdownTableMode,
        convertMarkdownTables: mockState.runtimeConvertMarkdownTables,
      },
    },
  }),
}));

vi.mock("./graph-upload.js", () => ({
  uploadAndShareSharePoint: mockState.uploadAndShareSharePoint,
  getDriveItemProperties: mockState.getDriveItemProperties,
}));

vi.mock("./polls.js", () => ({
  buildMSTeamsPollCard: mockState.buildMSTeamsPollCard,
}));

vi.mock("./sdk.js", () => ({
  createMSTeamsTokenProvider: mockState.createMSTeamsTokenProvider,
}));

vi.mock("./sdk-proactive.js", () => ({
  sendMSTeamsActivityWithReference: mockState.sendMSTeamsActivityWithReference,
  updateMSTeamsActivityWithReference: mockState.updateMSTeamsActivityWithReference,
  deleteMSTeamsActivityWithReference: mockState.deleteMSTeamsActivityWithReference,
}));

function createMockApp(overrides?: {
  send?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
}) {
  const sendFn = overrides?.send ?? vi.fn(async () => ({ id: "message-1" }));
  const updateFn = overrides?.update ?? vi.fn(async () => ({ id: "updated" }));
  const deleteFn = overrides?.delete ?? vi.fn(async () => {});
  return {
    send: sendFn,
    api: {
      conversations: {
        activities: () => ({
          create: sendFn,
          update: updateFn,
          delete: deleteFn,
        }),
      },
    },
  };
}

function mockProactiveSendContextFailure(error: string) {
  mockState.sendMSTeamsActivityWithReference.mockRejectedValue(new Error(error));
  mockState.updateMSTeamsActivityWithReference.mockRejectedValue(new Error(error));
  mockState.deleteMSTeamsActivityWithReference.mockRejectedValue(new Error(error));
  const failingApp = createMockApp({
    send: vi.fn().mockRejectedValue(new Error(error)),
    update: vi.fn().mockRejectedValue(new Error(error)),
    delete: vi.fn().mockRejectedValue(new Error(error)),
  });
  mockState.resolveMSTeamsSendContext.mockResolvedValue({
    app: failingApp,
    appId: "app-id",
    conversationId: "19:conversation@thread.tacv2",
    ref: {
      user: { id: "user-1" },
      agent: { id: "agent-1" },
      conversation: { id: "19:conversation@thread.tacv2" },
      channelId: "msteams",
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    conversationType: "personal",
    sdkCloudOptions: { cloud: "Public" },
    tokenProvider: {},
  });
}

function createSharePointSendContext(params: {
  conversationId: string;
  graphChatId: string | null;
  siteId?: string;
  conversationType?: "groupChat" | "channel";
  replyStyle?: "thread" | "top-level";
  threadActivityId?: string;
}) {
  return {
    app: createMockApp(),
    appId: "app-id",
    conversationId: params.conversationId,
    graphChatId: params.graphChatId,
    ref: {},
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    conversationType: params.conversationType ?? ("groupChat" as const),
    replyStyle: params.replyStyle ?? ("top-level" as const),
    ...(params.threadActivityId ? { threadActivityId: params.threadActivityId } : {}),
    sdkCloudOptions: { cloud: "Public" as const },
    tokenProvider: { getAccessToken: vi.fn(async () => "token") },
    mediaMaxBytes: 8 * 1024 * 1024,
    sharePointSiteId: params.siteId,
  };
}

function mockSharePointPdfUpload(params: {
  bufferSize: number;
  fileName: string;
  itemId: string;
  uniqueId: string;
}) {
  mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
    buffer: Buffer.alloc(params.bufferSize, "pdf"),
    contentType: "application/pdf",
    fileName: params.fileName,
    kind: "file",
  });
  mockState.requiresFileConsent.mockReturnValue(false);
  mockState.uploadAndShareSharePoint.mockResolvedValue({
    itemId: params.itemId,
    webUrl: `https://sp.example.com/${params.fileName}`,
    shareUrl: `https://sp.example.com/share/${params.fileName}`,
    name: params.fileName,
  });
  mockState.getDriveItemProperties.mockResolvedValue({
    eTag: `"${params.uniqueId},1"`,
    webDavUrl: `https://sp.example.com/dav/${params.fileName}`,
    name: params.fileName,
  });
}

type MockWithCalls = {
  mock: { calls: unknown[][] };
};

function firstObjectArg(mock: MockWithCalls): Record<string, unknown> {
  const value = mock.mock.calls[0]?.[0];
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected first mock call to receive an object argument");
  }
  return value as Record<string, unknown>;
}
describe("sendMessageMSTeams", () => {
  beforeEach(() => {
    mockState.loadOutboundMediaFromUrl.mockReset();
    mockState.resolveMSTeamsSendContext.mockReset();
    mockState.resolveMarkdownTableMode.mockReset();
    mockState.resolveMarkdownTableMode.mockReturnValue("off");
    mockState.convertMarkdownTables.mockReset();
    mockState.convertMarkdownTables.mockImplementation((text: string) => text);
    mockState.runtimeResolveMarkdownTableMode.mockReset();
    mockState.runtimeResolveMarkdownTableMode.mockReturnValue("off");
    mockState.runtimeConvertMarkdownTables.mockReset();
    mockState.runtimeConvertMarkdownTables.mockImplementation((text: string) => text);
    mockState.requiresFileConsent.mockReset();
    mockState.prepareFileConsentActivity.mockReset();
    mockState.prepareFileConsentActivityFs.mockReset();
    mockState.extractFilename.mockReset();
    mockState.sendMSTeamsMessages.mockReset();
    mockState.sendMSTeamsActivityWithReference.mockReset();
    mockState.updateMSTeamsActivityWithReference.mockReset();
    mockState.deleteMSTeamsActivityWithReference.mockReset();
    mockState.uploadAndShareSharePoint.mockReset();
    mockState.getDriveItemProperties.mockReset();

    mockState.extractFilename.mockResolvedValue("fallback.bin");
    mockState.requiresFileConsent.mockReturnValue(false);
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      app: createMockApp(),
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {},
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      replyStyle: "top-level",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: { getAccessToken: vi.fn(async () => "token") },
      mediaMaxBytes: 8 * 1024,
      sharePointSiteId: undefined,
    });
    mockState.sendMSTeamsMessages.mockResolvedValue(["message-1"]);
    mockState.sendMSTeamsActivityWithReference.mockResolvedValue({ id: "message-1" });
    mockState.updateMSTeamsActivityWithReference.mockResolvedValue({ id: "updated" });
    mockState.deleteMSTeamsActivityWithReference.mockResolvedValue(undefined);
  });

  it("loads media through shared helper and forwards mediaLocalRoots", async () => {
    const mediaBuffer = Buffer.from("tiny-image");
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: mediaBuffer,
      contentType: "image/png",
      fileName: "inline.png",
      kind: "image",
    });

    const result = await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      text: "hello",
      mediaUrl: "file:///tmp/agent-workspace/inline.png",
      mediaLocalRoots: ["/tmp/agent-workspace"],
    });

    expect(mockState.loadOutboundMediaFromUrl).toHaveBeenCalledWith(
      "file:///tmp/agent-workspace/inline.png",
      {
        maxBytes: 8 * 1024,
        mediaLocalRoots: ["/tmp/agent-workspace"],
      },
    );

    const sendPayload = firstObjectArg(mockState.sendMSTeamsMessages);
    const messages = sendPayload.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("hello");
    expect(messages[0]?.mediaUrl).toBe(`data:image/png;base64,${mediaBuffer.toString("base64")}`);
    expect(result.receipt?.primaryPlatformMessageId).toBe("message-1");
    expect(result.receipt?.platformMessageIds).toEqual(["message-1"]);
    expect(result.receipt?.parts).toHaveLength(1);
    expect(result.receipt?.parts[0]?.platformMessageId).toBe("message-1");
    expect(result.receipt?.parts[0]?.kind).toBe("media");
  });

  it("sends with provided cfg even when Teams runtime text helpers are unavailable", async () => {
    mockState.runtimeResolveMarkdownTableMode.mockImplementation(() => {
      throw new Error("MSTeams runtime not initialized");
    });
    mockState.runtimeConvertMarkdownTables.mockImplementation(() => {
      throw new Error("MSTeams runtime not initialized");
    });
    mockState.resolveMarkdownTableMode.mockReturnValue("off");
    mockState.convertMarkdownTables.mockReturnValue("hello");

    const result = await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      text: "hello",
    });

    expect(result.messageId).toBe("message-1");
    expect(result.conversationId).toBe("19:conversation@thread.tacv2");
    expect(result.receipt?.primaryPlatformMessageId).toBe("message-1");
    expect(result.receipt?.platformMessageIds).toEqual(["message-1"]);
    expect(result.receipt?.parts).toHaveLength(1);
    expect(result.receipt?.parts[0]?.platformMessageId).toBe("message-1");
    expect(result.receipt?.parts[0]?.kind).toBe("text");

    expect(mockState.resolveMarkdownTableMode).toHaveBeenCalledWith({
      cfg: {},
      channel: "msteams",
    });
    expect(mockState.convertMarkdownTables).toHaveBeenCalledWith("hello", "off");
  });

  it("passes the resolved proactive replyStyle to text sends", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: {},
      appId: "app-id",
      conversationId: "19:channel@thread.tacv2",
      ref: {
        threadId: "thread-root-1",
        conversation: { id: "19:channel@thread.tacv2", conversationType: "channel" },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "channel",
      replyStyle: "thread",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: { getAccessToken: vi.fn(async () => "token") },
      mediaMaxBytes: 8 * 1024,
      sharePointSiteId: undefined,
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "threaded reply",
    });

    expect(firstObjectArg(mockState.sendMSTeamsMessages).replyStyle).toBe("thread");
  });

  it("keeps top-level proactive replyStyle when resolved for a channel", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      adapter: {},
      appId: "app-id",
      conversationId: "19:channel@thread.tacv2",
      ref: {
        threadId: "thread-root-1",
        conversation: { id: "19:channel@thread.tacv2", conversationType: "channel" },
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "channel",
      replyStyle: "top-level",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: { getAccessToken: vi.fn(async () => "token") },
      mediaMaxBytes: 8 * 1024,
      sharePointSiteId: undefined,
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "top-level reply",
    });

    expect(firstObjectArg(mockState.sendMSTeamsMessages).replyStyle).toBe("top-level");
  });

  it("uses graphChatId instead of conversationId when uploading to SharePoint", async () => {
    // Simulates a group chat where Bot Framework conversationId is valid but we have
    // a resolved Graph chat ID cached from a prior send.
    const graphChatId = "19:graph-native-chat-id@thread.tacv2";
    const botFrameworkConversationId = "19:bot-framework-id@thread.tacv2";

    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: botFrameworkConversationId,
        graphChatId,
        siteId: "site-123",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 100,
      fileName: "doc.pdf",
      itemId: "item-1",
      uniqueId: "{GUID-123}",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:bot-framework-id@thread.tacv2",
      text: "here is a file",
      mediaUrl: "https://example.com/doc.pdf",
    });

    // The Graph-native chatId must be passed to SharePoint upload, not the Bot Framework ID
    const uploadPayload = firstObjectArg(mockState.uploadAndShareSharePoint);
    expect(uploadPayload.chatId).toBe(graphChatId);
    expect(uploadPayload.siteId).toBe("site-123");
  });

  it("falls back to conversationId when graphChatId is not available", async () => {
    const botFrameworkConversationId = "19:fallback-id@thread.tacv2";

    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: botFrameworkConversationId,
        graphChatId: null,
        siteId: "site-456",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 50,
      fileName: "report.pdf",
      itemId: "item-2",
      uniqueId: "{GUID-456}",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:fallback-id@thread.tacv2",
      text: "report",
      mediaUrl: "https://example.com/report.pdf",
    });

    // Falls back to conversationId when graphChatId is null
    const uploadPayload = firstObjectArg(mockState.uploadAndShareSharePoint);
    expect(uploadPayload.chatId).toBe(botFrameworkConversationId);
    expect(uploadPayload.siteId).toBe("site-456");
  });

  // ENG-17134: doc-link sends used to bypass sendMSTeamsMessages via a raw
  // proactive send, which strips the `;messageid=` suffix and posts at channel
  // root. That made "agent produced a SharePoint link" and "agent abandoned the
  // thread" the same branch.
  it("threads SharePoint file links instead of posting them at channel root", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 100,
      fileName: "doc.pdf",
      itemId: "item-1",
      uniqueId: "{GUID-123}",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "here is the doc",
      mediaUrl: "https://example.com/doc.pdf",
    });

    const sendPayload = firstObjectArg(mockState.sendMSTeamsMessages);
    expect(sendPayload.replyStyle).toBe("thread");
    const messages = sendPayload.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(
      "here is the doc\n\n📎 [doc.pdf](https://sp.example.com/share/doc.pdf)",
    );
    expect(messages[0]?.mediaUrl).toBeUndefined();
    // The raw proactive send is the bug shape — it must not be used here.
    expect(mockState.sendMSTeamsActivityWithReference).not.toHaveBeenCalled();
  });

  // A configured SharePoint site must take priority over inlining images
  // too — otherwise a working upload+link path silently regresses to inline
  // base64 with no permanent share link.
  it("uploads an image to SharePoint instead of inlining it when a site is configured", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: Buffer.alloc(10, "png"),
      contentType: "image/png",
      fileName: "diagram.png",
      kind: "image",
    });
    mockState.requiresFileConsent.mockReturnValue(false);
    mockState.uploadAndShareSharePoint.mockResolvedValue({
      itemId: "item-1",
      webUrl: "https://sp.example.com/diagram.png",
      shareUrl: "https://sp.example.com/share/diagram.png",
      name: "diagram.png",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "here is the diagram",
      mediaUrl: "https://example.com/diagram.png",
    });

    expect(mockState.uploadAndShareSharePoint).toHaveBeenCalledOnce();
    const sendPayload = firstObjectArg(mockState.sendMSTeamsMessages);
    const messages = sendPayload.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.text).toBe(
      "here is the diagram\n\n📎 [diagram.png](https://sp.example.com/share/diagram.png)",
    );
    expect(messages[0]?.mediaUrl).toBeUndefined();
  });

  // A bot has no personal OneDrive (/me/drive requires a signed-in user, not
  // the app-only token this plugin has), so there is no working upload path
  // without sharePointSiteId. Say so explicitly in-thread instead of
  // attempting (and failing) an upload the agent would otherwise have to
  // paraphrase as "I cannot".
  it("produces an explicit undeliverable notice when no SharePoint site is configured", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: Buffer.alloc(100, "pdf"),
      contentType: "application/pdf",
      fileName: "notes.pdf",
      kind: "file",
    });
    mockState.requiresFileConsent.mockReturnValue(false);

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "notes attached",
      mediaUrl: "https://example.com/notes.pdf",
    });

    expect(mockState.uploadAndShareSharePoint).not.toHaveBeenCalled();
    const sendPayload = firstObjectArg(mockState.sendMSTeamsMessages);
    // Threading must still be preserved for the notice, same as any other send.
    expect(sendPayload.replyStyle).toBe("thread");
    const messages = sendPayload.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.text).toContain('I can\'t attach "notes.pdf" directly here');
    expect(messages[0]?.text).toContain("sharePointSiteId");
    // The remote source URL is offered as a fallback link.
    expect(messages[0]?.text).toContain("https://example.com/notes.pdf");
    expect(messages[0]?.text).toContain("notes attached\n\n");
    expect(mockState.sendMSTeamsActivityWithReference).not.toHaveBeenCalled();
  });

  it("omits a source link in the undeliverable notice for a local file path", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: Buffer.alloc(100, "pdf"),
      contentType: "application/pdf",
      fileName: "notes.pdf",
      kind: "file",
    });
    mockState.requiresFileConsent.mockReturnValue(false);

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "notes attached",
      mediaUrl: "/workspace/notes.pdf",
    });

    const sendPayload = firstObjectArg(mockState.sendMSTeamsMessages);
    const messages = sendPayload.messages as Array<Record<string, unknown>>;
    expect(messages[0]?.text).toContain('I can\'t attach "notes.pdf" directly here');
    expect(messages[0]?.text).not.toContain("http");
  });

  it("keeps SharePoint file links top-level when replyStyle resolves to top-level", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "top-level",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 100,
      fileName: "doc.pdf",
      itemId: "item-1",
      uniqueId: "{GUID-123}",
    });

    await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "here is the doc",
      mediaUrl: "https://example.com/doc.pdf",
    });

    expect(firstObjectArg(mockState.sendMSTeamsMessages).replyStyle).toBe("top-level");
  });

  it("keeps the media receipt kind for uploaded file links", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 100,
      fileName: "doc.pdf",
      itemId: "item-1",
      uniqueId: "{GUID-123}",
    });

    const result = await sendMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      text: "here is the doc",
      mediaUrl: "https://example.com/doc.pdf",
    });

    expect(result.receipt?.parts[0]?.kind).toBe("media");
  });

  it("wraps upload failures as a file send error", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockState.loadOutboundMediaFromUrl.mockResolvedValueOnce({
      buffer: Buffer.alloc(10, "pdf"),
      contentType: "application/pdf",
      fileName: "doc.pdf",
      kind: "file",
    });
    mockState.requiresFileConsent.mockReturnValue(false);
    mockState.uploadAndShareSharePoint.mockRejectedValue(new Error("graph exploded"));

    await expect(
      sendMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:channel@thread.tacv2",
        text: "doc",
        mediaUrl: "https://example.com/doc.pdf",
      }),
    ).rejects.toThrow(/msteams file send failed/);
  });

  // Send failures must NOT be re-wrapped by the file-send catch: sendTextWithMedia
  // already wraps them, and double-wrapping hides the real classification.
  it("does not double-wrap send failures on the file-link path", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(
      createSharePointSendContext({
        conversationId: "19:channel@thread.tacv2",
        graphChatId: null,
        siteId: "site-123",
        conversationType: "channel",
        replyStyle: "thread",
        threadActivityId: "thread-root-1",
      }),
    );
    mockSharePointPdfUpload({
      bufferSize: 10,
      fileName: "doc.pdf",
      itemId: "item-1",
      uniqueId: "{GUID-1}",
    });
    mockState.sendMSTeamsMessages.mockRejectedValue(new Error("teams rejected the activity"));

    await expect(
      sendMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:channel@thread.tacv2",
        text: "doc",
        mediaUrl: "https://example.com/doc.pdf",
      }),
    ).rejects.toThrow(/^msteams send failed/);
  });
});

// ENG-17134: card and poll sends went out via a raw proactive send with no
// thread anchor, so any card-shaped reply (incl. an "open the document" URL
// button) landed at channel root regardless of replyStyle.
describe("MSTeams card and poll threading", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
    mockState.sendMSTeamsActivityWithReference.mockReset();
    mockState.sendMSTeamsActivityWithReference.mockResolvedValue({ id: "message-1" });
    mockState.buildMSTeamsPollCard.mockReset();
    mockState.buildMSTeamsPollCard.mockReturnValue({
      pollId: "poll-1",
      options: ["a", "b"],
      card: { type: "AdaptiveCard" },
    });
  });

  function cardContext(threadActivityId?: string) {
    return {
      app: createMockApp(),
      appId: "app-id",
      conversationId: "19:channel@thread.tacv2",
      ref: { conversation: { id: "19:channel@thread.tacv2", conversationType: "channel" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "channel" as const,
      replyStyle: threadActivityId ? ("thread" as const) : ("top-level" as const),
      ...(threadActivityId ? { threadActivityId } : {}),
      sdkCloudOptions: { cloud: "Public" as const },
      tokenProvider: { getAccessToken: vi.fn(async () => "token") },
    };
  }

  it("sends adaptive cards with the resolved thread root", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(cardContext("thread-root-1"));

    await sendAdaptiveCardMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      card: { type: "AdaptiveCard" },
    });

    const options = (
      mockState.sendMSTeamsActivityWithReference.mock.calls[0] as unknown[] | undefined
    )?.[3] as Record<string, unknown> | undefined;
    expect(options?.threadActivityId).toBe("thread-root-1");
  });

  it("omits the thread root for top-level card sends", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(cardContext());

    await sendAdaptiveCardMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      card: { type: "AdaptiveCard" },
    });

    const options = (
      mockState.sendMSTeamsActivityWithReference.mock.calls[0] as unknown[] | undefined
    )?.[3] as Record<string, unknown> | undefined;
    expect(options?.threadActivityId).toBeUndefined();
  });

  it("forwards replyStyleOverride into the card send context", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(cardContext());

    await sendAdaptiveCardMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      card: { type: "AdaptiveCard" },
      replyStyleOverride: "top-level",
    });

    expect(firstObjectArg(mockState.resolveMSTeamsSendContext).replyStyleOverride).toBe(
      "top-level",
    );
  });

  it("sends polls with the resolved thread root", async () => {
    mockState.resolveMSTeamsSendContext.mockResolvedValue(cardContext("thread-root-1"));

    await sendPollMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:channel@thread.tacv2",
      question: "pick one",
      options: ["a", "b"],
    });

    const options = (
      mockState.sendMSTeamsActivityWithReference.mock.calls[0] as unknown[] | undefined
    )?.[3] as Record<string, unknown> | undefined;
    expect(options?.threadActivityId).toBe("thread-root-1");
  });
});

describe("MSTeams continueConversation failure handling", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
  });
});

describe("editMessageMSTeams", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
    mockState.updateMSTeamsActivityWithReference.mockReset();
    mockState.updateMSTeamsActivityWithReference.mockResolvedValue({ id: "updated" });
  });

  it("updates with the resolved Teams conversation reference", async () => {
    const mockUpdateActivity = vi.fn(async () => ({ id: "updated" }));
    const mockApp = createMockApp({ update: mockUpdateActivity });
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      app: mockApp,
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "personal" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: {},
    });

    const result = await editMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      activityId: "activity-123",
      text: "Updated message text",
    });

    expect(result.conversationId).toBe("19:conversation@thread.tacv2");

    expect(mockState.updateMSTeamsActivityWithReference).toHaveBeenCalledWith(
      mockApp,
      expect.objectContaining({
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "personal" },
        serviceUrl: "https://service.example.com",
      }),
      "activity-123",
      {
        type: "message",
        id: "activity-123",
        text: "Updated message text",
      },
      { serviceUrlBoundary: { cloud: "Public" } },
    );
  });

  it("throws a descriptive error when update fails", async () => {
    mockProactiveSendContextFailure("Service unavailable");

    await expect(
      editMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:conversation@thread.tacv2",
        activityId: "activity-123",
        text: "Updated text",
      }),
    ).rejects.toThrow("msteams edit failed");
  });
});

describe("deleteMessageMSTeams", () => {
  beforeEach(() => {
    mockState.resolveMSTeamsSendContext.mockReset();
    mockState.deleteMSTeamsActivityWithReference.mockReset();
    mockState.deleteMSTeamsActivityWithReference.mockResolvedValue(undefined);
  });

  it("deletes with the resolved Teams conversation reference", async () => {
    const mockDeleteActivity = vi.fn(async () => {});
    const mockApp = createMockApp({ delete: mockDeleteActivity });
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      app: mockApp,
      appId: "app-id",
      conversationId: "19:conversation@thread.tacv2",
      ref: {
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "groupChat" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "groupChat",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: {},
    });

    const result = await deleteMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conversation@thread.tacv2",
      activityId: "activity-456",
    });

    expect(result.conversationId).toBe("19:conversation@thread.tacv2");

    expect(mockState.deleteMSTeamsActivityWithReference).toHaveBeenCalledWith(
      mockApp,
      expect.objectContaining({
        conversation: { id: "19:conversation@thread.tacv2", conversationType: "groupChat" },
        serviceUrl: "https://service.example.com",
      }),
      "activity-456",
      { serviceUrlBoundary: { cloud: "Public" } },
    );
  });

  it("throws a descriptive error when delete fails", async () => {
    mockProactiveSendContextFailure("Not found");

    await expect(
      deleteMessageMSTeams({
        cfg: {} as OpenClawConfig,
        to: "conversation:19:conversation@thread.tacv2",
        activityId: "activity-456",
      }),
    ).rejects.toThrow("msteams delete failed");
  });

  it("uses app from the resolved context for delete operations", async () => {
    const mockDeleteActivity = vi.fn(async () => {});
    const mockApp = createMockApp({ delete: mockDeleteActivity });
    mockState.resolveMSTeamsSendContext.mockResolvedValue({
      app: mockApp,
      appId: "my-app-id",
      conversationId: "19:conv@thread.tacv2",
      ref: {
        activityId: "original-activity",
        user: { id: "user-1" },
        agent: { id: "agent-1" },
        conversation: { id: "19:conv@thread.tacv2" },
        channelId: "msteams",
      },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      conversationType: "personal",
      sdkCloudOptions: { cloud: "Public" },
      tokenProvider: {},
    });

    await deleteMessageMSTeams({
      cfg: {} as OpenClawConfig,
      to: "conversation:19:conv@thread.tacv2",
      activityId: "activity-789",
    });

    expect(mockState.deleteMSTeamsActivityWithReference).toHaveBeenCalledWith(
      mockApp,
      expect.objectContaining({
        conversation: { id: "19:conv@thread.tacv2" },
        serviceUrl: "https://service.example.com",
      }),
      "activity-789",
      { serviceUrlBoundary: { cloud: "Public" } },
    );
  });
});
