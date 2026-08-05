// Msteams plugin module implements messenger behavior.
import {
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
  type ChunkMode,
} from "openclaw/plugin-sdk/reply-chunking";
import {
  resolveSendableOutboundReplyParts,
  type ReplyPayload,
} from "openclaw/plugin-sdk/reply-payload";
import { normalizeOptionalLowercaseString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { sleep } from "openclaw/plugin-sdk/text-utility-runtime";
import { loadWebMedia } from "openclaw/plugin-sdk/web-media";
import type { MarkdownTableMode, MSTeamsReplyStyle, OpenClawConfig } from "../runtime-api.js";
import type { MSTeamsAccessTokenProvider } from "./attachments/types.js";
import type { MSTeamsSdkCloudOptions } from "./cloud.js";
import type { StoredConversationReference } from "./conversation-store.js";
import { classifyMSTeamsSendError } from "./errors.js";
import { prepareFileConsentActivity } from "./file-consent-helpers.js";
import {
  buildMSTeamsSharePointFileLinkText,
  buildMSTeamsUndeliverableFileNotice,
  MSTEAMS_MAX_MEDIA_BYTES,
  resolveMSTeamsOutboundFilePlan,
} from "./file-plan.js";
import { uploadAndShareSharePoint } from "./graph-upload.js";
import { extractFilename, extractMessageId, getMimeType, isLocalPath } from "./media-helpers.js";
import { parseMentions } from "./mentions.js";
import { setPendingUploadActivityId } from "./pending-uploads.js";
import { withRevokedProxyFallback } from "./revoked-context.js";
import { getMSTeamsRuntime } from "./runtime.js";
import {
  resolveMSTeamsThreadActivityId,
  sendMSTeamsActivityWithReference,
} from "./sdk-proactive.js";
import type { MSTeamsActivityLike } from "./sdk-types.js";
import type { MSTeamsApp } from "./sdk.js";

export type MSTeamsConversationReference = {
  activityId?: string;
  user?: { id?: string; name?: string; aadObjectId?: string };
  agent?: { id?: string; name?: string; aadObjectId?: string } | null;
  conversation: { id: string; conversationType?: string; tenantId?: string };
  channelId: string;
  serviceUrl?: string;
  locale?: string;
  /**
   * Top-level tenant ID echoed onto the Bot Framework connector request. Included
   * alongside `conversation.tenantId` so the connector can route proactive sends
   * to the correct Azure AD tenant. Missing it causes HTTP 403 on proactive
   * (bot-initiated) messages.
   */
  tenantId?: string;
  /**
   * Azure AD object ID of the target user, forwarded on proactive sends so
   * Bot Framework can resolve the personal DM recipient on the connector side.
   */
  aadObjectId?: string;
};

export type MSTeamsReplyRenderOptions = {
  textChunkLimit: number;
  chunkText?: boolean;
  mediaMode?: "split" | "inline";
  tableMode?: MarkdownTableMode;
  chunkMode?: ChunkMode;
};

/**
 * A rendered message that preserves media vs text distinction.
 * When mediaUrl is present, it will be sent as a Bot Framework attachment.
 */
export type MSTeamsRenderedMessage = {
  text?: string;
  mediaUrl?: string;
};

export type MSTeamsSendRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type MSTeamsSendRetryEvent = {
  messageIndex: number;
  messageCount: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  classification: ReturnType<typeof classifyMSTeamsSendError>;
};

function normalizeConversationId(rawId: string): string {
  return rawId.split(";")[0] ?? rawId;
}

export function buildConversationReference(
  ref: StoredConversationReference,
): MSTeamsConversationReference {
  const conversationId = ref.conversation?.id?.trim();
  if (!conversationId) {
    throw new Error("Invalid stored reference: missing conversation.id");
  }
  const agent = ref.agent ?? ref.bot ?? undefined;
  if (agent == null || !agent.id) {
    throw new Error("Invalid stored reference: missing agent.id");
  }
  const user = ref.user;
  if (!user?.id) {
    throw new Error("Invalid stored reference: missing user.id");
  }
  // Bot Framework proactive sends require `tenantId` on the outbound activity
  // so the connector routes to the correct Azure AD tenant; otherwise it rejects
  // with HTTP 403. Prefer the explicit top-level `ref.tenantId` (captured from
  // `channelData.tenant.id` inbound) and fall back to `conversation.tenantId`.
  const tenantId = ref.tenantId ?? ref.conversation?.tenantId;
  const aadObjectId = ref.aadObjectId ?? user.aadObjectId;
  return {
    activityId: ref.activityId,
    user: aadObjectId ? { ...user, aadObjectId } : user,
    agent,
    conversation: {
      id: normalizeConversationId(conversationId),
      conversationType: ref.conversation?.conversationType,
      tenantId,
    },
    channelId: ref.channelId ?? "msteams",
    serviceUrl: ref.serviceUrl,
    locale: ref.locale,
    ...(tenantId ? { tenantId } : {}),
    ...(aadObjectId ? { aadObjectId } : {}),
  };
}

function pushTextMessages(
  out: MSTeamsRenderedMessage[],
  text: string,
  opts: {
    chunkText: boolean;
    chunkLimit: number;
    chunkMode: ChunkMode;
  },
) {
  if (!text) {
    return;
  }
  if (opts.chunkText) {
    for (const chunk of getMSTeamsRuntime().channel.text.chunkMarkdownTextWithMode(
      text,
      opts.chunkLimit,
      opts.chunkMode,
    )) {
      const trimmed = chunk.trim();
      if (!trimmed || isSilentReplyText(trimmed, SILENT_REPLY_TOKEN)) {
        continue;
      }
      out.push({ text: trimmed });
    }
    return;
  }

  const trimmed = text.trim();
  if (!trimmed || isSilentReplyText(trimmed, SILENT_REPLY_TOKEN)) {
    return;
  }
  out.push({ text: trimmed });
}

function clampMs(value: number, maxMs: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(value, maxMs);
}

function resolveRetryOptions(
  retry: false | MSTeamsSendRetryOptions | undefined,
): Required<MSTeamsSendRetryOptions> & { enabled: boolean } {
  if (!retry) {
    return { enabled: false, maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
  }
  return {
    enabled: true,
    maxAttempts: Math.max(1, retry?.maxAttempts ?? 3),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? 250),
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? 10_000),
  };
}

