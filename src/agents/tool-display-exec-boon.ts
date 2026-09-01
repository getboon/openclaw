import { binaryName, positionalArgs } from "./tool-display-exec-shell.js";

export const BOON_EXEC_BINARIES = [
  "agent-config",
  "boon-conversations",
  "boon-estimation",
  "boon-file-host",
  "boon-mep-design",
  "boon-projects",
  "boon-skill-creator",
  "boon-specs",
  "boon-summarize",
  "document-ai",
  "docx-tools",
  "electrical-feeder-sheet",
  "electrical-lighting-wildcards",
  "electrical-validate",
  "excel-tools",
  "fetch-history",
  "markitdown",
  "outlook",
  "pdf-index",
  "pdf-tools",
  "procore",
  "structural-validate",
] as const;

const SAFE_DOCUMENT_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,39}$/;

function documentBasename(document: string | undefined): string | undefined {
  if (!document) {
    return undefined;
  }
  const basename = document.split(/[\\/]/).at(-1);
  return basename && SAFE_DOCUMENT_BASENAME.test(basename) ? basename : undefined;
}

function withDocument(verb: string, document: string | undefined, preposition = "from"): string {
  return document ? `${verb} ${preposition} ${document}` : verb;
}

/** Summarizes Boon skill CLI invocations without exposing shell arguments. */
export function summarizeBoonExecCommand(words: string[]): string | undefined {
  const bin = binaryName(words[0]);
  if (!bin) {
    return undefined;
  }

  if (bin === "pdf-tools") {
    const positional = positionalArgs(words, 1);
    const subcommand = positional[0];
    const document = documentBasename(positional[1]);
    switch (subcommand) {
      case "page-text":
      case "pages-text":
        return withDocument("extracting text", document);
      case "page-to-image":
      case "render":
        return withDocument("rendering a drawing", document);
      case "info":
        return document ? `inspecting ${document}` : "inspecting";
      case "toc":
        return withDocument("reading the table of contents", document, "of");
      case "combine":
      case "merge":
        return "combining PDF pages";
      default:
        return "working with a PDF document";
    }
  }

  if (bin === "boon-projects") {
    const subcommand = positionalArgs(words, 1)[0];
    switch (subcommand) {
      case "projects":
      case "project":
      case "pages":
      case "page":
      case "documents":
      case "process-status":
      case "takeoff-status":
      case "takeoff-data":
      case "takeoff-overview":
      case "annotations":
      case "trades":
        return "checking project data";
      case "create":
        return "creating a project";
      case "upload":
        return "uploading a document";
      case "process":
        return "processing a document";
      case "takeoff":
        return "running a takeoff";
      case "page-download":
        return "downloading a drawing";
      case "detect-circuit-words":
      case "resolve-circuit-regex":
        return "analyzing circuits";
      default:
        return "working with project data";
    }
  }

  switch (bin) {
    case "agent-config":
      return "updating agent settings";
    case "boon-conversations":
      return "reviewing past conversations";
    case "boon-estimation":
      return "working on the estimate";
    case "boon-file-host":
      return "preparing file downloads";
    case "boon-mep-design":
      return "working on the MEP design";
    case "boon-skill-creator":
      return "preparing tools";
    case "boon-specs":
      return "reviewing the specifications";
    case "boon-summarize":
      return "summarizing content";
    case "document-ai":
      return "reading a scanned document";
    case "docx-tools":
      return "preparing the document";
    case "electrical-feeder-sheet":
      return "building the feeder sheet";
    case "electrical-lighting-wildcards":
      return "matching lighting fixtures";
    case "electrical-validate":
      return "validating the electrical takeoff";
    case "excel-tools":
      return "working on the workbook";
    case "fetch-history":
      return "reviewing message history";
    case "markitdown":
      return "converting a document";
    case "outlook":
      return "checking email";
    case "pdf-index":
      return "indexing the document";
    case "procore":
      return "syncing with Procore";
    case "structural-validate":
      return "validating the structural takeoff";
    default:
      return undefined;
  }
}
