import { execFile, spawn } from "node:child_process";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildNote,
  hashHex,
  isPdfMedia,
  parsePdfRefs,
  PDF_STATES,
  type PdfStatusFile,
} from "./note.js";

export const PLUGIN_ID = "boon-pdf-prep";

const PDF_INDEX_BIN = "pdf-index";
const STATUS_TIMEOUT_MS = 1_500;
const SEEN_HASHES_MAX = 1_000;

export type BoonPdfPrepApi = Pick<OpenClawPluginApi, "on">;

function stringArray(value: unknown): (string | undefined)[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : undefined))
    : [];
}

function pdfMediaPaths(metadata: Record<string, unknown> | undefined): string[] {
  const types = stringArray(metadata?.mediaTypes);
  return stringArray(metadata?.mediaPaths).filter(
    (path, index): path is string => path !== undefined && isPdfMedia(path, types[index]),
  );
}

function enqueue(refs: string[]): void {
  try {
    const child = spawn(PDF_INDEX_BIN, ["enqueue", ...refs], { stdio: "ignore", detached: false });
    // Without a listener, a missing binary (ENOENT) would crash the gateway.
    child.on("error", () => undefined);
  } catch {
    // Preparation is best effort; the first search starts it too.
  }
}

const NULLABLE_FIELD_TYPES = {
  file_hash: "string",
  pages_done: "number",
  total_pages: "number",
  eta_s: "number",
  file_name: "string",
  reason: "string",
} as const;

function isStatusFile(raw: unknown): raw is PdfStatusFile {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    (PDF_STATES as readonly unknown[]).includes(record.state) &&
    Object.entries(NULLABLE_FIELD_TYPES).every(
      ([key, type]) => record[key] === null || typeof record[key] === type,
    )
  );
}

function parseStatusOutput(stdout: string, expected: number): PdfStatusFile[] | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const { status, files } = (payload ?? {}) as { status?: unknown; files?: unknown };
  if (status !== "success" || !Array.isArray(files) || files.length !== expected) {
    return undefined;
  }
  return files.every(isStatusFile) ? files : undefined;
}

function readStatus(refs: string[]): Promise<PdfStatusFile[] | undefined> {
  return new Promise((resolve) => {
    const child = execFile(PDF_INDEX_BIN, ["status", ...refs], (error, stdout) => {
      clearTimeout(timer);
      resolve(error ? undefined : parseStatusOutput(stdout, refs.length));
    });
    // Own timer instead of execFile `timeout`: resolve on budget even if a non-exec
    // wrapper keeps stdio open after the kill.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(undefined);
    }, STATUS_TIMEOUT_MS);
  });
}

export function registerBoonPdfPrep(api: BoonPdfPrepApi): void {
  const seenHashes = new Set<string>();

  const firstSight = (hex: string): boolean => {
    if (seenHashes.has(hex)) {
      return false;
    }
    seenHashes.add(hex);
    if (seenHashes.size > SEEN_HASHES_MAX) {
      seenHashes.delete(seenHashes.values().next().value as string);
    }
    return true;
  };

  const preparationNote = async (prompt: string): Promise<string | undefined> => {
    const refs = parsePdfRefs(prompt);
    if (refs.length === 0) {
      return undefined;
    }
    const files = await readStatus(refs);
    if (!files) {
      return undefined;
    }
    const unknownRefs = refs.filter((_, index) => files[index]?.state === "unknown");
    if (unknownRefs.length > 0) {
      enqueue(unknownRefs);
    }
    const noted = new Set<string>();
    const shown = files.filter((file) => {
      const hex = hashHex(file);
      if (!hex || file.state === "unknown" || noted.has(hex)) {
        return false;
      }
      const isNew = firstSight(hex);
      if (file.state === "ready" && !isNew) {
        return false;
      }
      noted.add(hex);
      return true;
    });
    return buildNote(shown);
  };

  api.on("message_received", (event) => {
    const paths = pdfMediaPaths(event.metadata);
    if (paths.length > 0) {
      enqueue(paths);
    }
  });

  api.on("before_prompt_build", async (event) => {
    try {
      const note = await preparationNote(event.prompt);
      return note ? { appendContext: note } : undefined;
    } catch {
      return undefined;
    }
  });
}
