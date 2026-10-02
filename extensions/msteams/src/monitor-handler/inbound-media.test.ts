// Msteams tests cover inbound media plugin behavior.
import { describe, expect, it, vi } from "vitest";

vi.mock("../attachments.js", () => ({
  downloadMSTeamsAttachments: vi.fn(async () => []),
  downloadMSTeamsGraphMedia: vi.fn(async () => ({ media: [], failures: [] })),
  downloadMSTeamsBotFrameworkAttachments: vi.fn(async () => ({
    media: [],
    failures: [],
    attachmentCount: 0,
  })),
  buildMSTeamsGraphMessageUrls: vi.fn(() => [
    "https://graph.microsoft.com/v1.0/chats/c/messages/m",
  ]),
  extractMSTeamsHtmlAttachmentIds: vi.fn(() => ["att-0", "att-1"]),
  isBotFrameworkPersonalChatId: vi.fn((id: string | null | undefined) => {
    if (typeof id !== "string") {
      return false;
    }
    return id.startsWith("a:") || id.startsWith("8:orgid:");
  }),
}));

import {
  buildMSTeamsGraphMessageUrls,
  downloadMSTeamsAttachments,
  downloadMSTeamsBotFrameworkAttachments,
  downloadMSTeamsGraphMedia,
  extractMSTeamsHtmlAttachmentIds,
} from "../attachments.js";
import { resolveMSTeamsInboundMedia } from "./inbound-media.js";

const baseParams = {
  maxBytes: 1024 * 1024,
  tokenProvider: { getAccessToken: vi.fn(async () => "token") },
  conversationType: "personal",
  conversationId: "19:user_bot@unq.gbl.spaces",
  activity: { id: "msg-1", replyToId: undefined, channelData: {} },
  log: { debug: vi.fn() },
};

function firstGraphMediaCall() {
  const [call] = vi.mocked(downloadMSTeamsGraphMedia).mock.calls;
  if (!call) {
    throw new Error("expected Graph media download call");
  }
  return call[0];
}

function firstBotFrameworkAttachmentCall() {
  const [call] = vi.mocked(downloadMSTeamsBotFrameworkAttachments).mock.calls;
  if (!call) {
    throw new Error("expected Bot Framework attachment download call");
  }
  return call[0];
}

