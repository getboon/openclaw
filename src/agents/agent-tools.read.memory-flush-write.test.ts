/**
 * Covers the memory-flush append-only write guard's handling of a date rollover
 * (ENG-21229). The allowed path is pinned when the memory-flush tool set is built,
 * which can predate actual tool execution by an unbounded amount (provider
 * fallback/retry backoff, a long-running flush turn) — long enough to cross
 * midnight. The wrapper must re-derive "today" at execute() time rather than only
 * ever honoring the path it was built with.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearMemoryPluginState,
  registerMemoryFlushPlanResolver,
} from "../plugins/memory-state.js";
import { wrapToolMemoryFlushAppendOnlyWrite } from "./agent-tools.read.js";
import type { AnyAgentTool } from "./agent-tools.types.js";

const STALE_RELATIVE_PATH = "memory/2026-10-07.md";
const CURRENT_RELATIVE_PATH = "memory/2026-10-08.md";

function createMemoryFlushPlan(relativePath: string) {
  return {
    softThresholdTokens: 1,
    forceFlushTranscriptBytes: 2,
    reserveTokensFloor: 3,
    prompt: relativePath,
    systemPrompt: relativePath,
    relativePath,
  };
}

function createPassthroughWriteTool(): AnyAgentTool {
  return {
    name: "write",
    label: "write",
    description: "Write content to a file.",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      throw new Error("append-only wrapper should not delegate to the base write tool");
    },
  };
}

describe("wrapToolMemoryFlushAppendOnlyWrite date rollover", () => {
  let tmpDir: string;

  afterEach(async () => {
    clearMemoryPluginState();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("still accepts the pinned path when no fresher plan is registered (regression)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memflush-pinned-"));
    const wrapped = wrapToolMemoryFlushAppendOnlyWrite(createPassthroughWriteTool(), {
      root: tmpDir,
      relativePath: STALE_RELATIVE_PATH,
    });

    const result = await wrapped.execute("call-pinned", {
      path: STALE_RELATIVE_PATH,
      content: "note",
    });

    expect(result.details).toEqual({ path: STALE_RELATIVE_PATH, appendOnly: true });
    await expect(fs.readFile(path.join(tmpDir, STALE_RELATIVE_PATH), "utf-8")).resolves.toBe(
      "note",
    );
  });

  it("accepts a write to today's path when the pinned path went stale across midnight", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memflush-rollover-"));
    registerMemoryFlushPlanResolver(() => createMemoryFlushPlan(CURRENT_RELATIVE_PATH));

    // Built (pinned) before midnight; executes after — exactly the ENG-21229 shape.
    const wrapped = wrapToolMemoryFlushAppendOnlyWrite(createPassthroughWriteTool(), {
      root: tmpDir,
      relativePath: STALE_RELATIVE_PATH,
      cfg: {},
    });

    const result = await wrapped.execute("call-rollover", {
      path: CURRENT_RELATIVE_PATH,
      content: "today's note",
    });

    expect(result.content).toEqual([
      { type: "text", text: `Appended content to ${CURRENT_RELATIVE_PATH}.` },
    ]);
    expect(result.details).toEqual({ path: CURRENT_RELATIVE_PATH, appendOnly: true });
    await expect(fs.readFile(path.join(tmpDir, CURRENT_RELATIVE_PATH), "utf-8")).resolves.toBe(
      "today's note",
    );
  });

  it("still rejects a path that matches neither the pinned nor the current date, naming both", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memflush-reject-"));
    registerMemoryFlushPlanResolver(() => createMemoryFlushPlan(CURRENT_RELATIVE_PATH));

    const wrapped = wrapToolMemoryFlushAppendOnlyWrite(createPassthroughWriteTool(), {
      root: tmpDir,
      relativePath: STALE_RELATIVE_PATH,
      cfg: {},
    });

    await expect(
      wrapped.execute("call-reject", { path: "memory/unrelated-day.md", content: "nope" }),
    ).rejects.toThrow(
      `Memory flush writes are restricted to ${STALE_RELATIVE_PATH} or ${CURRENT_RELATIVE_PATH}; use that path only.`,
    );
  });

  it("still accepts the pinned path on same-day retries once the plan matches it again", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-memflush-sameday-"));
    registerMemoryFlushPlanResolver(() => createMemoryFlushPlan(STALE_RELATIVE_PATH));

    const wrapped = wrapToolMemoryFlushAppendOnlyWrite(createPassthroughWriteTool(), {
      root: tmpDir,
      relativePath: STALE_RELATIVE_PATH,
      cfg: {},
    });

    const result = await wrapped.execute("call-sameday", {
      path: STALE_RELATIVE_PATH,
      content: "same-day note",
    });

    expect(result.details).toEqual({ path: STALE_RELATIVE_PATH, appendOnly: true });
    await expect(fs.readFile(path.join(tmpDir, STALE_RELATIVE_PATH), "utf-8")).resolves.toBe(
      "same-day note",
    );

    await expect(
      wrapped.execute("call-sameday-reject", { path: "memory/unrelated-day.md", content: "nope" }),
    ).rejects.toThrow(
      `Memory flush writes are restricted to ${STALE_RELATIVE_PATH}; use that path only.`,
    );
  });
});
