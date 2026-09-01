import { describe, expect, it } from "vitest";
import { BOON_EXEC_BINARIES, summarizeBoonExecCommand } from "./tool-display-exec-boon.js";

describe("summarizeBoonExecCommand", () => {
  it("summarizes the ticket command with a safe document basename", () => {
    expect(
      summarizeBoonExecCommand([
        "pdf-tools",
        "page-text",
        "~/.boon-agent/workspace/scratch/waseca_98099/E5.10.pdf",
        "--pages=1",
        "2>&1",
        "|",
        "head",
        "-100",
      ]),
    ).toBe("extracting text from E5.10.pdf");
  });

  it("drops unsafe document basenames", () => {
    const longName = `${"a".repeat(60)}.pdf`;
    for (const document of ["$(x).pdf", longName, "unsafe/name/"]) {
      expect(summarizeBoonExecCommand(["pdf-tools", "page-text", document])).toBe(
        "extracting text",
      );
    }
  });

  it("returns undefined for unknown binaries", () => {
    expect(summarizeBoonExecCommand(["other-tools", "page-text", "file.pdf"])).toBeUndefined();
  });

  it.each([
    ["agent-config", "updating agent settings"],
    ["boon-conversations", "reviewing past conversations"],
    ["boon-estimation", "working on the estimate"],
    ["boon-file-host", "preparing file downloads"],
    ["boon-mep-design", "working on the MEP design"],
    ["boon-projects", "working with project data"],
    ["boon-skill-creator", "preparing tools"],
    ["boon-specs", "reviewing the specifications"],
    ["boon-summarize", "summarizing content"],
    ["document-ai", "reading a scanned document"],
    ["docx-tools", "preparing the document"],
    ["electrical-feeder-sheet", "building the feeder sheet"],
    ["electrical-lighting-wildcards", "matching lighting fixtures"],
    ["electrical-validate", "validating the electrical takeoff"],
    ["excel-tools", "working on the workbook"],
    ["fetch-history", "reviewing message history"],
    ["markitdown", "converting a document"],
    ["outlook", "checking email"],
    ["pdf-index", "indexing the document"],
    ["pdf-tools", "working with a PDF document"],
    ["procore", "syncing with Procore"],
    ["structural-validate", "validating the structural takeoff"],
  ])("maps %s to a human summary", (binary, expected) => {
    expect(BOON_EXEC_BINARIES).toContain(binary);
    const summary = summarizeBoonExecCommand([binary]);
    expect(summary).toBe(expected);
    expect(summary).not.toMatch(/^run /);
  });

  it.each([
    ["projects", "checking project data"],
    ["project", "checking project data"],
    ["pages", "checking project data"],
    ["page", "checking project data"],
    ["documents", "checking project data"],
    ["process-status", "checking project data"],
    ["takeoff-status", "checking project data"],
    ["takeoff-data", "checking project data"],
    ["takeoff-overview", "checking project data"],
    ["annotations", "checking project data"],
    ["trades", "checking project data"],
    ["create", "creating a project"],
    ["upload", "uploading a document"],
    ["process", "processing a document"],
    ["takeoff", "running a takeoff"],
    ["page-download", "downloading a drawing"],
    ["detect-circuit-words", "analyzing circuits"],
    ["resolve-circuit-regex", "analyzing circuits"],
  ])("maps boon-projects %s", (subcommand, expected) => {
    expect(summarizeBoonExecCommand(["boon-projects", subcommand])).toBe(expected);
  });

  it("maps unknown boon-projects subcommands to a safe fallback", () => {
    expect(summarizeBoonExecCommand(["boon-projects", "unknown"])).toBe(
      "working with project data",
    );
  });

  it.each([
    ["page-text", "extracting text from file.pdf"],
    ["pages-text", "extracting text from file.pdf"],
    ["page-to-image", "rendering a drawing from file.pdf"],
    ["render", "rendering a drawing from file.pdf"],
    ["info", "inspecting file.pdf"],
    ["toc", "reading the table of contents of file.pdf"],
    ["combine", "combining PDF pages"],
    ["merge", "combining PDF pages"],
  ])("maps pdf-tools %s", (subcommand, expected) => {
    expect(summarizeBoonExecCommand(["pdf-tools", subcommand, "file.pdf"])).toBe(expected);
  });
});
