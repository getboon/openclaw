// Heartbeat staged source-reply selector tests.
import { describe, expect, it } from "vitest";
import { resolveHeartbeatSourceReplyPayloads } from "./heartbeat-reply-payload.js";
import {
  markReplyPayloadForSourceSuppressionDelivery,
  setReplyPayloadMetadata,
} from "./reply-payload.js";
import type { ReplyPayload } from "./types.js";

const SESSION_KEY = "agent:main:msteams:direct:29:peer-1";

function staged(text: string, sessionKey = SESSION_KEY): ReplyPayload {
  const payload = markReplyPayloadForSourceSuppressionDelivery<ReplyPayload>({ text });
  return setReplyPayloadMetadata(payload, {
    sourceReplyTranscriptMirror: { sessionKey, text },
  });
}

describe("resolveHeartbeatSourceReplyPayloads", () => {
  it("returns staged replies for the session in order", () => {
    const first = staged("first");
    const second = staged("second");
    const final: ReplyPayload = { text: "Done." };
    expect(
      resolveHeartbeatSourceReplyPayloads([first, final, second], {
        sessionKey: SESSION_KEY,
        exclude: final,
      }),
    ).toEqual([first, second]);
  });

  it("excludes the selected heartbeat reply payload", () => {
    const first = staged("first");
    const last = staged("last");
    const result = resolveHeartbeatSourceReplyPayloads([first, last], {
      sessionKey: SESSION_KEY,
      exclude: last,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first);
  });

  it("skips staged replies for another session", () => {
    expect(
      resolveHeartbeatSourceReplyPayloads([staged("other", "agent:main:main")], {
        sessionKey: SESSION_KEY,
      }),
    ).toEqual([]);
  });

  it("skips reasoning, empty, and unmarked payloads", () => {
    const reasoning = setReplyPayloadMetadata<ReplyPayload>(
      { text: "thinking", isReasoning: true },
      { sourceReplyTranscriptMirror: { sessionKey: SESSION_KEY } },
    );
    const empty = staged("");
    const failureNotice = markReplyPayloadForSourceSuppressionDelivery<ReplyPayload>({
      text: "The run failed.",
    });
    expect(
      resolveHeartbeatSourceReplyPayloads([reasoning, empty, failureNotice], {
        sessionKey: SESSION_KEY,
      }),
    ).toEqual([]);
  });

  it("accepts a scalar reply result", () => {
    const payload = staged("only");
    expect(resolveHeartbeatSourceReplyPayloads(payload, { sessionKey: SESSION_KEY })).toEqual([
      payload,
    ]);
    expect(
      resolveHeartbeatSourceReplyPayloads(payload, { sessionKey: SESSION_KEY, exclude: payload }),
    ).toEqual([]);
    expect(resolveHeartbeatSourceReplyPayloads(undefined, { sessionKey: SESSION_KEY })).toEqual([]);
  });
});
