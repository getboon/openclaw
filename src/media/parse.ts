import { mimeTypeFromFilePath } from "@openclaw/media-core/mime";
// Media parse helpers normalize media references from user and channel input.
import {
  extractEmbeddedIpv4FromIpv6,
  isBlockedSpecialUseIpv4Address,
  isBlockedSpecialUseIpv6Address,
  isCanonicalDottedDecimalIPv4,
  isIpv4Address,
  isLegacyIpv4Literal,
  parseCanonicalIpAddress,
  parseLooseIpAddress,
} from "@openclaw/net-policy/ip";
import { parseFenceSpans } from "../../packages/markdown-core/src/fences.js";
import { parseAudioTag } from "./audio-tags.js";

/** Captures legacy MEDIA: attachment directives from model/tool output. */
export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+)`?/gi;

/** Ordered output segment emitted after visible text and extracted media are separated. */
type ParsedMediaOutputSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "media";
      url: string;
    };

/** Controls which non-MEDIA syntaxes may be lifted into media attachments. */
export type SplitMediaFromOutputOptions = {
  extractMarkdownImages?: boolean;
  extractMediaDirectives?: boolean;
};

/** Converts file URLs into plain local paths before downstream media validation. */
export function normalizeMediaSource(src: string): string {
  return src.startsWith("file://") ? src.replace("file://", "") : src;
}

const TRAILING_SERIALIZED_JSON_AFTER_EXT_RE = /^(.*\.\w{1,10})\\?"(?=[\]},:]|$).*/s;

function cleanCandidate(raw: string) {
  const stripped = raw.replace(/^[`"'[{(]+/, "").replace(/[`"'\\})\],]+$/, "");
  const jsonSuffixMatch = TRAILING_SERIALIZED_JSON_AFTER_EXT_RE.exec(stripped);
  return jsonSuffixMatch?.[1] ?? stripped;
}

/** Longest extension we will treat as a fused-prose boundary (".jpeg" is 4). */
const MAX_GLUED_MEDIA_EXT_LEN = 5;

/**
 * The system prompt requires `MEDIA:<path>` on its own line, but
 * when the model forgets the newline the prose fuses onto the path
 * ("…Bid_Form.xlsxHere's the earthwork"). MEDIA_TOKEN_RE captures greedily to
 * end-of-line, so the fused run is taken as the path, resolves to nothing, and
 * no attachment is produced — the raw server path then reaches the user.
 *
 * Re-split the first token at a KNOWN media extension so the path resolves and
 * the prose survives as visible text (invalid parts are re-emitted downstream).
 * Only a real extension may split, so a dotted directory segment (".openclaw")
 * is left intact, and only a following alphanumeric counts as prose — a
 * trailing `"` is serialized-JSON junk that cleanCandidate already trims and
 * must stay invisible.
 */
function splitGluedMediaExtension(payload: string): { payload: string; split: boolean } {
  const firstToken = /^\S+/.exec(payload)?.[0];
  if (!firstToken) {
    return { payload, split: false };
  }

  // Right-to-left: the real extension is the rightmost one, so a mid-name
  // extension cannot hijack the boundary ("report.pdf2024.xlsxHere" must split
  // at .xlsx, not .pdf). `dot > 0` also ends the scan without a negative
  // fromIndex, which lastIndexOf would clamp to 0 and loop on forever.
  for (let dot = firstToken.lastIndexOf("."); dot > 0; dot = firstToken.lastIndexOf(".", dot - 1)) {
    const run = /^[A-Za-z0-9]*/.exec(firstToken.slice(dot + 1))?.[0] ?? "";
    // The full alphanumeric run IS the candidate extension. If it is already a
    // known one, nothing is fused on — what follows is punctuation or
    // serialized-JSON that cleanCandidate trims. Testing prefixes here instead
    // would truncate `.xlsx` to `.xls` (and `.docx`/`.pptx`/`.html` likewise),
    // dropping the attachment and leaking the tail as visible text.
    if (run.length === 0 || mimeTypeFromFilePath(`x.${run}`)) {
      continue;
    }
    // `run.length - 1` guarantees at least one character survives the split, so
    // the boundary always has prose on the far side.
    for (let len = Math.min(MAX_GLUED_MEDIA_EXT_LEN, run.length - 1); len >= 1; len -= 1) {
      const ext = firstToken.slice(dot, dot + 1 + len);
      if (!mimeTypeFromFilePath(`x${ext}`)) {
        continue;
      }
      const end = dot + 1 + len;
      // A path separator in the remainder means this "extension" is really the
      // start of a directory name and the token continues — not a boundary.
      // Every shorter candidate leaves an even longer remainder, so give up on
      // this dot entirely rather than trying them.
      if (/[/\\]/.test(firstToken.slice(end))) {
        break;
      }
      const rest = `${firstToken.slice(end)}${payload.slice(firstToken.length)}`;
      return { payload: `${firstToken.slice(0, end)} ${rest}`, split: true };
    }
  }
  return { payload, split: false };
}

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HAS_FILE_EXT = /\.\w{1,10}$/;