function computeRetryDelayMs(
  attempt: number,
  classification: ReturnType<typeof classifyMSTeamsSendError>,
  opts: Required<MSTeamsSendRetryOptions>,
): number {
  if (classification.retryAfterMs != null) {
    return clampMs(classification.retryAfterMs, opts.maxDelayMs);
  }
  const exponential = opts.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return clampMs(exponential, opts.maxDelayMs);
}

function shouldRetry(classification: ReturnType<typeof classifyMSTeamsSendError>): boolean {
  return classification.kind === "throttled" || classification.kind === "transient";
}

export function renderReplyPayloadsToMessages(
  replies: ReplyPayload[],
  options: MSTeamsReplyRenderOptions,
): MSTeamsRenderedMessage[] {
  const out: MSTeamsRenderedMessage[] = [];
  const chunkLimit = Math.min(options.textChunkLimit, 4000);
  const chunkText = options.chunkText !== false;
  const chunkMode = options.chunkMode ?? "length";
  const mediaMode = options.mediaMode ?? "split";
  const tableMode =
    options.tableMode ??
    getMSTeamsRuntime().channel.text.resolveMarkdownTableMode({
      cfg: getMSTeamsRuntime().config.current() as OpenClawConfig,
      channel: "msteams",
    });

  for (const payload of replies) {
    const reply = resolveSendableOutboundReplyParts(payload, {
      text: getMSTeamsRuntime().channel.text.convertMarkdownTables(payload.text ?? "", tableMode),
    });

    if (!reply.hasContent) {
      continue;
    }

    if (!reply.hasMedia) {
      pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
      continue;
    }

    if (mediaMode === "inline") {
      // For inline mode, combine text with first media as attachment
      const firstMedia = reply.mediaUrls[0];
      if (firstMedia) {
        out.push({ text: reply.text || undefined, mediaUrl: firstMedia });
        // Additional media URLs as separate messages
        for (let i = 1; i < reply.mediaUrls.length; i++) {
          if (reply.mediaUrls[i]) {
            out.push({ mediaUrl: reply.mediaUrls[i] });
          }
        }
      } else {
        pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
      }
      continue;
    }

    // mediaMode === "split"
    pushTextMessages(out, reply.text, { chunkText, chunkLimit, chunkMode });
    for (const mediaUrl of reply.mediaUrls) {
      if (!mediaUrl) {
        continue;
      }
      out.push({ mediaUrl });
    }
  }

  return out;
}

