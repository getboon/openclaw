import { describe, expect, it } from "vitest";
import { BOON_EXEC_BINARIES } from "../agents/tool-display-exec-boon.js";
import { sanitizeNudgeProgressText } from "./progress-nudge-runner.js";

describe("sanitizeNudgeProgressText", () => {
  it.each([
    "|",
    "2>&1",
    "`command`",
    "~/workspace",
    "/home/user/workspace",
    "$(echo unsafe)",
    "first && second",
    "command; next",
    "command > output",
    "command >> output",
    "<(command)",
    "pdf-tools page-text file.pdf",
    "boon-projects list",
    "boon-estimation run",
    "excel-tools read",
    "docx-tools convert",
    "document-ai scan",
    "markitdown file.pdf",
    "openclaw status",
    ".boon-agent/workspace",
  ])("rejects banned content: %s", (text) => {
    expect(sanitizeNudgeProgressText(text)).toBeUndefined();
  });

  it.each(["run command", "bash command", "exec command", "command run command"])(
    "rejects generic command phrase: %s",
    (text) => {
      expect(sanitizeNudgeProgressText(text)).toBeUndefined();
    },
  );

  it("trims safe text", () => {
    expect(sanitizeNudgeProgressText("  your 40 pages  ")).toBe("your 40 pages");
  });

  it("rejects empty, multiline, and oversized text", () => {
    expect(sanitizeNudgeProgressText("   ")).toBeUndefined();
    expect(sanitizeNudgeProgressText("first\nsecond")).toBeUndefined();
    expect(sanitizeNudgeProgressText("a".repeat(141))).toBeUndefined();
  });

  it("matches banned content case-insensitively", () => {
    expect(sanitizeNudgeProgressText("PDF-TOOLS page-text file.pdf")).toBeUndefined();
    expect(sanitizeNudgeProgressText("OPENCLAW status")).toBeUndefined();
  });

  it("rejects every mapped Boon CLI name", () => {
    for (const binary of BOON_EXEC_BINARIES) {
      expect(sanitizeNudgeProgressText(`working with ${binary}`)).toBeUndefined();
    }
  });

  it("rejects path-bearing command summaries", () => {
    expect(sanitizeNudgeProgressText("show /etc/passwd")).toBeUndefined();
    expect(sanitizeNudgeProgressText("run python3 /opt/boon/internal_job.py")).toBeUndefined();
  });

  it("accepts ordinary progress text", () => {
    expect(sanitizeNudgeProgressText("extracting text from E5.10.pdf")).toBe(
      "extracting text from E5.10.pdf",
    );
    expect(sanitizeNudgeProgressText("Checking the app-server stream")).toBe(
      "Checking the app-server stream",
    );
    expect(sanitizeNudgeProgressText("your 40 pages")).toBe("your 40 pages");
    expect(sanitizeNudgeProgressText(undefined)).toBeUndefined();
  });
});