// Matches ".." as a standalone path segment (start, middle, or end).
const TRAVERSAL_SEGMENT_RE = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

function isSupportedHomeRelativePath(candidate: string): boolean {
  return candidate.startsWith("~/") || candidate.startsWith("~\\");
}

function hasTraversalOrUnsupportedHomeDirPrefix(candidate: string): boolean {
  return (
    candidate.startsWith("../") ||
    candidate === ".." ||
    (candidate.startsWith("~") && !isSupportedHomeRelativePath(candidate)) ||
    TRAVERSAL_SEGMENT_RE.test(candidate)
  );
}

// Broad structural check: does this look like a local file path? Used only for
// stripping MEDIA: lines from output text — never for media approval.
function looksLikeLocalFilePath(candidate: string): boolean {
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith("~") ||
    WINDOWS_DRIVE_RE.test(candidate) ||
    candidate.startsWith("\\\\") ||
    (!SCHEME_RE.test(candidate) && (candidate.includes("/") || candidate.includes("\\")))
  );
}

// Recognize safe local file path patterns for media approval, rejecting
// traversal and unsupported home-dir paths so they never reach downstream load/send logic.
function isLikelyLocalPath(candidate: string): boolean {
  if (hasTraversalOrUnsupportedHomeDirPrefix(candidate)) {
    return false;
  }
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    isSupportedHomeRelativePath(candidate) ||
    WINDOWS_DRIVE_RE.test(candidate) ||
    candidate.startsWith("\\\\") ||
    (!SCHEME_RE.test(candidate) && (candidate.includes("/") || candidate.includes("\\")))
  );
}

function normalizeRemoteMediaHostname(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (normalized.split(".").some((label) => label.length === 0)) {
    return "";
  }
  return normalized;
}

function isBlockedRemoteMediaHostname(hostname: string): boolean {
  const normalized = normalizeRemoteMediaHostname(hostname);
  if (!normalized) {
    return true;
  }
  if (!normalized.includes(".")) {
    return true;
  }
  if (
    normalized === "localhost" ||
    normalized === "localhost.localdomain" ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }

  const strictIp = parseCanonicalIpAddress(normalized);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp);
    }
    if (isBlockedSpecialUseIpv6Address(strictIp)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    return embeddedIpv4 ? isBlockedSpecialUseIpv4Address(embeddedIpv4) : false;
  }

  if (normalized.includes(":") && !parseLooseIpAddress(normalized)) {
    return true;
  }
  return !isCanonicalDottedDecimalIPv4(normalized) && isLegacyIpv4Literal(normalized);
}

function isAllowedRemoteMediaUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !isBlockedRemoteMediaHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isValidMedia(
  candidate: string,
  opts?: { allowSpaces?: boolean; allowBareFilename?: boolean },
) {
  if (!candidate) {
    return false;
  }
  if (candidate.length > 4096) {
    return false;
  }
  if (!opts?.allowSpaces && /\s/.test(candidate)) {
    return false;
  }
  if (/^https?:\/\//i.test(candidate)) {
    return isAllowedRemoteMediaUrl(candidate);
  }

  if (isLikelyLocalPath(candidate)) {
    return true;
  }

  // Hard reject traversal/unsupported home-dir patterns before the bare-filename fallback
  // to prevent path traversal bypasses (e.g. "../../.env" matching HAS_FILE_EXT).
  if (hasTraversalOrUnsupportedHomeDirPrefix(candidate)) {
    return false;
  }

  // Accept bare filenames (e.g. "image.png") only when the caller opts in.
  // This avoids treating space-split path fragments as separate media items.
  if (opts?.allowBareFilename && !SCHEME_RE.test(candidate) && HAS_FILE_EXT.test(candidate)) {
    return true;
  }

  return false;
}

