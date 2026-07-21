// Slack tests cover thread-anchor recovery via conversations.history (ENG-16286).
//
// When a streaming reply's thread_ts is rejected as invalid_thread_ts (the user
// deleted/edited the anchoring message, or the anchor was a non-root reply
// rather than a thread root), the dispatch fallback re-resolves the real thread
// root through conversations.history before re-posting, instead of reusing the
// rejected anchor and orphaning the reply to the channel top level.
import { describe, expect, it, vi } from "vitest";
import { resolveThreadTsFromHistory } from "./thread-resolution.js";

describe("resolveThreadTsFromHistory (invalid-thread anchor recovery)", () => {
  it("recovers the thread root when the anchor ts is a non-root reply", async () => {
    const history = vi.fn(async () => ({
      messages: [{ ts: "1784557180.030559", thread_ts: "1784557100.000100" }],
    }));
    const resolved = await resolveThreadTsFromHistory({
      client: { conversations: { history } } as never,
      channelId: "C0B373G91AN",
      messageTs: "1784557180.030559",
    });
    expect(resolved).toBe("1784557100.000100");
    expect(history).toHaveBeenCalledWith({
      channel: "C0B373G91AN",
      latest: "1784557180.030559",
      oldest: "1784557180.030559",
      inclusive: true,
      limit: 1,
    });
  });

  it("returns undefined when the anchoring message is gone (deleted)", async () => {
    const history = vi.fn(async () => ({ messages: [] }));
    const resolved = await resolveThreadTsFromHistory({
      client: { conversations: { history } } as never,
      channelId: "C0B373G91AN",
      messageTs: "1784557180.030559",
    });
    expect(resolved).toBeUndefined();
  });

  it("returns undefined (deterministic channel fallback) when history lookup throws", async () => {
    const history = vi.fn(async () => {
      throw new Error("ratelimited");
    });
    const resolved = await resolveThreadTsFromHistory({
      client: { conversations: { history } } as never,
      channelId: "C0B373G91AN",
      messageTs: "1784557180.030559",
    });
    expect(resolved).toBeUndefined();
  });
});