import { AI_GENERATED_ENTITY } from "./ai-entity.js";

export async function buildActivity(
  msg: MSTeamsRenderedMessage,
  conversationRef: StoredConversationReference,
  tokenProvider?: MSTeamsAccessTokenProvider,
  sharePointSiteId?: string,
  mediaMaxBytes?: number,
  options?: { feedbackLoopEnabled?: boolean },
): Promise<Record<string, unknown>> {
  const activity: Record<string, unknown> = { type: "message" };

  // Mark as AI-generated so Teams renders the "AI generated" badge.
  activity.channelData = {
    feedbackLoopEnabled: options?.feedbackLoopEnabled ?? false,
  };

  if (msg.text) {
    // Parse mentions from text (format: @[Name](id))
    const { text: formattedText, entities } = parseMentions(msg.text);
    activity.text = formattedText;

    // Start with mention entities (if any) + AI-generated entity
    activity.entities = [...(entities.length > 0 ? entities : []), AI_GENERATED_ENTITY];
  } else {
    activity.entities = [AI_GENERATED_ENTITY];
  }

  if (msg.mediaUrl) {
    // A data: URL is already-resolved inline media — e.g. send.ts's own
    // inline-image plan branch builds one and routes it back through this
    // same reply path via sendTextWithMedia/sendMSTeamsMessages. loadWebMedia
    // only understands http(s) and local file paths; anything else falls
    // into its local-path branch and tries (and fails) to read the data: URL
    // as a filesystem path. Attach it directly instead of reprocessing it.
    if (msg.mediaUrl.startsWith("data:")) {
      activity.attachments = [
        {
          name: await extractFilename(msg.mediaUrl),
          contentType: await getMimeType(msg.mediaUrl),
          contentUrl: msg.mediaUrl,
        },
      ];
      return activity;
    }

    // Route local paths and remote URLs through the same download-and-decide
    // pipeline (loadWebMedia handles both). A local/remote split here used to
    // let remote media (e.g. a link to a generated report) skip consent/
    // upload handling entirely and get attached raw, which Teams does not
    // render for non-image attachments.
    const maxBytes = mediaMaxBytes ?? MSTEAMS_MAX_MEDIA_BYTES;
    const media = await loadWebMedia(msg.mediaUrl, maxBytes);
    const contentType = media.contentType ?? (await getMimeType(msg.mediaUrl));
    const fileName = media.fileName ?? (await extractFilename(msg.mediaUrl));

    const conversationType = normalizeOptionalLowercaseString(
      conversationRef.conversation?.conversationType,
    );

    const plan = resolveMSTeamsOutboundFilePlan({
      conversationType,
      contentType,
      bufferSize: media.buffer.length,
      sharePointSiteId,
      hasTokenProvider: Boolean(tokenProvider),
    });

    if (plan.kind === "consent") {
      // Large file or non-image in personal chat: use FileConsentCard flow
      const conversationId = conversationRef.conversation?.id ?? "unknown";
      const { activity: consentActivity, uploadId } = prepareFileConsentActivity({
        media: { buffer: media.buffer, filename: fileName, contentType },
        conversationId,
        description: msg.text || undefined,
      });

      // Tag the activity so the caller can store the activity ID after sending
      consentActivity["_pendingUploadId"] = uploadId;

      // Return the consent activity (caller sends it)
      return consentActivity;
    }

    if (plan.kind === "sharepoint-upload") {
      // Non-image in group chat/channel with SharePoint site configured:
      // Upload to SharePoint and use native file card attachment.
      // Use the cached Graph-native chat ID when available — Bot Framework conversation IDs
      // for personal DMs use a format (e.g. `a:1xxx`) that Graph API rejects.
      const chatId = conversationRef.graphChatId ?? conversationRef.conversation?.id;

      // resolveMSTeamsOutboundFilePlan only returns "sharepoint-upload" when
      // hasTokenProvider (computed from this same tokenProvider) was true.
      const activeTokenProvider = tokenProvider as MSTeamsAccessTokenProvider;
      const uploaded = await uploadAndShareSharePoint({
        buffer: media.buffer,
        filename: fileName,
        contentType,
        tokenProvider: activeTokenProvider,
        siteId: plan.siteId,
        chatId: chatId ?? undefined,
        usePerUserSharing: conversationType === "groupchat",
      });

      activity.text = buildMSTeamsSharePointFileLinkText({
        name: uploaded.name,
        shareUrl: uploaded.shareUrl,
        precedingText: typeof activity.text === "string" ? activity.text : undefined,
      });

      return activity;
    }

    if (plan.kind === "inline-image") {
      // Image (any chat): use base64 (works for images in all conversation types)
      const base64 = media.buffer.toString("base64");
      activity.attachments = [
        { name: fileName, contentType, contentUrl: `data:${contentType};base64,${base64}` },
      ];
      return activity;
    }

    // plan.kind === "undeliverable"
    activity.text = buildMSTeamsUndeliverableFileNotice({
      fileName,
      reason: plan.reason,
      sourceUrl: isLocalPath(msg.mediaUrl) ? undefined : msg.mediaUrl,
      precedingText: typeof activity.text === "string" ? activity.text : undefined,
    });
    return activity;
  }

  return activity;
}