function unwrapQuoted(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return undefined;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last) {
    return undefined;
  }
  if (first !== `"` && first !== "'" && first !== "`") {
    return undefined;
  }
  return trimmed.slice(1, -1).trim();
}

function mayContainFenceMarkers(input: string): boolean {
  return input.includes("```") || input.includes("~~~");
}

function cleanLineText(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

type MarkdownImageMatch = {
  start: number;
  end: number;
  destination: string;
};

const MAX_MARKDOWN_IMAGE_LINE_LENGTH = 20_000;
const MAX_MARKDOWN_IMAGE_ATTEMPTS_PER_LINE = 80;
const MAX_MARKDOWN_IMAGE_MATCHES_PER_LINE = 50;

function findMatchingBracket(
  input: string,
  start: number,
  open: string,
  close: string,
): number | undefined {
  let depth = 1;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch !== close) {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return i;
    }
  }
  return undefined;
}

function isRemoteMarkdownImageMedia(candidate: string): boolean {
  return /^https?:\/\//i.test(candidate) && isValidMedia(candidate);
}

function parseMarkdownTitle(input: string, start: number): number | undefined {
  let index = start;
  while (index < input.length && /\s/.test(input[index] ?? "")) {
    index += 1;
  }
  const opener = input[index];
  if (!opener) {
    return undefined;
  }
  const closer = opener === '"' || opener === "'" ? opener : opener === "(" ? ")" : null;
  if (!closer) {
    return undefined;
  }
  const closingIndex =
    opener === "("
      ? findMatchingBracket(input, index + 1, "(", ")")
      : (() => {
          for (let i = index + 1; i < input.length; i += 1) {
            const ch = input[i];
            if (ch === "\\") {
              i += 1;
              continue;
            }
            if (ch === closer) {
              return i;
            }
          }
          return undefined;
        })();
  if (closingIndex == null) {
    return undefined;
  }
  let tailIndex = closingIndex + 1;
  while (tailIndex < input.length && /\s/.test(input[tailIndex] ?? "")) {
    tailIndex += 1;
  }
  return input[tailIndex] === ")" ? tailIndex + 1 : undefined;
}

function parseMarkdownImageDestination(
  input: string,
  start: number,
): { destination: string; end: number } | undefined {
  let index = start;
  while (index < input.length && /\s/.test(input[index] ?? "")) {
    index += 1;
  }
  if (index >= input.length) {
    return undefined;
  }

  if (input[index] === "<") {
    let closing = index + 1;
    while (closing < input.length) {
      const ch = input[closing];
      if (ch === "\\") {
        closing += 2;
        continue;
      }
      if (ch === ">") {
        const destination = input.slice(index + 1, closing).trim();
        if (!destination) {
          return undefined;
        }
        let tailIndex = closing + 1;
        while (tailIndex < input.length && /\s/.test(input[tailIndex] ?? "")) {
          tailIndex += 1;
        }
        if (input[tailIndex] === ")") {
          return { destination, end: tailIndex + 1 };
        }
        const titledEnd = parseMarkdownTitle(input, tailIndex);
        return titledEnd ? { destination, end: titledEnd } : undefined;
      }
      closing += 1;
    }
    return undefined;
  }

  const destinationStart = index;
  let destinationEnd = index;
  let parenDepth = 0;
  while (index < input.length) {
    const ch = input[index];
    if (ch === "\\") {
      index += 2;
      destinationEnd = index;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      index += 1;
      destinationEnd = index;
      continue;
    }
    if (ch === ")") {
      if (parenDepth === 0) {
        const destination = input.slice(destinationStart, destinationEnd).trim();
        return destination ? { destination, end: index + 1 } : undefined;
      }
      parenDepth -= 1;
      index += 1;
      destinationEnd = index;
      continue;
    }
    if (/\s/.test(ch) && parenDepth === 0) {
      const destination = input.slice(destinationStart, destinationEnd).trim();
      if (!destination) {
        return undefined;
      }
      const titledEnd = parseMarkdownTitle(input, index);
      return titledEnd ? { destination, end: titledEnd } : undefined;
    }
    index += 1;
    destinationEnd = index;
  }
  return undefined;
}

