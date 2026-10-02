// Msteams plugin module implements inbound media behavior.
import {
  buildMSTeamsGraphMessageUrls,
  downloadMSTeamsAttachments,
  downloadMSTeamsBotFrameworkAttachments,
  downloadMSTeamsGraphMedia,
  extractMSTeamsHtmlAttachmentIds,
  isBotFrameworkPersonalChatId,
  type MSTeamsAccessTokenProvider,
  type MSTeamsAttachmentFailure,
  type MSTeamsAttachmentLike,
  type MSTeamsHtmlAttachmentSummary,
  type MSTeamsInboundMedia,
} from "../attachments.js";
import type { MSTeamsTurnContext } from "../sdk-types.js";

type MSTeamsLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

export async function resolveMSTeamsInboundMedia(params: {
  attachments: MSTeamsAttachmentLike[];
  htmlSummary?: MSTeamsHtmlAttachmentSummary;
  maxBytes: number;
  allowHosts?: string[];
  authAllowHosts?: string[];
  tokenProvider: MSTeamsAccessTokenProvider;
  conversationType: string;
  conversationId: string;
  conversationMessageId?: string;
  serviceUrl?: string;
  activity: Pick<MSTeamsTurnContext["activity"], "id" | "replyToId" | "channelData">;
  log: MSTeamsLogger;
  /** When true, embeds original filename in stored path for later extraction. */
  preserveFilenames?: boolean;
  /**
   * When true, always run the Graph re-fetch fallback for channel/group
   * messages even when the inbound HTML body has no `<attachment id=...>`
   * stub. Workaround for tenants where Bot Framework strips file refs from
   * inbound activities. Has no effect on personal-chat
   * conversations. This param is the resolved runtime value; the message
   * handler applies `resolveMSTeamsAlwaysFetchGraphMessage` before calling
   * in. Upstream fork default: `false`. Boon fork default: `true` (see
   * `graph-fallback-default.ts`).
   */
  alwaysFetchGraphMessage?: boolean;
}): Promise<{ media: MSTeamsInboundMedia[]; failures: MSTeamsAttachmentFailure[] }> {
  const {
    attachments,
    htmlSummary,
    maxBytes,
    tokenProvider,
    allowHosts,
    conversationType,
    conversationId,
    conversationMessageId,
    serviceUrl,
    activity,
    log,
    preserveFilenames,
    alwaysFetchGraphMessage,
  } = params;

  // Failures ACCUMULATE across every path (unlike `mediaList`): direct
  // download and a BF/Graph fallback cover disjoint attachments, so an
  // earlier failure must survive a later path recovering a different file.
  // The direct path and the Graph fallback CAN both fail the SAME attachment
  // (e.g. a dragged SharePoint reference); dedupe those by the internal
  // sourceUrl identity each path reports alongside the failure — never by
  // name/contentType, which two distinct files can share (code-review
  // finding). Multiplicity is preserved whenever no identity is available.
  // A later path can also RESOLVE an attachment the earlier path already
  // failed on (e.g. a transient 403 followed by a successful Graph retry);
  // `resolvedSourceUrls` + the final filter below drop that stale failure
  // instead of reporting a success and a failure for the same file.
  const trackedFailures: Array<{ failure: MSTeamsAttachmentFailure; sourceUrl?: string }> = [];
  const seenFailureUrls = new Set<string>();
  const resolvedSourceUrls = new Set<string>();
  const addFailure = (failure: MSTeamsAttachmentFailure, sourceUrl?: string) => {
    if (sourceUrl !== undefined) {
      if (seenFailureUrls.has(sourceUrl)) {
        return;
      }
      seenFailureUrls.add(sourceUrl);
    }
    trackedFailures.push({ failure, sourceUrl });
  };
  const markResolved = (sourceUrl: string) => resolvedSourceUrls.add(sourceUrl);
  let mediaList = await downloadMSTeamsAttachments({
    attachments,
    maxBytes,
    tokenProvider,
    allowHosts,
    authAllowHosts: params.authAllowHosts,
    preserveFilenames,
    logger: log,
    onFailure: addFailure,
    onSuccess: markResolved,
  });

  if (mediaList.length === 0) {
    // Gate the Graph/Bot Framework media fallback on the presence of real
    // `<attachment id="...">` tags inside any `text/html` attachment. Teams
    // delivers @mention cards and other chrome as `text/html` attachments
    // too, so keying off contentType alone produces spurious 404 diagnostics
    // for every mention-only message and masks real file attachments (#58617).
    const attachmentIds = extractMSTeamsHtmlAttachmentIds(attachments);
    const hasHtmlFileAttachment = attachmentIds.length > 0;

    // Personal DMs with the bot use Bot Framework conversation IDs (`a:...`
    // or `8:orgid:...`) which Graph's `/chats/{id}` endpoint rejects with
    // "Invalid ThreadId". Fetch media via the Bot Framework v3 attachments
    // endpoint instead, which speaks the same identifier space.
    if (hasHtmlFileAttachment && isBotFrameworkPersonalChatId(conversationId)) {
      if (!serviceUrl) {
        log.debug?.("bot framework attachment skipped (missing serviceUrl)", {
          conversationType,
          conversationId,
        });
      } else {
        const bfMedia = await downloadMSTeamsBotFrameworkAttachments({
          serviceUrl,
          attachmentIds,
          tokenProvider,
          maxBytes,
          allowHosts,
          authAllowHosts: params.authAllowHosts,
          preserveFilenames,
        });
        if (bfMedia.media.length > 0) {
          mediaList = bfMedia.media;
        } else {
          log.debug?.("bot framework attachments fetch empty", {
            conversationType,
            attachmentCount: bfMedia.attachmentCount ?? attachmentIds.length,
          });
        }
        for (const failure of bfMedia.failures) {
          trackedFailures.push({ failure, sourceUrl: undefined });
        }
      }
    }

    // Bot Framework normally embeds an `<attachment id=...>` HTML stub on
    // channel-message activities that carry a file. Some tenants strip those
    // stubs from delivery despite RSC consent, leaving the bot blind to
    // attachments that DO exist server-side. The opt-in
    // `alwaysFetchGraphMessage` flag forces the Graph re-fetch path even
    // without a stub, recovering the file refs through Graph's view of the
    // message.
    if (
      (hasHtmlFileAttachment || alwaysFetchGraphMessage === true) &&
      mediaList.length === 0 &&
      !isBotFrameworkPersonalChatId(conversationId)
    ) {
      const messageUrls = buildMSTeamsGraphMessageUrls({
        conversationType,
        conversationId,
        messageId: activity.id ?? undefined,
        replyToId: activity.replyToId ?? undefined,
        conversationMessageId,
        channelData: activity.channelData,
      });
      if (messageUrls.length === 0) {
        log.debug?.("graph message url unavailable", {
          conversationType,
          hasChannelData: Boolean(activity.channelData),
          messageId: activity.id ?? undefined,
          replyToId: activity.replyToId ?? undefined,
        });
      } else {
        const attempts: Array<{
          url: string;
          hostedStatus?: number;
          attachmentStatus?: number;
          hostedCount?: number;
          attachmentCount?: number;
          tokenError?: boolean;
        }> = [];
        // `messageUrls` are different ID guesses for the SAME message, so a
        // batch seen before (any earlier URL, not just the immediately
        // preceding one) is a retry, not distinct attachments — skip it.
        // This only ever holds hosted-content failures: anything reported
        // via `onFailure` below (reference/sub-attachment, which carries a
        // real sourceUrl identity) is excluded by object identity so it is
        // never double-added here on top of `addFailure`. Relies on graph.ts
        // pushing the exact same failure object to both its local list and
        // `onFailure` — it does today for every identity-bearing failure.
        const seenGraphBatchKeys = new Set<string>();
        const reportedViaOnFailure = new Set<MSTeamsAttachmentFailure>();
        for (const messageUrl of messageUrls) {
          const graphMedia = await downloadMSTeamsGraphMedia({
            messageUrl,
            tokenProvider,
            maxBytes,
            allowHosts,
            authAllowHosts: params.authAllowHosts,
            preserveFilenames,
            log,
            logger: log,
            onFailure: (failure, sourceUrl) => {
              reportedViaOnFailure.add(failure);
              addFailure(failure, sourceUrl);
            },
            onSuccess: markResolved,
          });
          attempts.push({
            url: messageUrl,
            hostedStatus: graphMedia.hostedStatus,
            attachmentStatus: graphMedia.attachmentStatus,
            hostedCount: graphMedia.hostedCount,
            attachmentCount: graphMedia.attachmentCount,
            tokenError: graphMedia.tokenError,
          });
          const batch = graphMedia.failures.filter((failure) => !reportedViaOnFailure.has(failure));
          if (batch.length > 0) {
            const batchKey = stableFailureBatchKey(batch);
            if (!seenGraphBatchKeys.has(batchKey)) {
              for (const failure of batch) {
                trackedFailures.push({ failure, sourceUrl: undefined });
              }
              seenGraphBatchKeys.add(batchKey);
            }
          }
          if (graphMedia.media.length > 0) {
            mediaList = graphMedia.media;
            break;
          }
          if (graphMedia.tokenError) {
            break;
          }
        }
        if (mediaList.length === 0) {
          log.debug?.("graph media fetch empty", {
            attempts,
            attachmentIdCount: attachmentIds.length,
          });
        }
      }
    }
  }

  if (mediaList.length > 0) {
    log.debug?.("downloaded attachments", { count: mediaList.length });
  } else if (htmlSummary?.imgTags) {
    log.debug?.("inline images detected but none downloaded", {
      imgTags: htmlSummary.imgTags,
      srcHosts: htmlSummary.srcHosts,
      dataImages: htmlSummary.dataImages,
      cidImages: htmlSummary.cidImages,
    });
  }

  // Deduped above by sourceUrl identity (via `addFailure`) wherever the
  // direct path and Graph fallback can report the SAME attachment; every
  // other failure (no identity available) keeps full multiplicity. Drop any
  // failure whose sourceUrl a later path went on to resolve successfully —
  // otherwise a retried-and-recovered attachment reports as both a success
  // and a failure.
  const failures = trackedFailures
    .filter(({ sourceUrl }) => sourceUrl === undefined || !resolvedSourceUrls.has(sourceUrl))
    .map(({ failure }) => failure);
  return { media: mediaList, failures };
}

// Explicit field order (not JSON.stringify's insertion order, which a future
// push-site edit could silently change) so equal batches always compare
// equal, keeping the Graph messageUrl-retry dedup above reliable.
function stableFailureBatchKey(batch: MSTeamsAttachmentFailure[]): string {
  return batch.map((f) => `${f.name ?? ""}\u0000${f.contentType ?? ""}\u0000${f.reason}`).join("|");
}