describe("resolveMSTeamsInboundMedia graph fallback trigger", () => {
  it("triggers Graph fallback when HTML contains <attachment> tags", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [{ path: "/tmp/img.png", contentType: "image/png", placeholder: "[image]" }],
      failures: [],
    });

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div>A file <attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(buildMSTeamsGraphMessageUrls).toHaveBeenCalled();
    expect(downloadMSTeamsGraphMedia).toHaveBeenCalled();
  });

  it("does NOT trigger Graph fallback for mention-only HTML (no <attachment> tags)", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    // Mention cards include `<at>` markers but no `<attachment id="...">`,
    // so the extractor returns an empty ID list. The fallback must skip.
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div><at id="0">Bot</at> hello there</div>',
        },
      ],
    });

    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
    expect(buildMSTeamsGraphMessageUrls).not.toHaveBeenCalled();
  });

  it("does NOT trigger Graph fallback when no attachments are text/html", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    // No HTML attachments at all → extractor returns [].
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      attachments: [
        { contentType: "image/png", contentUrl: "https://example.com/img.png" },
        { contentType: "application/pdf", contentUrl: "https://example.com/doc.pdf" },
      ],
    });

    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
  });

  it("does NOT trigger Graph fallback when direct download succeeds", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([
      { path: "/tmp/img.png", contentType: "image/png", placeholder: "[image]" },
    ]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
  });

  it("forwards log through to downloadMSTeamsGraphMedia for diagnostics", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({ media: [], failures: [] });
    const log = { debug: vi.fn() };

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      log,
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    const call = firstGraphMediaCall();
    // The monitor handler's logger is forwarded so graph.ts can report
    // message fetch failures instead of swallowing them (#51749).
    expect(call?.logger).toBe(log);
    expect(log.debug).toHaveBeenCalledWith("graph media fetch empty", {
      attempts: [
        {
          url: "https://graph.microsoft.com/v1.0/chats/c/messages/m",
          hostedStatus: undefined,
          attachmentStatus: undefined,
          hostedCount: undefined,
          attachmentCount: undefined,
          tokenError: undefined,
        },
      ],
      attachmentIdCount: 1,
    });
  });

  it("triggers Graph fallback even with no <attachment> tags when alwaysFetchGraphMessage is true", async () => {
    // Workaround for tenants where Bot Framework strips file refs from inbound
    // activities. The opt-in flag forces the Graph re-fetch
    // path so the bot can recover the file refs through Graph's view.
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [{ path: "/tmp/doc.pdf", contentType: "application/pdf", placeholder: "[file]" }],
      failures: [],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><at id="0">Bot</at> can you see my file?</div>',
        },
      ],
      alwaysFetchGraphMessage: true,
    });

    expect(buildMSTeamsGraphMessageUrls).toHaveBeenCalled();
    expect(downloadMSTeamsGraphMedia).toHaveBeenCalled();
    expect(result.media).toEqual([
      { path: "/tmp/doc.pdf", contentType: "application/pdf", placeholder: "[file]" },
    ]);
  });

  it("does NOT trigger Graph fallback when alwaysFetchGraphMessage is true but conversation is a personal BF chat", async () => {
    // The flag is a workaround for channel/group delivery quirks; personal
    // chats use the Bot Framework v3 attachments endpoint (Graph rejects 'a:'
    // chat IDs anyway), so the alwaysFetchGraphMessage gate must remain
    // scoped to non-personal conversations.
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "personal",
      conversationId: "a:bf-dm-id",
      attachments: [
        {
          contentType: "text/html",
          content: "<div>Hello</div>",
        },
      ],
      alwaysFetchGraphMessage: true,
    });

    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
    expect(buildMSTeamsGraphMessageUrls).not.toHaveBeenCalled();
  });

  it("does NOT trigger Graph fallback when alwaysFetchGraphMessage is undefined at this call boundary", async () => {
    // Callee-level contract: `resolveMSTeamsInboundMedia` treats an
    // explicitly-`undefined` flag as off. The message handler is what applies
    // the default (upstream: off; Boon fork: on via
    // `resolveMSTeamsAlwaysFetchGraphMessage`) before calling in here, so
    // this assertion stays valid regardless of the caller's default.
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><at id="0">Bot</at> hello</div>',
        },
      ],
      // alwaysFetchGraphMessage omitted intentionally
    });

    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
    expect(buildMSTeamsGraphMessageUrls).not.toHaveBeenCalled();
  });
});