function findMarkdownImageMatches(line: string): MarkdownImageMatch[] {
  if (line.length > MAX_MARKDOWN_IMAGE_LINE_LENGTH) {
    return [];
  }
  const matches: MarkdownImageMatch[] = [];
  let searchIndex = 0;
  let attempts = 0;
  while (
    matches.length < MAX_MARKDOWN_IMAGE_MATCHES_PER_LINE &&
    attempts < MAX_MARKDOWN_IMAGE_ATTEMPTS_PER_LINE
  ) {
    const index = line.indexOf("![", searchIndex);
    if (index < 0) {
      break;
    }
    attempts += 1;
    const altEnd = findMatchingBracket(line, index + 2, "[", "]");
    if (altEnd == null || line[altEnd + 1] !== "(") {
      searchIndex = index + 2;
      continue;
    }
    const parsed = parseMarkdownImageDestination(line, altEnd + 2);
    if (!parsed) {
      searchIndex = index + 2;
      continue;
    }
    matches.push({
      start: index,
      end: parsed.end,
      destination: parsed.destination,
    });
    searchIndex = parsed.end;
  }
  return matches;
}

function collectMarkdownImageSegments(params: { line: string; media: string[] }): {
  cleanedLine?: string;
  lineSegments: ParsedMediaOutputSegment[];
  foundMedia: boolean;
} {
  const matches = findMarkdownImageMatches(params.line);
  if (matches.length === 0) {
    return { lineSegments: [], foundMedia: false };
  }

  const segmentPieces: string[] = [];
  const visiblePieces: string[] = [];
  const lineSegments: ParsedMediaOutputSegment[] = [];
  let cursor = 0;
  let foundMedia = false;

  for (const match of matches) {
    const before = params.line.slice(cursor, match.start);
    segmentPieces.push(before);
    visiblePieces.push(before);

    const target = normalizeMediaSource(
      cleanCandidate(unwrapQuoted(match.destination) ?? match.destination),
    );
    if (isRemoteMarkdownImageMedia(target)) {
      const beforeText = cleanLineText(segmentPieces.join(""));
      if (beforeText) {
        lineSegments.push({ type: "text", text: beforeText });
      }
      segmentPieces.length = 0;
      params.media.push(target);
      lineSegments.push({ type: "media", url: target });
      foundMedia = true;
    } else {
      const original = params.line.slice(match.start, match.end);
      segmentPieces.push(original);
      visiblePieces.push(original);
    }

    cursor = match.end;
  }

  const after = params.line.slice(cursor);
  segmentPieces.push(after);
  visiblePieces.push(after);
  const trailingText = cleanLineText(segmentPieces.join(""));
  if (trailingText) {
    lineSegments.push({ type: "text", text: trailingText });
  }
  const cleanedLine = cleanLineText(visiblePieces.join(""));

  return {
    cleanedLine: cleanedLine || undefined,
    lineSegments,
    foundMedia,
  };
}

// Check if a character offset is inside any fenced code block
function isInsideFence(fenceSpans: Array<{ start: number; end: number }>, offset: number): boolean {
  return fenceSpans.some((span) => offset >= span.start && offset < span.end);
}

