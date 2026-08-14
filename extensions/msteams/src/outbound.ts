// Msteams plugin module implements outbound behavior.
import {
  resolveOutboundSendDep,
  type OutboundSendDeps,
} from "openclaw/plugin-sdk/channel-outbound";
import {
  attachChannelToResult,
  createAttachedChannelResultAdapter,
} from "openclaw/plugin-sdk/channel-send-result";
import {
  resolvePayloadMediaUrls,
  resolveTextChunksWithFallback,
  sendPayloadMediaSequence,
} from "openclaw/plugin-sdk/reply-payload";
import {
  chunkTextForOutbound,
  normalizeStringEntries,
  type ChannelOutboundAdapter,
} from "../runtime-api.js";
import { createMSTeamsPollStoreState } from "./polls.js";
import { buildMSTeamsPresentationCard, MSTEAMS_PRESENTATION_CAPABILITIES } from "./presentation.js";
import { sendAdaptiveCardMSTeams, sendMessageMSTeams, sendPollMSTeams } from "./send.js";

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MSTEAMS_TEXT_CHUNK_LIMIT = 4000;

type MSTeamsSendConfig = Parameters<typeof sendMessageMSTeams>[0]["cfg"];
type MSTeamsReplyStyleOverride = Parameters<typeof sendMessageMSTeams>[0]["replyStyleOverride"];
type MSTeamsSendResult = { messageId: string; conversationId: string };
type MSTeamsTextSendOptions = {
  replyStyleOverride?: MSTeamsReplyStyleOverride;
};
type MSTeamsMediaSendOptions = {
  mediaUrl?: string;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  replyStyleOverride?: MSTeamsReplyStyleOverride;
};
type MSTeamsTextSendFn = (
  to: string,
  text: string,
  opts?: MSTeamsTextSendOptions,
) => Promise<MSTeamsSendResult>;
type MSTeamsMediaSendFn = (
  to: string,
  text: string,
  opts?: MSTeamsMediaSendOptions,
) => Promise<MSTeamsSendResult>;

// Core outbound carries a portable tri-state `threadSuppressed` intent
// (set by a scheduled cron's replyStyle, or the message tool's topLevel param).
// The msteams adapter is the only place that maps it to a per-send replyStyle
// override — core stays channel-agnostic. `true` forces a top-level channel post;
// `false` forces threading even when the channel/global default is top-level;
// `undefined` leaves the resolved default untouched.
function resolveReplyStyleOverride(threadSuppressed?: boolean): MSTeamsReplyStyleOverride {
  if (threadSuppressed === true) {
    return "top-level";
  }
  if (threadSuppressed === false) {
    return "thread";
  }
  return undefined;
}

function resolveMSTeamsTextSend(params: {
  cfg: MSTeamsSendConfig;
  deps?: OutboundSendDeps;
}): MSTeamsTextSendFn {
  return (
    resolveOutboundSendDep<MSTeamsTextSendFn>(params.deps, "msteams") ??
    ((to, text, opts) =>
      sendMessageMSTeams({
        cfg: params.cfg,
        to,
        text,
        ...(opts?.replyStyleOverride ? { replyStyleOverride: opts.replyStyleOverride } : {}),
      }))
  );
}

function resolveMSTeamsMediaSend(params: {
  cfg: MSTeamsSendConfig;
  deps?: OutboundSendDeps;
}): MSTeamsMediaSendFn {
  return (
    resolveOutboundSendDep<MSTeamsMediaSendFn>(params.deps, "msteams") ??
    ((to, text, opts) =>
      sendMessageMSTeams({
        cfg: params.cfg,
        to,
        text,
        mediaUrl: opts?.mediaUrl,
        mediaLocalRoots: opts?.mediaLocalRoots,
        mediaReadFile: opts?.mediaReadFile,
        ...(opts?.replyStyleOverride ? { replyStyleOverride: opts.replyStyleOverride } : {}),
      }))
  );
}

