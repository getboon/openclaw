/**
 * End-to-end coverage for the memory-flush date-rollover fix (ENG-21229).
 * Drives the REAL production call chain — createOpenClawCodingTools (agent-tools.ts)
 * building and wrapping the write tool, through to an actual filesystem write — with
 * only the wall clock faked, to prove the fix is correctly wired end to end rather
 * than only correct in the isolated unit test of the wrapper function.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  clearMemoryPluginState,
  registerMemoryFlushPlanResolver,
} from "../plugins/memory-state.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-openclaw-tools.js";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { resolveUserTimezone } from "./date-time.js";

type OpenClawCodingTool = ReturnType<typeof createOpenClawCodingTools>[number];

function requireTool(tools: OpenClawCodingTool[], name: string): OpenClawCodingTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`expected ${name} tool`);
  }
  return tool;
}

function requireToolExecute(tool: OpenClawCodingTool): NonNullable<OpenClawCodingTool["execute"]> {
  if (!tool.execute) {
    throw new Error(`expected ${tool.name} tool execute`);
  }
  return tool.execute;
}

// Mirrors extensions/memory-core's formatDateStampInTimezone — reimplemented rather
// than imported, since src/agents is core and must not depend on an extension
// package. Uses the same real core timezone-resolution helper the extension itself
// is built on (./date-time.js's resolveUserTimezone).
function dateStampInTimezone(nowMs: number, configuredTimezone?: string): string {
  const timezone = resolveUserTimezone(configuredTimezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function registerRealisticFlushPlanResolver(cfg: OpenClawConfig) {
  registerMemoryFlushPlanResolver((params) => ({
    softThresholdTokens: 4000,
    forceFlushTranscriptBytes: 2 * 1024 * 1024,
    reserveTokensFloor: 0,
    prompt: "flush",
    systemPrompt: "flush",
    relativePath: `memory/${dateStampInTimezone(
      params.nowMs ?? Date.now(),
      cfg.agents?.defaults?.userTimezone,
    )}.md`,
  }));
}

describe("memory-flush date rollover (e2e)", () => {
  afterEach(() => {
    clearMemoryPluginState();
    vi.restoreAllMocks();
  });

  it("accepts a write to today's real date-stamped path after the pinned path goes stale across midnight", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-memflush-"));
    const cfg: OpenClawConfig = { agents: { defaults: { userTimezone: "UTC" } } };
    registerRealisticFlushPlanResolver(cfg);

    // 2026-10-07 23:00 UTC — the moment the flush tool set is built (pinned).
    const beforeMidnightMs = Date.UTC(2026, 9, 7, 23, 0, 0);
    // 2026-10-08 01:00 UTC — the moment the write actually executes, after a
    // provider-retry/backoff delay carried the turn past midnight.
    const afterMidnightMs = Date.UTC(2026, 9, 8, 1, 0, 0);

    try {
      const stalePath = `memory/${dateStampInTimezone(beforeMidnightMs, "UTC")}.md`;
      expect(stalePath).toBe("memory/2026-10-07.md");

      // Real production entrypoint: agent-tools.ts builds and wraps the write
      // tool exactly as the live embedded-agent runner does for a memory-flush
      // attempt, including the ENG-21229 cfg wiring into the append-only guard.
      const tools = createOpenClawCodingTools({
        workspaceDir,
        trigger: "memory",
        memoryFlushWritePath: stalePath,
        config: cfg,
      });
      const writeExecute = requireToolExecute(requireTool(tools, "write"));

      vi.spyOn(Date, "now").mockReturnValue(afterMidnightMs);
      const currentPath = `memory/${dateStampInTimezone(afterMidnightMs, "UTC")}.md`;
      expect(currentPath).toBe("memory/2026-10-08.md");

      const result = await writeExecute("flush-after-rollover", {
        path: currentPath,
        content: "durable note captured after the rollover",
      });

      expect(result.details).toEqual({ path: currentPath, appendOnly: true });
      await expect(fs.readFile(path.join(workspaceDir, currentPath), "utf-8")).resolves.toBe(
        "durable note captured after the rollover",
      );

      // Negative control: the restriction is still real, not disabled wholesale.
      await expect(
        writeExecute("flush-after-rollover-reject", {
          path: "memory/not-a-valid-day.md",
          content: "should never land",
        }),
      ).rejects.toThrow(/Memory flush writes are restricted to/);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("still restricts writes to the single pinned path when no flush-plan resolver is registered", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-memflush-pinned-"));
    const pinnedPath = "memory/2026-10-07.md";

    try {
      const tools = createOpenClawCodingTools({
        workspaceDir,
        trigger: "memory",
        memoryFlushWritePath: pinnedPath,
      });
      const writeExecute = requireToolExecute(requireTool(tools, "write"));

      const result = await writeExecute("flush-pinned", {
        path: pinnedPath,
        content: "same-day note",
      });
      expect(result.details).toEqual({ path: pinnedPath, appendOnly: true });

      await expect(
        writeExecute("flush-pinned-reject", {
          path: "memory/2026-10-08.md",
          content: "should not be accepted without a registered plan",
        }),
      ).rejects.toThrow(`Memory flush writes are restricted to ${pinnedPath}; use that path only.`);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
