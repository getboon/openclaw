export const PDF_STATES = ["unknown", "queued", "text", "ready", "failed"] as const;
export type PdfState = (typeof PDF_STATES)[number];

export type PdfStatusFile = {
  file_hash: string | null;
  state: PdfState;
  pages_done: number | null;
  total_pages: number | null;
  eta_s: number | null;
  file_name: string | null;
  reason: string | null;
};

const MEDIA_LINE_RE = /^\[media attached(?: \d+\/\d+)?: (.+)\]$/gmu;
// Media notes render `<ref> (<mime>) | <url>`; the ref itself may hold spaces and parentheses.
const MEDIA_BODY_RE = /^(.+?)(?: \(([^()\s]+\/[^()\s]+)\))?(?: \| .*)?$/u;
// Same rule as pdf-index `clean_name`, so names stay identical across both tools.
const UNSAFE_NAME_RE = /[\p{Cc}\]"'`]/gu;
const FILE_NAME_MAX = 80;
const HASH_RE = /^sha256:([0-9a-f]{64})$/u;

export function isPdfMedia(path: string, type: string | undefined): boolean {
  return type?.toLowerCase() === "application/pdf" || path.toLowerCase().endsWith(".pdf");
}

// Only refs openclaw itself renders; a user-typed line could otherwise pass a flag to pdf-index.
function isPdfRef(ref: string): boolean {
  return ref.startsWith("media://inbound/") || ref.startsWith("/");
}

export function parsePdfRefs(prompt: string): string[] {
  const refs = new Set<string>();
  for (const [, body] of prompt.matchAll(MEDIA_LINE_RE)) {
    const match = MEDIA_BODY_RE.exec(body);
    if (match && isPdfRef(match[1]) && isPdfMedia(match[1], match[2])) {
      refs.add(match[1]);
    }
  }
  return [...refs];
}

export function cleanFileName(name: string): string {
  return name.replace(UNSAFE_NAME_RE, "").slice(0, FILE_NAME_MAX);
}

export function hashHex(file: PdfStatusFile): string | undefined {
  return file.file_hash ? HASH_RE.exec(file.file_hash)?.[1] : undefined;
}

function coverageSentence(file: PdfStatusFile): string {
  if (file.state === "ready") {
    return "Ready.";
  }
  if (file.state === "failed") {
    const reason = file.reason ? cleanFileName(file.reason) : "";
    return reason ? `Could not be read: ${reason}.` : "Could not be read.";
  }
  if (file.state === "text" && file.total_pages !== null && (file.pages_done ?? 0) >= 1) {
    const covered = `Text search covers pages 1-${file.pages_done}.`;
    return file.eta_s === null ? covered : `${covered} The rest in about ${file.eta_s} s.`;
  }
  return "Queued.";
}

function noteLine(file: PdfStatusFile, hex: string): string {
  const name = file.file_name ? cleanFileName(file.file_name) : "";
  const label = name ? `"${name}"` : "PDF";
  const pages = file.total_pages === null ? "" : `${file.total_pages} pages. `;
  return `- ${label} (sha256 ${hex}): ${pages}${coverageSentence(file)}`;
}

export function buildNote(files: PdfStatusFile[]): string | undefined {
  const lines: string[] = [];
  for (const file of files) {
    const hex = hashHex(file);
    if (hex && file.state !== "unknown") {
      lines.push(noteLine(file, hex));
    }
  }
  if (lines.length === 0) {
    return undefined;
  }
  return [
    "[PDF preparation]",
    ...lines,
    'Use: pdf-index search <sha256> --q="<keywords>". The result states its coverage.',
  ].join("\n");
}
