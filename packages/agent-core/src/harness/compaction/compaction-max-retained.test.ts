import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../types.js";
import type { SessionTreeEntry } from "../types.js";
import { estimateTokens, findCutPoint } from "./compaction.js";

// Each message is ~10k tokens (40k chars / 4). A generous keepRecentTokens
// retains a long recent tail; when that tail would itself overflow the window,
// maxRetainedTokens must advance the cut forward (the ENG-16323 dead-end).
const TURN_TEXT = "x".repeat(40_000);
// Large enough that the default cut retains many turns verbatim.
const KEEP_RECENT_TOKENS = 120_000;

function userText(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantText(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-fable-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function messageEntry(message: AgentMessage, index: number): SessionTreeEntry {
  return {
    type: "message",
    id: `entry-${index}`,
    parentId: index === 0 ? null : `entry-${index - 1}`,
    timestamp: new Date(message.timestamp).toISOString(),
    message,
  };
}

// A long run of user/assistant turns; each user message is a valid cut point.
function buildLongTranscript(): SessionTreeEntry[] {
  const messages: AgentMessage[] = [];
  let ts = 1;
  for (let turn = 0; turn < 8; turn += 1) {
    messages.push(userText(`${TURN_TEXT} turn ${turn}`, ts++));
    messages.push(assistantText(`${TURN_TEXT} reply ${turn}`, ts++));
  }
  return messages.map((message, index) => messageEntry(message, index));
}

function retainedTokens(entries: SessionTreeEntry[], cutIndex: number): number {
  let tokens = 0;
  for (let i = cutIndex; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.type === "message") {
      tokens += estimateTokens(entry.message);
    }
  }
  return tokens;
}

describe("findCutPoint adaptive keep-recent floor", () => {
  it("keeps default behavior when no maxRetainedTokens is supplied", () => {
    const entries = buildLongTranscript();
    const withoutCap = findCutPoint(entries, 0, entries.length, KEEP_RECENT_TOKENS);
    const explicitUndefined = findCutPoint(
      entries,
      0,
      entries.length,
      KEEP_RECENT_TOKENS,
      undefined,
    );
    expect(explicitUndefined.firstKeptEntryIndex).toBe(withoutCap.firstKeptEntryIndex);
  });

  it("advances the cut so the retained tail fits maxRetainedTokens", () => {
    const entries = buildLongTranscript();
    const maxRetainedTokens = 30_000;

    const withoutCap = findCutPoint(entries, 0, entries.length, KEEP_RECENT_TOKENS);
    const withCap = findCutPoint(entries, 0, entries.length, KEEP_RECENT_TOKENS, maxRetainedTokens);

    // The cap moves the cut forward (more history summarized, less retained verbatim).
    expect(withCap.firstKeptEntryIndex).toBeGreaterThan(withoutCap.firstKeptEntryIndex);
    expect(retainedTokens(entries, withCap.firstKeptEntryIndex)).toBeLessThanOrEqual(
      maxRetainedTokens,
    );
  });

  it("falls back to the newest cut point when a single tail turn cannot fit", () => {
    const entries = buildLongTranscript();
    // Smaller than a single turn's tokens, so nothing can fully fit.
    const maxRetainedTokens = 1_000;

    const withCap = findCutPoint(entries, 0, entries.length, KEEP_RECENT_TOKENS, maxRetainedTokens);

    // Still advances as far forward as possible rather than retaining the whole tail.
    const withoutCap = findCutPoint(entries, 0, entries.length, KEEP_RECENT_TOKENS);
    expect(withCap.firstKeptEntryIndex).toBeGreaterThanOrEqual(withoutCap.firstKeptEntryIndex);
    expect(withCap.firstKeptEntryIndex).toBeGreaterThan(0);
  });
});
