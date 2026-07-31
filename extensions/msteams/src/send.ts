// Msteams plugin module implements send behavior.
import {
  createMessageReceiptFromOutboundResults,
  type MessageReceipt,
  type MessageReceiptPartKind,
} from "openclaw/plugin-sdk/channel-outbound";
import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/markdown-table-runtime";
import { convertMarkdownTables } from "openclaw/plugin-sdk/text-chunking";
import {
  loadOutboundMediaFromUrl,
  type MSTeamsReplyStyle,
  type OpenClawConfig,
} from "../runtime-api.js";
import {
  classifyMSTeamsSendError,
  formatMSTeamsErrorDetail,
  formatMSTeamsSendErrorHint,
} from "./errors.js";
import { prepareFileConsentActivityFs, requiresFileConsent } from "./file-consent-helpers.js";
import { uploadAndShareOneDrive, uploadAndShareSharePoint } from "./graph-upload.js";
import { extractFilename, extractMessageId } from "./media-helpers.js";
import { buildConversationReference, sendMSTeamsMessages } from "./messenger.js";
import { setPendingUploadActivityIdFs } from "./pending-uploads-fs.js";
import { setPendingUploadActivityId } from "./pending-uploads.js";
import { buildMSTeamsPollCard } from "./polls.js";
import {
  deleteMSTeamsActivityWithReference,
  sendMSTeamsActivityWithReference,
  updateMSTeamsActivityWithReference,
} from "./sdk-proactive.js";
import { resolveMSTeamsSendContext, type MSTeamsProactiveContext } from "./send-context.js";

type SendMSTeamsMessageParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID or user ID to send to */
  to: string;
  /** Message text */
  text: string;
  /** Optional media URL */
  mediaUrl?: string;
  /** Optional filename override for uploaded media/files */
  filename?: string;
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
  /**
   * Per-send replyStyle override. When set, overrides the resolved
   * channel/global replyStyle for this send only — lets a scheduled cron post a
   * fresh top-level channel message while interactive conversations stay threaded.
   */
  replyStyleOverride?: MSTeamsReplyStyle;
};

type SendMSTeamsMessageResult = {
  messageId: string;
  conversationId: string;
  receipt: MessageReceipt;
  /** If a FileConsentCard was sent instead of the file, this contains the upload ID */
  pendingUploadId?: string;
};

/** Threshold for large files that require FileConsentCard flow in personal chats */
const FILE_CONSENT_THRESHOLD_BYTES = 4 * 1024 * 1024; // 4MB

/**
 * MSTeams-specific media size limit (100MB).
 * Higher than the default because OneDrive upload handles large files well.
 */
const MSTEAMS_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function createMSTeamsSendResult(params: {
  conversationId: string;
  messageId: string;
  platformMessageIds?: readonly string[];
  kind: MessageReceiptPartKind;
  pendingUploadId?: string;
}): SendMSTeamsMessageResult {
  const platformMessageIds = (
    params.platformMessageIds?.length ? [...params.platformMessageIds] : [params.messageId]
  )
    .map((messageId) => messageId.trim())
    .filter((messageId) => messageId && messageId !== "unknown");
  return {
    messageId: params.messageId,
    conversationId: params.conversationId,
    receipt: createMessageReceiptFromOutboundResults({
      kind: params.kind,
      results: platformMessageIds.map((messageId) => ({
        channel: "msteams",
        messageId,
        conversationId: params.conversationId,
      })),
    }),
    ...(params.pendingUploadId ? { pendingUploadId: params.pendingUploadId } : {}),
  };
}

type SendMSTeamsPollParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID or user ID to send to */
  to: string;
  /** Poll question */
  question: string;
  /** Poll options */
  options: string[];
  /** Max selections (defaults to 1) */
  maxSelections?: number;
};

type SendMSTeamsPollResult = {
  pollId: string;
  messageId: string;
  conversationId: string;
};

type SendMSTeamsCardParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID or user ID to send to */
  to: string;
  /** Adaptive Card JSON object */
  card: Record<string, unknown>;
  /**
   * Per-send replyStyle override; see SendMSTeamsMessageParams.replyStyleOverride.
   * Carries the message tool's `topLevel` / cron `replyStyle` intent for
   * presentation-card sends.
   */
  replyStyleOverride?: MSTeamsReplyStyle;
};

type SendMSTeamsCardResult = {
  messageId: string;
  conversationId: string;
};

