// ENG-16330 — outcome-aware channel surfacing (path trail vs. false ⚠️ failed).
// Pure-logic tests for the classifier + trail synthesis; the handler wiring is
// covered separately in embedded-agent-subscribe.handlers.tools.test.ts.
import { describe, expect, it } from "vitest";
import {
  classifyToolSurfacing,
  createTurnErrorBuffer,
  sanitizeGeneratedSessionName,
  synthesizePathTrail,
} from "./intelligent-messaging.js";

describe("classifyToolSurfacing", () => {
  it("buffers a recoverable non-zero exec error (candidate for path-trail suppression)", () => {
    const decision = classifyToolSurfacing({
      toolName: "exec",
      isToolError: true,
      result: { details: { status: "failed", exitCode: 1, name: "salty-shore" } },
    });
    expect(decision.mode).toBe("buffer-recoverable");
  });

  it("buffers a recoverable non-zero process (bg session) error", () => {
    const decision = classifyToolSurfacing({
      toolName: "process",
      isToolError: true,
      result: { details: { status: "failed", exitCode: 2, name: "quiet-harbor" } },
    });
    expect(decision.mode).toBe("buffer-recoverable");
  });

  it("buffers a recoverable non-zero tmux error", () => {
    const decision = classifyToolSurfacing({
      toolName: "tmux",
      isToolError: true,
      result: { details: { status: "failed", exitCode: 1 } },
    });
    expect(decision.mode).toBe("buffer-recoverable");
  });

  it("surfaces a NON-recoverable tool error (auth/quota/delivery) immediately", () => {
    // message/delivery + auth failures are terminal-ish; the user must see them now,
    // never buffered into silence.
    const decision = classifyToolSurfacing({
      toolName: "message",
      isToolError: true,
      result: { details: { status: "failed", error: "allocation_exhausted" } },
    });
    expect(decision.mode).toBe("immediate");
  });

  it("surfaces a RECOVERABLE tool immediately when it carries a TERMINAL signal (looksTerminal branch)", () => {
    // exec/process/tmux are normally buffer-recoverable, but a terminal error signal
    // (auth/quota/forbidden) must escalate to immediate — the user has to see it now,
    // not have it hidden behind a path trail. Guards the looksTerminal branch.
    for (const signal of ["unauthorized", "forbidden", "quota", "allocation_exhausted"]) {
      const viaError = classifyToolSurfacing({
        toolName: "exec",
        isToolError: true,
        result: { details: { status: "failed", exitCode: 1, error: `graph ${signal}` } },
      });
      expect(viaError.mode, `error=${signal}`).toBe("immediate");
    }
    // also via errorCode field
    const viaCode = classifyToolSurfacing({
      toolName: "process",
      isToolError: true,
      result: { details: { status: "failed", errorCode: "invalid_api_key" } },
    });
    expect(viaCode.mode).toBe("immediate");
  });

  it("does not touch a successful tool result", () => {
    const decision = classifyToolSurfacing({
      toolName: "exec",
      isToolError: false,
      result: { details: { status: "completed", exitCode: 0 } },
    });
    expect(decision.mode).toBe("passthrough");
  });
});

describe("turn error buffer + turn-close resolution", () => {
  it("SUCCESS turn-close: recovered errors hidden from channel, path trail synthesized", () => {
    const buf = createTurnErrorBuffer();
    buf.record({ toolName: "exec", sessionName: "salty-shore", summary: "list files in scratch" });
    buf.record({ toolName: "process", sessionName: "quiet-harbor", summary: "find the plan set" });

    const resolved = buf.resolve({ turnSucceeded: true });

    expect(resolved.emitFailureBadges).toEqual([]); // no ⚠️ failed to the channel
    expect(resolved.pathTrail).toBeTruthy();
    // path trail is human-readable, conveys recovery + continuation, NO raw session names
    expect(resolved.pathTrail).not.toMatch(/salty-shore|quiet-harbor/);
    expect(resolved.pathTrail?.toLowerCase()).toContain("recovered");
  });

  it("FAILED turn-close: buffered errors flush as real failure badges (no #53 regression)", () => {
    const buf = createTurnErrorBuffer();
    buf.record({ toolName: "exec", sessionName: "salty-shore", summary: "list files" });

    const resolved = buf.resolve({ turnSucceeded: false });

    expect(resolved.emitFailureBadges.length).toBe(1);
    expect(resolved.pathTrail).toBeUndefined();
  });

  it("empty buffer on a success turn produces no trail (nothing to say)", () => {
    const buf = createTurnErrorBuffer();
    const resolved = buf.resolve({ turnSucceeded: true });
    expect(resolved.pathTrail).toBeUndefined();
    expect(resolved.emitFailureBadges).toEqual([]);
  });
});

describe("sanitizeGeneratedSessionName", () => {
  it("replaces adjective-noun generated names with a generic phrase", () => {
    expect(sanitizeGeneratedSessionName("salty-shore")).toBe("a background command");
    expect(sanitizeGeneratedSessionName("quiet-harbor")).toBe("a background command");
  });

  it("passes a meaningful/explicit name through (not a generated one)", () => {
    expect(sanitizeGeneratedSessionName("build-takeoff-xlsx")).toBe("build-takeoff-xlsx");
  });
});

describe("synthesizePathTrail", () => {
  it("produces one short human line from recovered steps, no session names", () => {
    const trail = synthesizePathTrail([
      { toolName: "exec", sessionName: "salty-shore", summary: "list files in scratch" },
    ]);
    expect(trail).toBeTruthy();
    expect(trail).not.toContain("salty-shore");
    expect(trail!.split("\n").length).toBe(1);
  });
});
