// Coverage for the streaming→payload tool-meta normalization boundary.
import { describe, expect, it } from "vitest";
import { normalizeToolMetas } from "./normalize-tool-metas.js";

describe("normalizeToolMetas", () => {
  it("preserves the per-call `errored` flag so multi-failure step counts stay accurate", () => {
    // Regression: this boundary previously dropped `errored`, which silently
    // defeated the payload-side per-outcome step count and forced the buggy
    // `length - 1` fallback (cubic P2 review follow-up).
    const normalized = normalizeToolMetas([
      { toolName: "bash", meta: "ls", errored: false },
      { toolName: "read", meta: "config.json", errored: true },
      { toolName: "message", errored: true },
    ]);
    expect(normalized.map((entry) => entry.errored)).toEqual([false, true, true]);
    // The count the payload builder derives: only non-errored tools completed.
    expect(normalized.filter((entry) => !entry.errored).length).toBe(1);
  });

  it("omits `errored` when the source never tagged an outcome (legacy entries)", () => {
    const normalized = normalizeToolMetas([{ toolName: "web_search", meta: "q=hi" }]);
    expect(normalized).toHaveLength(1);
    expect("errored" in normalized[0]).toBe(false);
  });

  it("carries forward the `blocked` status so the audit trace can classify denied calls", () => {
    // Regression (ENG-16854): the collector marks approval-unavailable /
    // never-started calls `status:"blocked"` with `errored:false`. If this
    // boundary drops `status`, buildTraceToolSummary sees `{errored:false}` and
    // mis-classifies a permission-blocked call as `ok` — reporting a blocked run
    // as a verified success.
    const normalized = normalizeToolMetas([
      { toolName: "exec", status: "blocked", errored: false },
      { toolName: "read", errored: false },
    ]);
    expect(normalized.map((entry) => entry.status)).toEqual(["blocked", undefined]);
  });

  it("drops entries without a usable tool name", () => {
    const normalized = normalizeToolMetas([
      { toolName: "", errored: true },
      { toolName: "   ", errored: false },
      { meta: "orphan" },
      { toolName: "read", errored: false },
    ]);
    expect(normalized.map((entry) => entry.toolName)).toEqual(["read"]);
  });

  it("carries forward replaySafe and async task fields", () => {
    const normalized = normalizeToolMetas([
      {
        toolName: "image_generate",
        replaySafe: true,
        asyncStarted: true,
        asyncTaskRunId: "run-1",
        asyncTaskId: "task-1",
        errored: false,
      },
    ]);
    expect(normalized[0]).toMatchObject({
      toolName: "image_generate",
      replaySafe: true,
      asyncStarted: true,
      asyncTaskRunId: "run-1",
      asyncTaskId: "task-1",
      errored: false,
    });
  });

  it("defaults replaySafe to false when unset", () => {
    const normalized = normalizeToolMetas([{ toolName: "exec" }]);
    expect(normalized[0].replaySafe).toBe(false);
    expect(normalized[0].asyncStarted).toBeUndefined();
  });
});