/**
 * Send a message to a Teams conversation or user.
 *
 * Uses the stored ConversationReference from previous interactions.
 * The bot must have received at least one message from the conversation
 * before proactive messaging works.
 *
 * File handling by conversation type:
 * - Personal (1:1) chats: small images (<4MB) use base64, large files and non-images use FileConsentCard
 * - Group chats / channels: files are uploaded to OneDrive and shared via link
 */
export async function sendMessageMSTeams(
  params: SendMSTeamsMessageParams,
): Promise<SendMSTeamsMessageResult> {
  const { cfg, to, text, mediaUrl, filename, mediaLocalRoots, mediaReadFile, replyStyleOverride } =
    params;
  const tableMode = resolveMarkdownTableMode({
    cfg,
    channel: "msteams",
  });
  const messageText = convertMarkdownTables(text ?? "", tableMode);
  const ctx = await resolveMSTeamsSendContext({ cfg, to, replyStyleOverride });
  const { conversationId, log, conversationType, tokenProvider, sharePointSiteId } = ctx;

  log.debug?.("sending proactive message", {
    conversationId,
    conversationType,
    textLength: messageText.length,
    hasMedia: Boolean(mediaUrl),
  });

  // Handle media if present
  if (mediaUrl) {
    const mediaMaxBytes = ctx.mediaMaxBytes ?? MSTEAMS_MAX_MEDIA_BYTES;
    const media = await loadOutboundMediaFromUrl(mediaUrl, {
      maxBytes: mediaMaxBytes,
      mediaLocalRoots,
      mediaReadFile,
    });
    const isLargeFile = media.buffer.length >= FILE_CONSENT_THRESHOLD_BYTES;
    const isImage = media.contentType?.startsWith("image/") ?? false;
    const fallbackFileName = await extractFilename(mediaUrl);
    const fileName = filename?.trim() || media.fileName || fallbackFileName;

    log.debug?.("processing media", {
      fileName,
      contentType: media.contentType,
      size: media.buffer.length,
      isLargeFile,
      isImage,
      conversationType,
    });

    // Personal chats: base64 only works for images; use FileConsentCard for large files or non-images
    if (
      requiresFileConsent({
        conversationType,
        contentType: media.contentType,
        bufferSize: media.buffer.length,
        thresholdBytes: FILE_CONSENT_THRESHOLD_BYTES,
      })
    ) {
      // Proactive CLI sends run in a different process from the gateway's
      // monitor that receives the fileConsent/invoke callback. Use the FS-
      // backed helper so the invoke handler can find the pending upload when
      // the user clicks "Allow".
      const { activity, uploadId } = await prepareFileConsentActivityFs({
        media: { buffer: media.buffer, filename: fileName, contentType: media.contentType },
        conversationId,
        description: messageText || undefined,
      });

      log.debug?.("sending file consent card", { uploadId, fileName, size: media.buffer.length });

      const messageId = await sendProactiveActivity(ctx, activity, "msteams consent card send");

      // Store the activity ID so the accept handler can replace the consent
      // card in-place. Mirror it into the FS store too because the invoke
      // callback may be delivered to a different process than the CLI send.
      setPendingUploadActivityId(uploadId, messageId);
      await setPendingUploadActivityIdFs(uploadId, messageId);

      log.info("sent file consent card", { conversationId, messageId, uploadId });

      return createMSTeamsSendResult({
        messageId,
        conversationId,
        kind: "card",
        pendingUploadId: uploadId,
      });
    }

    // Personal chat with small image: use base64 (only works for images)
    if (conversationType === "personal") {
      // Small image in personal chat: use base64 (only works for images)
      const base64 = media.buffer.toString("base64");
      const finalMediaUrl = `data:${media.contentType};base64,${base64}`;

      return sendTextWithMedia(ctx, messageText, finalMediaUrl);
    }

    if (isImage && !sharePointSiteId) {
      // Group chat/channel without SharePoint: send image inline (avoids OneDrive failures)
      const base64 = media.buffer.toString("base64");
      const finalMediaUrl = `data:${media.contentType};base64,${base64}`;
      return sendTextWithMedia(ctx, messageText, finalMediaUrl);
    }

    // Group chat or channel: upload to SharePoint (if siteId configured) or OneDrive
    log.debug?.("uploading file for link send", {
      fileName,
      conversationType,
      target: sharePointSiteId ? "sharepoint" : "onedrive",
    });

    let fileText: string;
    try {
      const uploaded = sharePointSiteId
        ? await uploadAndShareSharePoint({
            buffer: media.buffer,
            filename: fileName,
            contentType: media.contentType,
            tokenProvider,
            siteId: sharePointSiteId,
            // Use the Graph-native chat ID (19:xxx format) — the Bot Framework conversationId
            // for personal DMs uses a different format that Graph API rejects.
            chatId: ctx.graphChatId ?? conversationId,
            usePerUserSharing: conversationType === "groupChat",
          })
        : await uploadAndShareOneDrive({
            buffer: media.buffer,
            filename: fileName,
            contentType: media.contentType,
            tokenProvider,
          });

      log.debug?.("file upload complete", {
        itemId: uploaded.itemId,
        shareUrl: uploaded.shareUrl,
      });

      // Bot Framework file-info cards render as a broken "chiclet" (400 on
      // file.info) in this tenant, and it has no sendable "reference" attachment
      // type — post a markdown link to the shared item instead.
      const fileLink = `📎 [${uploaded.name}](${uploaded.shareUrl})`;
      fileText = messageText ? `${messageText}\n\n${fileLink}` : fileLink;
    } catch (err) {
      const classification = classifyMSTeamsSendError(err);
      const hint = formatMSTeamsSendErrorHint(classification);
      const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
      throw new Error(
        `msteams file send failed${status}: ${formatMSTeamsErrorDetail(err)}${hint ? ` (${hint})` : ""}`,
        { cause: err },
      );
    }

    // Deliberately outside the try: sendTextWithMedia wraps its own send errors,
    // and the file-send catch above would double-wrap them. Threading lives in
    // sendMSTeamsMessages — a raw proactive send here would drop the
    // `;messageid=` suffix and post the file link at channel root (ENG-17134).
    return await sendTextWithMedia(ctx, fileText, undefined, "media");
  }

  // No media: send text only
  return sendTextWithMedia(ctx, messageText, undefined);
}