export async function sendMSTeamsMessages(params: {
  replyStyle: MSTeamsReplyStyle;
  app: MSTeamsApp;
  appId: string;
  conversationRef: StoredConversationReference;
  context?: { sendActivity: (activity: MSTeamsActivityLike) => Promise<unknown> };
  messages: MSTeamsRenderedMessage[];
  retry?: false | MSTeamsSendRetryOptions;
  onRetry?: (event: MSTeamsSendRetryEvent) => void;
  /** Token provider for OneDrive/SharePoint uploads in group chats/channels */
  tokenProvider?: MSTeamsAccessTokenProvider;
  /** SharePoint site ID for file uploads in group chats/channels */
  sharePointSiteId?: string;
  /** Max media size in bytes. Default: 100MB. */
  mediaMaxBytes?: number;
  /** Enable the Teams feedback loop (thumbs up/down) on sent messages. */
  feedbackLoopEnabled?: boolean;
  serviceUrlBoundary?: MSTeamsSdkCloudOptions;
}): Promise<string[]> {
  const messages = params.messages.filter(
    (m) => (m.text && m.text.trim().length > 0) || m.mediaUrl,
  );
  if (messages.length === 0) {
    return [];
  }

  const retryOptions = resolveRetryOptions(params.retry);

  const sendWithRetry = async (
    sendOnce: () => Promise<unknown>,
    meta: { messageIndex: number; messageCount: number },
  ): Promise<unknown> => {
    if (!retryOptions.enabled) {
      return await sendOnce();
    }

    for (const attempt of Array.from(
      { length: retryOptions.maxAttempts },
      (_, index) => index + 1,
    )) {
      try {
        return await sendOnce();
      } catch (err) {
        const classification = classifyMSTeamsSendError(err);
        const canRetry = attempt < retryOptions.maxAttempts && shouldRetry(classification);
        if (!canRetry) {
          throw err;
        }

        const delayMs = computeRetryDelayMs(attempt, classification, retryOptions);
        const nextAttempt = attempt + 1;
        params.onRetry?.({
          messageIndex: meta.messageIndex,
          messageCount: meta.messageCount,
          nextAttempt,
          maxAttempts: retryOptions.maxAttempts,
          delayMs,
          classification,
        });

        await sleep(delayMs);
      }
    }
    throw new Error("unreachable Teams send retry loop exit");
  };

  const sendMessageInContext = async (
    sendFn: (activity: MSTeamsActivityLike) => Promise<unknown>,
    message: MSTeamsRenderedMessage,
    messageIndex: number,
  ): Promise<string> => {
    let pendingUploadId: string | undefined;
    const response = await sendWithRetry(
      async () => {
        const activity = await buildActivity(
          message,
          params.conversationRef,
          params.tokenProvider,
          params.sharePointSiteId,
          params.mediaMaxBytes,
          { feedbackLoopEnabled: params.feedbackLoopEnabled },
        );

        // Extract and strip the internal-only pending upload tag before sending.
        pendingUploadId =
          typeof activity["_pendingUploadId"] === "string"
            ? activity["_pendingUploadId"]
            : undefined;
        if (pendingUploadId) {
          delete activity["_pendingUploadId"];
        }

        return await sendFn(activity);
      },
      {
        messageIndex,
        messageCount: messages.length,
      },
    );
    const messageId = extractMessageId(response) ?? "unknown";

    // Store the activity ID so the accept handler can replace the consent card in-place
    if (pendingUploadId && messageId !== "unknown") {
      setPendingUploadActivityId(pendingUploadId, messageId);
    }

    return messageId;
  };

  const sendMessageBatchInContext = async (
    sendFn: (activity: MSTeamsActivityLike) => Promise<unknown>,
    batch: MSTeamsRenderedMessage[],
    startIndex: number,
  ): Promise<string[]> => {
    const messageIds: string[] = [];
    for (const [idx, message] of batch.entries()) {
      messageIds.push(await sendMessageInContext(sendFn, message, startIndex + idx));
    }
    return messageIds;
  };

  // Resolved once so the thread branch, the revoked-context fallback, and the
  // top-level branch cannot drift on the same decision.
  const threadActivityId = resolveMSTeamsThreadActivityId({
    ref: params.conversationRef,
    replyStyle: params.replyStyle,
  });

  const sendProactively = async (
    batch: MSTeamsRenderedMessage[],
    startIndex: number,
  ): Promise<string[]> => {
    const baseRef = buildConversationReference(params.conversationRef);
    const sendFn = (activity: MSTeamsActivityLike) =>
      sendMSTeamsActivityWithReference(params.app, baseRef, activity, {
        threadActivityId,
        serviceUrlBoundary: params.serviceUrlBoundary,
      });
    return await sendMessageBatchInContext(sendFn, batch, startIndex);
  };

  if (params.replyStyle === "thread") {
    const ctx = params.context;
    if (!ctx) {
      return await sendProactively(messages, 0);
    }
    const sendFn = ctx.sendActivity;
    const messageIds: string[] = [];
    for (const [idx, message] of messages.entries()) {
      const result = await withRevokedProxyFallback({
        run: async () => ({
          ids: [await sendMessageInContext(sendFn, message, idx)],
          fellBack: false,
        }),
        onRevoked: async () => {
          // When the live turn context is revoked (e.g. debounced messages),
          // reconstruct the threaded conversation ID so the proactive
          // fallback delivers the reply into the correct channel thread.
          const remaining = messages.slice(idx);
          return {
            ids: remaining.length > 0 ? await sendProactively(remaining, idx) : [],
            fellBack: true,
          };
        },
      });
      messageIds.push(...result.ids);
      if (result.fellBack) {
        return messageIds;
      }
    }
    return messageIds;
  }

  // replyStyle === "top-level" — resolveMSTeamsThreadActivityId already returned
  // undefined, so no thread suffix is attached even when the ref has a threadId.
  return await sendProactively(messages, 0);
}
