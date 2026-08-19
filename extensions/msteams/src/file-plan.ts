// Msteams module resolves the single outbound-file delivery decision shared by
// the proactive send path (send.ts) and the in-turn reply path (messenger.ts).
import { normalizeOptionalLowercaseString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { requiresFileConsent } from "./file-consent-helpers.js";

/** Consent threshold: Teams only accepts base64 inline for images under this size. */
export const FILE_CONSENT_THRESHOLD_BYTES = 4 * 1024 * 1024;
/** Default cap for outbound media when no channel-level override is configured. */
export const MSTEAMS_MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export type MSTeamsUndeliverableReason = "missing-sharepoint-site" | "missing-token-provider";

export type MSTeamsOutboundFilePlan =
  | { kind: "consent" }
  | { kind: "inline-image" }
  | { kind: "sharepoint-upload"; siteId: string }
  | { kind: "undeliverable"; reason: MSTeamsUndeliverableReason };

/**
 * Decide how (or whether) an outbound file can reach the user, given the
 * conversation type and the file's own properties. Personal chats always use
 * FileConsentCard for anything but a small image (requiresFileConsent below).
 * Group chats/channels prefer SharePoint upload when it's actually usable —
 * there is no app-only-token path to a bot's own OneDrive (`/me/drive`
 * requires a signed-in user) — falling back to inline base64 only for a
 * small-enough image, and to an explicit undeliverable notice otherwise
 * (Teams caps inline message size, so a large image with no upload path has
 * no safe delivery shape either).
 */
export function resolveMSTeamsOutboundFilePlan(params: {
  conversationType: string | undefined;
  contentType: string | undefined;
  bufferSize: number;
  sharePointSiteId: string | undefined;
  /**
   * Whether a Graph token provider is available to make the upload call.
   * Callers pass `Boolean(tokenProvider)` — the resolver owns the full
   * "can this upload actually happen" decision so no caller has to re-derive
   * an undeliverable reason by hand when this is false.
   */
  hasTokenProvider: boolean;
}): MSTeamsOutboundFilePlan {
  if (
    requiresFileConsent({
      conversationType: params.conversationType,
      contentType: params.contentType,
      bufferSize: params.bufferSize,
      thresholdBytes: FILE_CONSENT_THRESHOLD_BYTES,
    })
  ) {
    return { kind: "consent" };
  }

  // requiresFileConsent is unconditionally true for personal + non-image, so
  // reaching here for personal means a small image; upload/link concerns
  // below only apply to group chats/channels.
  const isPersonal = normalizeOptionalLowercaseString(params.conversationType) === "personal";
  if (isPersonal) {
    return { kind: "inline-image" };
  }

  if (params.sharePointSiteId && params.hasTokenProvider) {
    return { kind: "sharepoint-upload", siteId: params.sharePointSiteId };
  }

  // No working upload path (no site, or a site with no usable token
  // provider). A small image still needs neither — it can go out inline
  // without depending on whatever broke the upload path.
  const isImage = params.contentType?.startsWith("image/") ?? false;
  if (isImage && params.bufferSize < FILE_CONSENT_THRESHOLD_BYTES) {
    return { kind: "inline-image" };
  }

  return {
    kind: "undeliverable",
    reason: params.sharePointSiteId ? "missing-token-provider" : "missing-sharepoint-site",
  };
}

const UNDELIVERABLE_REASON_TEXT: Record<MSTeamsUndeliverableReason, string> = {
  "missing-sharepoint-site":
    'file attachments aren\'t set up for this channel/group yet (an admin needs to configure "sharePointSiteId")',
  "missing-token-provider":
    "file attachments can't be uploaded right now (the bot's Microsoft Graph credentials aren't available)",
};

/**
 * Build the in-thread text told to the user when a file plan resolves to
 * "undeliverable". Only includes a link when the original media reference was
 * itself a URL the user can open directly — never fabricate a product link.
 */
export function buildMSTeamsUndeliverableFileNotice(params: {
  fileName: string;
  reason: MSTeamsUndeliverableReason;
  sourceUrl?: string;
  precedingText?: string;
}): string {
  const reasonText = UNDELIVERABLE_REASON_TEXT[params.reason];
  const notice = params.sourceUrl
    ? `I can't attach "${params.fileName}" directly here — ${reasonText}. You can open it here instead: ${params.sourceUrl}`
    : `I can't attach "${params.fileName}" directly here — ${reasonText}.`;
  return params.precedingText ? `${params.precedingText}\n\n${notice}` : notice;
}

/**
 * Build the in-thread text for a successful "sharepoint-upload" plan: a
 * markdown link to the shared item, appended to any existing message text.
 * Bot Framework file-info cards render as a broken "chiclet" (400 on
 * file.info) in this tenant, and there is no sendable "reference" attachment
 * type — a markdown link is the only working shape.
 */
export function buildMSTeamsSharePointFileLinkText(params: {
  name: string;
  shareUrl: string;
  precedingText?: string;
}): string {
  const fileLink = `📎 [${params.name}](${params.shareUrl})`;
  return params.precedingText ? `${params.precedingText}\n\n${fileLink}` : fileLink;
}