/**
 * Send a text message with optional base64 media URL.
 *
 * `receiptKind` overrides the derived receipt kind so uploaded-file link sends
 * (text on the wire, a file to the user) keep reporting `"media"`.
 */
async function sendTextWithMedia(
  ctx: MSTeamsProactiveContext,
  text: string,
  mediaUrl: string | undefined,
  receiptKind?: MessageReceiptPartKind,
): Promise<SendMSTeamsMessageResult> {
  const {
    app,
    appId,
    conversationId,
    ref,
    log,
    tokenProvider,
    sharePointSiteId,
    mediaMaxBytes,
    replyStyle,
  } = ctx;

  let platformMessageIds: string[];
  try {
    platformMessageIds = await sendMSTeamsMessages({
      replyStyle,
      app,
      appId,
      conversationRef: ref,
      messages: [{ text: text || undefined, mediaUrl }],
      retry: {},
      onRetry: (event) => {
        log.debug?.("retrying send", { conversationId, ...event });
      },
      tokenProvider,
      sharePointSiteId,
      mediaMaxBytes,
      serviceUrlBoundary: ctx.sdkCloudOptions,
    });
  } catch (err) {
    const classification = classifyMSTeamsSendError(err);
    const hint = formatMSTeamsSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `msteams send failed${status}: ${formatMSTeamsErrorDetail(err)}${hint ? ` (${hint})` : ""}`,
      { cause: err },
    );
  }

  const messageId = platformMessageIds[0] ?? "unknown";
  log.info("sent proactive message", { conversationId, messageId });

  return createMSTeamsSendResult({
    conversationId,
    messageId,
    platformMessageIds,
    kind: receiptKind ?? (mediaUrl ? "media" : "text"),
  });
}

/**
 * Send a pre-built activity (consent card, Adaptive Card, poll) proactively.
 * Threads via `ctx.threadActivityId` so card-shaped sends land in the same
 * thread as text sends instead of at channel root (ENG-17134).
 */
async function sendProactiveActivity(
  ctx: MSTeamsProactiveContext,
  activity: Record<string, unknown>,
  errorPrefix: string,
): Promise<string> {
  try {
    const baseRef = buildConversationReference(ctx.ref);
    const response = await sendMSTeamsActivityWithReference(ctx.app, baseRef, activity, {
      threadActivityId: ctx.threadActivityId,
      serviceUrlBoundary: ctx.sdkCloudOptions,
    });
    return extractMessageId(response) ?? "unknown";
  } catch (err) {
    const classification = classifyMSTeamsSendError(err);
    const hint = formatMSTeamsSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `${errorPrefix} failed${status}: ${formatMSTeamsErrorDetail(err)}${hint ? ` (${hint})` : ""}`,
      { cause: err },
    );
  }
}

/**
 * Send a poll (Adaptive Card) to a Teams conversation or user.
 */