export const msteamsOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: chunkTextForOutbound,
  chunkerMode: "markdown",
  textChunkLimit: MSTEAMS_TEXT_CHUNK_LIMIT,
  pollMaxOptions: 12,
  deliveryCapabilities: {
    durableFinal: {
      text: true,
      media: true,
      payload: true,
      messageSendingHooks: true,
    },
  },
  presentationCapabilities: MSTEAMS_PRESENTATION_CAPABILITIES,
  renderPresentation: ({ payload, presentation }) => {
    if (payload.mediaUrl || payload.mediaUrls?.length) {
      return null;
    }
    const card = buildMSTeamsPresentationCard({
      presentation,
      text: payload.text,
    });
    const msteamsData = asObjectRecord(payload.channelData?.msteams) ?? {};
    return {
      ...payload,
      channelData: {
        ...payload.channelData,
        msteams: {
          ...msteamsData,
          presentationCard: card,
        },
      },
    };
  },
  sendPayload: async ({
    cfg,
    to,
    text,
    mediaUrl,
    mediaLocalRoots,
    mediaReadFile,
    payload,
    deps,
    threadSuppressed,
  }) => {
    const replyStyleOverride = resolveReplyStyleOverride(threadSuppressed);
    const msteamsData = asObjectRecord(payload.channelData?.msteams);
    const presentationCard = msteamsData?.presentationCard;
    if (
      presentationCard &&
      typeof presentationCard === "object" &&
      !Array.isArray(presentationCard)
    ) {
      const result = await sendAdaptiveCardMSTeams({
        cfg,
        to,
        card: presentationCard as Record<string, unknown>,
        ...(replyStyleOverride ? { replyStyleOverride } : {}),
      });
      return attachChannelToResult("msteams", result);
    }
    const mediaUrls = normalizeStringEntries(
      resolvePayloadMediaUrls({
        ...payload,
        mediaUrl: payload.mediaUrl ?? mediaUrl,
      }),
    );
    if (mediaUrls.length > 0) {
      const send = resolveMSTeamsMediaSend({ cfg, deps });
      const result = await sendPayloadMediaSequence({
        text,
        mediaUrls,
        send: async ({ text: textLocal, mediaUrl: mediaUrlLocal }) =>
          await send(to, textLocal, {
            mediaUrl: mediaUrlLocal,
            mediaLocalRoots,
            mediaReadFile,
            replyStyleOverride,
          }),
      });
      if (result) {
        return attachChannelToResult("msteams", result);
      }
    }
    if (text.trim()) {
      const send = resolveMSTeamsTextSend({ cfg, deps });
      const chunks = resolveTextChunksWithFallback(
        text,
        chunkTextForOutbound(text, MSTEAMS_TEXT_CHUNK_LIMIT),
      );
      let result: Awaited<ReturnType<MSTeamsTextSendFn>>;
      for (const chunk of chunks) {
        result = await send(to, chunk, { replyStyleOverride });
      }
      return attachChannelToResult("msteams", result!);
    }
    throw new Error("MS Teams payload send requires text, media, or a presentation card.");
  },
  ...createAttachedChannelResultAdapter({
    channel: "msteams",
    sendText: async ({ cfg, to, text, deps, threadSuppressed }) => {
      const send = resolveMSTeamsTextSend({ cfg, deps });
      return await send(to, text, {
        replyStyleOverride: resolveReplyStyleOverride(threadSuppressed),
      });
    },
    sendMedia: async ({
      cfg,
      to,
      text,
      mediaUrl,
      mediaLocalRoots,
      mediaReadFile,
      deps,
      threadSuppressed,
    }) => {
      const send = resolveMSTeamsMediaSend({ cfg, deps });
      return await send(to, text, {
        mediaUrl,
        mediaLocalRoots,
        mediaReadFile,
        replyStyleOverride: resolveReplyStyleOverride(threadSuppressed),
      });
    },
    sendPoll: async ({ cfg, to, poll }) => {
      const maxSelections = poll.maxSelections ?? 1;
      const result = await sendPollMSTeams({
        cfg,
        to,
        question: poll.question,
        options: poll.options,
        maxSelections,
      });
      const pollStore = createMSTeamsPollStoreState();
      await pollStore.createPoll({
        id: result.pollId,
        question: poll.question,
        options: poll.options,
        maxSelections,
        createdAt: new Date().toISOString(),
        conversationId: result.conversationId,
        messageId: result.messageId,
        votes: {},
      });
      return result;
    },
  }),
};
