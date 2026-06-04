export const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024; // 16MB
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024; // 16MB
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * V8's hard maximum string length is 0x1fffffe8 (~512 MiB) characters. Any code
 * path that turns a file into a single base64 JS string (e.g. inlining media as
 * tool-result content for the model) is capped by that limit. base64 inflates
 * bytes by 4/3, so the largest file that can be base64-encoded into one string
 * is ~402 MiB of raw bytes. We pick a conservative limit well under that so the
 * failure surfaces as a clear, actionable error instead of a raw V8
 * "Cannot create a string longer than 0x1fffffe8 characters" throw.
 *
 * Files larger than this must be referenced by path (streamed to disk) rather
 * than inlined as base64 — see `imageResultFromFile`.
 */
export const MAX_INLINE_BASE64_BYTES = 256 * 1024 * 1024; // 256MB

export type MediaKind = "image" | "audio" | "video" | "document";

export function mediaKindFromMime(mime?: string | null): MediaKind | undefined {
  if (!mime) {
    return undefined;
  }
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime === "application/pdf") {
    return "document";
  }
  if (mime.startsWith("text/")) {
    return "document";
  }
  if (mime.startsWith("application/")) {
    return "document";
  }
  return undefined;
}

export function maxBytesForKind(kind: MediaKind): number {
  switch (kind) {
    case "image":
      return MAX_IMAGE_BYTES;
    case "audio":
      return MAX_AUDIO_BYTES;
    case "video":
      return MAX_VIDEO_BYTES;
    case "document":
      return MAX_DOCUMENT_BYTES;
    default:
      return MAX_DOCUMENT_BYTES;
  }
}