export async function sendPollMSTeams(
  params: SendMSTeamsPollParams,
): Promise<SendMSTeamsPollResult> {
  const { cfg, to, question, options, maxSelections } = params;
  const ctx = await resolveMSTeamsSendContext({ cfg, to });
  const { conversationId, log } = ctx;

  const pollCard = buildMSTeamsPollCard({
    question,
    options,
    maxSelections,
  });

  log.debug?.("sending poll", {
    conversationId,
    pollId: pollCard.pollId,
    optionCount: pollCard.options.length,
  });

  const activity = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: pollCard.card,
      },
    ],
  };

  // Send poll via proactive conversation (Adaptive Cards require direct activity send)
  const messageId = await sendProactiveActivity(ctx, activity, "msteams poll send");

  log.info("sent poll", { conversationId, pollId: pollCard.pollId, messageId });

  return {
    pollId: pollCard.pollId,
    messageId,
    conversationId,
  };
}

/**
 * Send an arbitrary Adaptive Card to a Teams conversation or user.
 */
export async function sendAdaptiveCardMSTeams(
  params: SendMSTeamsCardParams,
): Promise<SendMSTeamsCardResult> {
  const { cfg, to, card, replyStyleOverride } = params;
  const ctx = await resolveMSTeamsSendContext({ cfg, to, replyStyleOverride });
  const { conversationId, log } = ctx;

  log.debug?.("sending adaptive card", {
    conversationId,
    cardType: card.type,
    cardVersion: card.version,
  });

  const activity = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: card,
      },
    ],
  };

  // Send card via proactive conversation
  const messageId = await sendProactiveActivity(ctx, activity, "msteams card send");

  log.info("sent adaptive card", { conversationId, messageId });

  return {
    messageId,
    conversationId,
  };
}

type EditMSTeamsMessageParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID or user ID */
  to: string;
  /** Activity ID of the message to edit */
  activityId: string;
  /** New message text */
  text: string;
};

type EditMSTeamsMessageResult = {
  conversationId: string;
};

type DeleteMSTeamsMessageParams = {
  /** Full config (for credentials) */
  cfg: OpenClawConfig;
  /** Conversation ID or user ID */
  to: string;
  /** Activity ID of the message to delete */
  activityId: string;
};

type DeleteMSTeamsMessageResult = {
  conversationId: string;
};

/**
 * Edit (update) a previously sent message in a Teams conversation.
 *
 * Uses the Bot Framework REST API for proactive edits outside of the
 * original turn context.
 */
export async function editMessageMSTeams(
  params: EditMSTeamsMessageParams,
): Promise<EditMSTeamsMessageResult> {
  const { cfg, to, activityId, text } = params;
  const { app, conversationId, ref, log, sdkCloudOptions } = await resolveMSTeamsSendContext({
    cfg,
    to,
  });

  log.debug?.("editing proactive message", { conversationId, activityId, textLength: text.length });

  try {
    const baseRef = buildConversationReference(ref);
    await updateMSTeamsActivityWithReference(
      app,
      baseRef,
      activityId,
      {
        type: "message",
        id: activityId,
        text,
      } as Record<string, unknown>,
      { serviceUrlBoundary: sdkCloudOptions },
    );
  } catch (err) {
    const classification = classifyMSTeamsSendError(err);
    const hint = formatMSTeamsSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `msteams edit failed${status}: ${formatMSTeamsErrorDetail(err)}${hint ? ` (${hint})` : ""}`,
      { cause: err },
    );
  }

  log.info("edited proactive message", { conversationId, activityId });

  return { conversationId };
}

/**
 * Delete a previously sent message in a Teams conversation.
 *
 * Uses the Bot Framework REST API for proactive deletes outside of the
 * original turn context.
 */
export async function deleteMessageMSTeams(
  params: DeleteMSTeamsMessageParams,
): Promise<DeleteMSTeamsMessageResult> {
  const { cfg, to, activityId } = params;
  const { app, conversationId, ref, log, sdkCloudOptions } = await resolveMSTeamsSendContext({
    cfg,
    to,
  });

  log.debug?.("deleting proactive message", { conversationId, activityId });

  try {
    const baseRef = buildConversationReference(ref);
    await deleteMSTeamsActivityWithReference(app, baseRef, activityId, {
      serviceUrlBoundary: sdkCloudOptions,
    });
  } catch (err) {
    const classification = classifyMSTeamsSendError(err);
    const hint = formatMSTeamsSendErrorHint(classification);
    const status = classification.statusCode ? ` (HTTP ${classification.statusCode})` : "";
    throw new Error(
      `msteams delete failed${status}: ${formatMSTeamsErrorDetail(err)}${hint ? ` (${hint})` : ""}`,
      { cause: err },
    );
  }

  log.info("deleted proactive message", { conversationId, activityId });

  return { conversationId };
}