describe("resolveMSTeamsInboundMedia failure reporting", () => {
  it("returns direct-download failures when nothing recovers the attachment", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    // No HTML attachment stub at all, so neither fallback runs — the direct
    // path's failures (reported via the onFailure callback) are all we have.
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);
    vi.mocked(downloadMSTeamsAttachments).mockImplementationOnce(async (params) => {
      params.onFailure?.({ name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" });
      return [];
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      attachments: [
        { contentType: "reference", contentUrl: "https://tenant.sharepoint.com/dragged.pdf" },
      ],
    });

    expect(result.media).toEqual([]);
    expect(result.failures).toEqual([
      { name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("keeps a disjoint earlier failure even once a later fallback succeeds (code-review finding)", async () => {
    // The direct-download attempt and the Graph fallback typically cover
    // DIFFERENT attachments (the fallback exists for files direct download
    // couldn't see at all) — a real failure for one file must not be erased
    // just because the fallback recovered an unrelated one.
    vi.mocked(downloadMSTeamsAttachments).mockImplementationOnce(async (params) => {
      params.onFailure?.({ name: "a.png", contentType: undefined, reason: "fetch_failed" });
      return [];
    });
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [{ path: "/tmp/doc.pdf", contentType: "application/pdf", placeholder: "[file]" }],
      failures: [],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toHaveLength(1);
    expect(result.failures).toEqual([
      { name: "a.png", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("preserves a sibling failure from a fallback batch that also partially succeeded", async () => {
    // Two files dragged in one message: the Graph re-fetch recovers one but
    // the other's /shares fetch 403s. The failure must not be discarded just
    // because the batch also returned some media (code-review finding).
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [{ path: "/tmp/a.pdf", contentType: "application/pdf", placeholder: "[file]" }],
      failures: [{ name: "b.pdf", contentType: undefined, reason: "fetch_failed" }],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toHaveLength(1);
    expect(result.failures).toEqual([
      { name: "b.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("preserves a sibling failure from a Bot Framework DM batch that also partially succeeded", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockResolvedValue({
      media: [{ path: "/tmp/a.pdf", contentType: "application/pdf", placeholder: "[file]" }],
      failures: [{ name: "b.pdf", contentType: undefined, reason: "fetch_failed" }],
      attachmentCount: 2,
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "personal",
      conversationId: "a:1dRsHCobZ1AxURzY05Dc",
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      attachments: [
        {
          contentType: "text/html",
          content: '<div>A file <attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toHaveLength(1);
    expect(result.failures).toEqual([
      { name: "b.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("dedupes an identical failure reported across multiple Graph messageUrl retries", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(buildMSTeamsGraphMessageUrls).mockReturnValueOnce([
      "https://graph.microsoft.com/v1.0/chats/c/messages/m1",
      "https://graph.microsoft.com/v1.0/chats/c/messages/m1/replies/m2",
    ]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [],
      failures: [{ name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" }],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toEqual([]);
    expect(result.failures).toEqual([
      { name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("dedupes a repeated failure batch even when a different-shaped batch comes between (code-review finding)", async () => {
    // buildMSTeamsGraphMessageUrls can emit more than two ID-guess variants
    // for the same underlying message; a stale/wrong ID guess in between two
    // correct ones must not reset the dedup so the correct guesses' shared
    // failure gets reported twice.
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(buildMSTeamsGraphMessageUrls).mockReturnValueOnce([
      "https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m1",
      "https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m2",
      "https://graph.microsoft.com/v1.0/teams/t/channels/c/messages/m1/replies/m1",
    ]);
    const sharedFailure = {
      name: "dragged.pdf",
      contentType: undefined,
      reason: "fetch_failed" as const,
    };
    const unrelatedFailure = {
      name: "other.pdf",
      contentType: undefined,
      reason: "fetch_failed" as const,
    };
    vi.mocked(downloadMSTeamsGraphMedia)
      .mockResolvedValueOnce({ media: [], failures: [sharedFailure] })
      .mockResolvedValueOnce({ media: [], failures: [unrelatedFailure] })
      .mockResolvedValueOnce({ media: [], failures: [sharedFailure] });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.failures).toEqual([sharedFailure, unrelatedFailure]);
  });

  it("keeps two genuinely distinct same-shaped failures from a single Graph call (code-review finding)", async () => {
    // Two oversized pasted images in one message both come back from
    // downloadGraphHostedContent as {name: undefined, contentType:
    // "image/png", reason: "too_large"} — identical in shape but two real,
    // separate lost files. A content-keyed dedupe must not collapse these
    // just because the messageUrl-retry dedupe above needs *some* key.
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(buildMSTeamsGraphMessageUrls).mockReturnValueOnce([
      "https://graph.microsoft.com/v1.0/chats/c/messages/m1",
    ]);
    const duplicateShapedFailure = {
      name: undefined,
      contentType: "image/png",
      reason: "too_large" as const,
    };
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [],
      failures: [duplicateShapedFailure, duplicateShapedFailure],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.failures).toEqual([duplicateShapedFailure, duplicateShapedFailure]);
  });

  it("surfaces Graph re-fetch failures when the fallback also comes up empty", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [],
      failures: [{ name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" }],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toEqual([]);
    expect(result.failures).toEqual([
      { name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("dedupes the same named failure reported by both the direct path and the Graph fallback (PR review finding)", async () => {
    // The flagship ENG-20968 scenario: a dragged SharePoint reference
    // attachment has a contentUrl, so isDownloadableAttachment (no
    // contentType check) lets the DIRECT path attempt and fail it first;
    // since mediaList is still empty, the Graph fallback then independently
    // rediscovers and re-fails the SAME attachment. Both are real, separate
    // attempts (not a retry-of-the-same-call artifact), so neither path's
    // own dedup catches it — this must be deduped where the two merge.
    vi.mocked(downloadMSTeamsAttachments).mockImplementationOnce(async (params) => {
      params.onFailure?.({ name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" });
      return [];
    });
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [],
      failures: [{ name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" }],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "reference",
          contentUrl: "https://tenant.sharepoint.com/dragged.pdf",
          name: "dragged.pdf",
        },
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.media).toEqual([]);
    expect(result.failures).toEqual([
      { name: "dragged.pdf", contentType: undefined, reason: "fetch_failed" },
    ]);
  });

  it("keeps two distinct unnamed failures from different paths (no name to collide on)", async () => {
    // The dedup above is scoped to named failures only — two genuinely
    // different unnamed failures (e.g. an oversized pasted image from each
    // path) must not be collapsed just because they share a shape.
    vi.mocked(downloadMSTeamsAttachments).mockImplementationOnce(async (params) => {
      params.onFailure?.({ name: undefined, contentType: "image/png", reason: "too_large" });
      return [];
    });
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce(["att-0"]);
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({
      media: [],
      failures: [{ name: undefined, contentType: "image/png", reason: "too_large" }],
    });

    const result = await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationType: "channel",
      conversationId: "19:abc@thread.tacv2",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(result.failures).toEqual([
      { name: undefined, contentType: "image/png", reason: "too_large" },
      { name: undefined, contentType: "image/png", reason: "too_large" },
    ]);
  });
});

describe("resolveMSTeamsInboundMedia bot framework DM routing", () => {
  const dmParams = {
    ...baseParams,
    conversationType: "personal",
    conversationId: "a:1dRsHCobZ1AxURzY05Dc",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
  };

  it("routes 'a:' conversation IDs through the Bot Framework attachment endpoint", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockClear();
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockResolvedValue({
      media: [
        {
          path: "/tmp/report.pdf",
          contentType: "application/pdf",
          placeholder: "<media:document>",
        },
      ],
      failures: [],
      attachmentCount: 1,
    });
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();

    const { media: mediaList } = await resolveMSTeamsInboundMedia({
      ...dmParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div>A file <attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(downloadMSTeamsBotFrameworkAttachments).toHaveBeenCalledTimes(1);
    const call = firstBotFrameworkAttachmentCall();
    expect(call?.serviceUrl).toBe(dmParams.serviceUrl);
    expect(call?.attachmentIds).toEqual(["att-0", "att-1"]);
    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
    expect(mediaList).toHaveLength(1);
    expect(mediaList[0].path).toBe("/tmp/report.pdf");
  });

  it("skips the Graph fallback entirely for 'a:' conversation IDs", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockClear();
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockResolvedValue({
      media: [],
      failures: [],
      attachmentCount: 1,
    });
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();

    await resolveMSTeamsInboundMedia({
      ...dmParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(downloadMSTeamsBotFrameworkAttachments).toHaveBeenCalled();
    expect(buildMSTeamsGraphMessageUrls).not.toHaveBeenCalled();
    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
  });

  it("does NOT call the Bot Framework endpoint for Graph-compatible '19:' IDs", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockClear();
    vi.mocked(downloadMSTeamsGraphMedia).mockResolvedValue({ media: [], failures: [] });

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      conversationId: "19:abc@thread.tacv2",
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(downloadMSTeamsBotFrameworkAttachments).not.toHaveBeenCalled();
    expect(downloadMSTeamsGraphMedia).toHaveBeenCalled();
  });

  it("skips BF DM attachment fetch entirely when HTML has no <attachment> tags", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockClear();
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    // Mention-only HTML (no `<attachment id="...">` tag) → extractor
    // returns []. The fallback skips both the Bot Framework and Graph
    // paths so we do not emit spurious 404 diagnostics (#58617).
    vi.mocked(extractMSTeamsHtmlAttachmentIds).mockReturnValueOnce([]);

    await resolveMSTeamsInboundMedia({
      ...dmParams,
      attachments: [
        {
          contentType: "text/html",
          content: '<div><at id="0">Bot</at> hello</div>',
        },
      ],
    });

    expect(downloadMSTeamsBotFrameworkAttachments).not.toHaveBeenCalled();
    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
  });

  it("logs when serviceUrl is missing for a BF DM with HTML content", async () => {
    vi.mocked(downloadMSTeamsAttachments).mockResolvedValue([]);
    vi.mocked(downloadMSTeamsBotFrameworkAttachments).mockClear();
    vi.mocked(downloadMSTeamsGraphMedia).mockClear();
    vi.mocked(buildMSTeamsGraphMessageUrls).mockClear();
    const log = { debug: vi.fn() };

    await resolveMSTeamsInboundMedia({
      ...baseParams,
      log,
      conversationType: "personal",
      conversationId: "a:bf-dm-id",
      attachments: [
        {
          contentType: "text/html",
          content: '<div><attachment id="att-0"></attachment></div>',
        },
      ],
    });

    expect(downloadMSTeamsBotFrameworkAttachments).not.toHaveBeenCalled();
    // Graph fallback is also skipped because the ID is 'a:'
    expect(downloadMSTeamsGraphMedia).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(
      "bot framework attachment skipped (missing serviceUrl)",
      {
        conversationType: "personal",
        conversationId: "a:bf-dm-id",
      },
    );
  });
});