/** Splits tool/stdout text into visible text, media attachments, voice tags, and ordered segments. */
export function splitMediaFromOutput(
  raw: string,
  options: SplitMediaFromOutputOptions = {},
): {
  text: string;
  mediaUrls?: string[];
  /** @deprecated Use mediaUrls[0]. */
  mediaUrl?: string;
  audioAsVoice?: boolean; // true if [[audio_as_voice]] tag was found
  segments?: ParsedMediaOutputSegment[];
} {
  // KNOWN: Leading whitespace is semantically meaningful in Markdown (lists, indented fences).
  // We only trim the end; token cleanup below handles removing `MEDIA:` lines.
  const trimmedRaw = raw.trimEnd();
  if (!trimmedRaw.trim()) {
    return { text: "" };
  }
  const extractMarkdownImages = options.extractMarkdownImages === true;
  const extractMediaDirectives = options.extractMediaDirectives !== false;
  const mayContainMediaToken = extractMediaDirectives && /media:/i.test(trimmedRaw);
  const mayContainMarkdownImage = extractMarkdownImages && /!\[[^\]]*]\(/.test(trimmedRaw);
  const mayContainAudioTag = trimmedRaw.includes("[[");
  if (!mayContainMediaToken && !mayContainMarkdownImage && !mayContainAudioTag) {
    return { text: trimmedRaw };
  }

  const media: string[] = [];
  let foundMediaToken = false;
  const segments: ParsedMediaOutputSegment[] = [];

  const pushTextSegment = (text: string) => {
    if (!text) {
      return;
    }
    const last = segments[segments.length - 1];
    if (last?.type === "text") {
      last.text = `${last.text}\n${text}`;
      return;
    }
    segments.push({ type: "text", text });
  };

  // Parse fenced code blocks to avoid extracting MEDIA tokens from inside them
  const hasFenceMarkers = mayContainFenceMarkers(trimmedRaw);
  const fenceSpans = hasFenceMarkers ? parseFenceSpans(trimmedRaw) : [];

  // Line-wise parsing preserves visible text while letting MEDIA-only lines disappear cleanly.
  const lines = trimmedRaw.split("\n");
  const keptLines: string[] = [];

  let lineOffset = 0; // Track character offset for fence checking
  for (const line of lines) {
    // Fenced examples must remain text; extracting their MEDIA tokens would mutate transcripts.
    if (hasFenceMarkers && isInsideFence(fenceSpans, lineOffset)) {
      keptLines.push(line);
      pushTextSegment(line);
      lineOffset += line.length + 1; // +1 for newline
      continue;
    }

    const trimmedStart = line.trimStart();
    if (!extractMediaDirectives || !trimmedStart.toUpperCase().startsWith("MEDIA:")) {
      const markdownImageResult = extractMarkdownImages
        ? collectMarkdownImageSegments({ line, media })
        : { lineSegments: [], foundMedia: false };
      if (!markdownImageResult.foundMedia) {
        keptLines.push(line);
        pushTextSegment(line);
      } else {
        foundMediaToken = true;
        if (markdownImageResult.cleanedLine) {
          keptLines.push(markdownImageResult.cleanedLine);
        }
        for (const segment of markdownImageResult.lineSegments) {
          if (segment.type === "text") {
            pushTextSegment(segment.text);
            continue;
          }
          segments.push(segment);
        }
      }
      lineOffset += line.length + 1; // +1 for newline
      continue;
    }

    const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
    if (matches.length === 0) {
      keptLines.push(line);
      pushTextSegment(line);
      lineOffset += line.length + 1; // +1 for newline
      continue;
    }

    const pieces: string[] = [];
    const lineSegments: ParsedMediaOutputSegment[] = [];
    let cursor = 0;

    for (const match of matches) {
      const start = match.index ?? 0;
      pieces.push(line.slice(cursor, start));

      const payload = match[1];
      const unwrapped = unwrapQuoted(payload);
      // A quoted path is explicit — never re-split it.
      const glued = unwrapped ? { payload, split: false } : splitGluedMediaExtension(payload);
      const payloadValue = unwrapped ?? glued.payload;
      const parts = unwrapped ? [unwrapped] : glued.payload.split(/\s+/).filter(Boolean);
      const mediaStartIndex = media.length;
      let validCount = 0;
      const invalidParts: string[] = [];
      let hasValidMedia = false;
      for (const [partIndex, part] of parts.entries()) {
        const candidate = normalizeMediaSource(cleanCandidate(part));
        // The media half of a split is a filename we just carved out of the
        // token, so a bare filename is legitimate there even though it is
        // rejected elsewhere; the prose half stays invalid and is re-emitted
        // as text.
        const validateOpts = unwrapped
          ? { allowSpaces: true }
          : glued.split && partIndex === 0
            ? { allowBareFilename: true }
            : undefined;
        if (isValidMedia(candidate, validateOpts)) {
          media.push(candidate);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount += 1;
        } else {
          invalidParts.push(part);
        }
      }

      const trimmedPayload = payloadValue.trim();
      const looksLikeLocalPath =
        looksLikeLocalFilePath(trimmedPayload) || trimmedPayload.startsWith("file://");
      // Skipped after a fused-prose split: the whitespace we just
      // introduced is a prose boundary, not part of a filename, so re-joining
      // it here would rebuild the very path that failed to resolve.
      if (
        !unwrapped &&
        !glued.split &&
        validCount === 1 &&
        invalidParts.length > 0 &&
        /\s/.test(payloadValue) &&
        looksLikeLocalPath
      ) {
        // A single valid split plus invalid leftovers can be one local path containing spaces.
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }

      if (!hasValidMedia && !unwrapped && !glued.split && /\s/.test(payloadValue)) {
        const spacedFallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(spacedFallback, { allowSpaces: true, allowBareFilename: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, spacedFallback);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }

      // Same reasoning as the two guards above: after a split, the
      // injected whitespace is a prose boundary. Without this guard a split that
      // failed to validate (a bare filename with no directory) would be
      // re-assembled here into a "path" containing the prose AND the injected
      // space — a string strictly worse than the unsplit original.
      if (!hasValidMedia && !glued.split) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true, allowBareFilename: true })) {
          media.push(fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          invalidParts.length = 0;
        }
      }

      if (hasValidMedia) {
        const beforeText = cleanLineText(pieces.join(""));
        if (beforeText) {
          lineSegments.push({ type: "text", text: beforeText });
        }
        pieces.length = 0;
        for (const url of media.slice(mediaStartIndex, mediaStartIndex + validCount)) {
          lineSegments.push({ type: "media", url });
        }
        if (invalidParts.length > 0) {
          pieces.push(invalidParts.join(" "));
        }
      } else if (looksLikeLocalPath) {
        // Strip MEDIA: lines with local paths even when invalid (e.g. absolute paths
        // from internal tools like TTS). They should never leak as visible text.
        foundMediaToken = true;
      } else {
        // If no valid media was found in this match, keep the original token text.
        pieces.push(match[0]);
      }

      cursor = start + match[0].length;
    }

    pieces.push(line.slice(cursor));

    const cleanedLine = cleanLineText(pieces.join(""));

    // If the line becomes empty, drop it.
    if (cleanedLine) {
      keptLines.push(cleanedLine);
      lineSegments.push({ type: "text", text: cleanedLine });
    }
    for (const segment of lineSegments) {
      if (segment.type === "text") {
        pushTextSegment(segment.text);
        continue;
      }
      segments.push(segment);
    }
    lineOffset += line.length + 1; // +1 for newline
  }

  let cleanedText = keptLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Detect and strip [[audio_as_voice]] tag
  const audioTagResult = parseAudioTag(cleanedText);
  const hasAudioAsVoice = audioTagResult.audioAsVoice;
  if (audioTagResult.hadTag) {
    cleanedText = audioTagResult.text.replace(/\n{2,}/g, "\n").trim();
  }

  if (media.length === 0) {
    const parsedText = foundMediaToken || hasAudioAsVoice ? cleanedText : trimmedRaw;
    const result: ReturnType<typeof splitMediaFromOutput> = {
      text: parsedText,
      segments: parsedText ? [{ type: "text", text: parsedText }] : [],
    };
    if (hasAudioAsVoice) {
      result.audioAsVoice = true;
    }
    return result;
  }

  return {
    text: cleanedText,
    mediaUrls: media,
    mediaUrl: media[0],
    segments: segments.length > 0 ? segments : [{ type: "text", text: cleanedText }],
    ...(hasAudioAsVoice ? { audioAsVoice: true } : {}),
  };
}
