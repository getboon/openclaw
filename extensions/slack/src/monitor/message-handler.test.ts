// Slack tests cover message handler plugin behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueMock = vi.fn(async (_entry: unknown) => {});
const flushKeyMock = vi.fn(async (_key: string) => {});
const onFlushCallbacks: Array<(entries: Array<Record<string, unknown>>) => Promise<void>> = [];
const prepareSlackMessageMock = vi.fn(async () => ({ ctxPayload: {} }));
const dispatchPreparedSlackMessageMock = vi.fn(async () => {});
const hasSlackInboundMessageDeliveryMock = vi.fn(async () => false);
const recordSlackInboundMessageDeliveriesMock = vi.fn(async () => {});
const resolveThreadTsMock = vi.fn(async ({ message }: { message: Record<string, unknown> }) => ({
  ...message,
}));
const { createSlackMessageHandler } = await import("./message-handler.js");

vi.mock("openclaw/plugin-sdk/channel-inbound", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/channel-inbound")>(
    "openclaw/plugin-sdk/channel-inbound",
  );
  return {
    ...actual,
    createChannelInboundDebouncer: (params: {
      onFlush: (entries: Array<Record<string, unknown>>) => Promise<void>;
    }) => {
      onFlushCallbacks.push(params.onFlush);
      return {
        debounceMs: 10,
        debouncer: {
          enqueue: (entry: unknown) => enqueueMock(entry),
          flushKey: (key: string) => flushKeyMock(key),
        },
      };
    },
    shouldDebounceTextInbound: ({ hasMedia }: { hasMedia?: boolean }) => !hasMedia,
  };
});

vi.mock("./thread-resolution.js", () => ({
  createSlackThreadTsResolver: () => ({
    resolve: (entry: { message: Record<string, unknown> }) => resolveThreadTsMock(entry),
  }),
}));

vi.mock("./message-handler/pipeline.runtime.js", () => ({
  prepareSlackMessage: prepareSlackMessageMock,
  dispatchPreparedSlackMessage: dispatchPreparedSlackMessageMock,
}));

vi.mock("./inbound-delivery-state.js", () => ({
  hasSlackInboundMessageDelivery: hasSlackInboundMessageDeliveryMock,
  recordSlackInboundMessageDeliveries: recordSlackInboundMessageDeliveriesMock,
}));

function createContext(overrides?: {
  markMessageSeen?: (channel: string | undefined, ts: string | undefined) => boolean;
  releaseSeenMessage?: (channel: string | undefined, ts: string | undefined) => void;
}) {
  return {
    cfg: {},
    accountId: "default",
    app: {
      client: {},
    },
    runtime: {},
    markMessageSeen: (channel: string | undefined, ts: string | undefined) =>
      overrides?.markMessageSeen?.(channel, ts) ?? false,
    releaseSeenMessage: (channel: string | undefined, ts: string | undefined) =>
      overrides?.releaseSeenMessage?.(channel, ts),
  } as Parameters<typeof createSlackMessageHandler>[0]["ctx"];
}

function createHandlerWithTracker(overrides?: {
  markMessageSeen?: (channel: string | undefined, ts: string | undefined) => boolean;
  releaseSeenMessage?: (channel: string | undefined, ts: string | undefined) => void;
}) {
  const trackEvent = vi.fn();
  const handler = createSlackMessageHandler({
    ctx: createContext(overrides),
    account: { accountId: "default" } as Parameters<typeof createSlackMessageHandler>[0]["account"],
    trackEvent,
  });
  return { handler, trackEvent };
}

async function handleDirectMessage(
  handler: ReturnType<typeof createHandlerWithTracker>["handler"],
) {
  await handler(
    {
      type: "message",
      channel: "D1",
      ts: "123.456",
      text: "hello",
    } as never,
    { source: "message" },
  );
}

describe("createSlackMessageHandler", () => {
  beforeEach(() => {
    enqueueMock.mockClear();
    flushKeyMock.mockClear();
    onFlushCallbacks.length = 0;
    prepareSlackMessageMock.mockClear();
    dispatchPreparedSlackMessageMock.mockClear();
    hasSlackInboundMessageDeliveryMock.mockReset();
    hasSlackInboundMessageDeliveryMock.mockResolvedValue(false);
    recordSlackInboundMessageDeliveriesMock.mockClear();
    resolveThreadTsMock.mockClear();
  });

  it("does not track invalid non-message events from the message stream", async () => {
    const trackEvent = vi.fn();
    const handler = createSlackMessageHandler({
      ctx: createContext(),
      account: { accountId: "default" } as Parameters<
        typeof createSlackMessageHandler
      >[0]["account"],
      trackEvent,
    });

    await handler(
      {
        type: "reaction_added",
        channel: "D1",
        ts: "123.456",
      } as never,
      { source: "message" },
    );

    expect(trackEvent).not.toHaveBeenCalled();
    expect(resolveThreadTsMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("does not track duplicate messages that are already seen", async () => {
    const { handler, trackEvent } = createHandlerWithTracker({ markMessageSeen: () => true });

    await handleDirectMessage(handler);

    expect(trackEvent).not.toHaveBeenCalled();
    expect(resolveThreadTsMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("tracks accepted non-duplicate messages", async () => {
    const { handler, trackEvent } = createHandlerWithTracker();

    await handleDirectMessage(handler);

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(resolveThreadTsMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("accepts thread_broadcast messages from the message stream", async () => {
    const { handler, trackEvent } = createHandlerWithTracker();

    await handler(
      {
        type: "message",
        subtype: "thread_broadcast",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000300",
        text: "also send to channel",
        thread_ts: "1709000000.000100",
      } as never,
      { source: "message" },
    );

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(resolveThreadTsMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("drops message subtypes that do not carry user message text", async () => {
    const { handler, trackEvent } = createHandlerWithTracker();

    await handler(
      {
        type: "message",
        subtype: "channel_join",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000400",
        text: "<@U111> joined the channel",
      } as never,
      { source: "message" },
    );

    expect(trackEvent).not.toHaveBeenCalled();
    expect(resolveThreadTsMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("flushes pending top-level buffered keys before immediate non-debounce follow-ups", async () => {
    const handler = createSlackMessageHandler({
      ctx: createContext(),
      account: { accountId: "default" } as Parameters<
        typeof createSlackMessageHandler
      >[0]["account"],
    });

    await handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000100",
        text: "first buffered text",
      } as never,
      { source: "message" },
    );
    await handler(
      {
        type: "message",
        subtype: "file_share",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000200",
        text: "file follows",
        files: [{ id: "F1" }],
      } as never,
      { source: "message" },
    );

    expect(flushKeyMock).toHaveBeenCalledWith("slack:default:C111:1709000000.000100:U111");
  });

  it("waits for debounced dispatch completion when requested by relay delivery", async () => {
    const { handler } = createHandlerWithTracker();
    const handled = handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000500",
        text: "relay message",
      } as never,
      { source: "message", awaitDispatch: true },
    );

    await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    let settled = false;
    void handled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await onFlushCallbacks[0]?.([entry]);
    await expect(handled).resolves.toBeUndefined();
    expect(dispatchPreparedSlackMessageMock).toHaveBeenCalledTimes(1);
  });

  it("propagates debounced dispatch failures to relay delivery", async () => {
    dispatchPreparedSlackMessageMock.mockRejectedValueOnce(new Error("dispatch failed"));
    const { handler } = createHandlerWithTracker();
    const handled = handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000600",
        text: "relay message",
      } as never,
      { source: "message", awaitDispatch: true },
    );

    await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const handledFailure = expect(handled).rejects.toThrow("dispatch failed");
    const flushFailure = expect(onFlushCallbacks[0]?.([entry])).rejects.toThrow("dispatch failed");
    await Promise.all([handledFailure, flushFailure]);
  });

  it("preserves an unrelated app_mention's winner marker across a raced message dispatch failure", async () => {
    createHandlerWithTracker();
    const ts = "1709000000.000750";
    const appMentionEntry = {
      message: { type: "app_mention", channel: "C111", user: "U111", ts, text: "<@U1> hi" },
      opts: { source: "app_mention", wasMentioned: true },
    };
    const messageEntry = {
      message: { type: "message", channel: "C111", user: "U111", ts, text: "hi" },
      opts: { source: "message" },
    };

    // Message's flush starts first (finding no app_mention marker set yet) and is
    // held pending mid-dispatch while app_mention's own, separate flush completes.
    let rejectMessageDispatch: ((err: unknown) => void) | undefined;
    const messageDispatchPending = new Promise<void>((_resolve, reject) => {
      rejectMessageDispatch = reject;
    });
    dispatchPreparedSlackMessageMock.mockImplementationOnce(() => messageDispatchPending);
    const messageFlush = onFlushCallbacks[0]?.([messageEntry]);
    await vi.waitFor(() => expect(dispatchPreparedSlackMessageMock).toHaveBeenCalledTimes(1));

    // app_mention now wins the race independently, setting its winner marker
    // while the message's dispatch is still pending.
    dispatchPreparedSlackMessageMock.mockResolvedValueOnce(undefined);
    await onFlushCallbacks[0]?.([appMentionEntry]);
    expect(dispatchPreparedSlackMessageMock).toHaveBeenCalledTimes(2);

    // Rejecting below schedules a real internal retry via setTimeout. Fake
    // timers keep that scheduled retry from firing after this test ends and
    // leaking an extra enqueue call into a later test's assertions.
    vi.useFakeTimers();
    try {
      // Now let the message's raced dispatch settle retryable. A native
      // (non-relay) retry gets scheduled, so the flush resolves rather than
      // rejecting. Its cleanup must only undo its own optimistic state, not
      // app_mention's just-set marker.
      rejectMessageDispatch?.(
        new Error("reply session initialization conflicted for agent:main:slack:channel:C111"),
      );
      await expect(messageFlush).resolves.toBeUndefined();

      // A later replay for the same ts must still be deduped by app_mention's
      // preserved marker rather than dispatching a duplicate reply.
      await onFlushCallbacks[0]?.([messageEntry]);
      expect(dispatchPreparedSlackMessageMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not auto-retry a relay-owned dispatch after a retryable session-init-conflict failure", async () => {
    dispatchPreparedSlackMessageMock.mockRejectedValueOnce(
      new Error("reply session initialization conflicted for agent:main:slack:channel:C111"),
    );
    const { handler } = createHandlerWithTracker();
    const handled = handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000700",
        text: "relay message",
      } as never,
      { source: "message", awaitDispatch: true },
    );

    await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const handledFailure = expect(handled).rejects.toThrow(
      "reply session initialization conflicted",
    );
    const flushFailure = expect(onFlushCallbacks[0]?.([entry])).rejects.toThrow(
      "reply session initialization conflicted",
    );
    await Promise.all([handledFailure, flushFailure]);

    vi.useFakeTimers();
    try {
      // Relay delivery owns retry for awaitDispatch callers; scheduling an
      // internal retry too would race the router redelivery and duplicate a reply.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries native session initialization conflicts through the delivery gates", async () => {
    const releaseSeenMessage = vi.fn();
    dispatchPreparedSlackMessageMock.mockRejectedValueOnce(
      new Error("Slack dispatch failed", {
        cause: new Error(
          "reply session initialization conflicted for agent:main:main:thread:123.456",
        ),
      }),
    );
    const { handler } = createHandlerWithTracker({ releaseSeenMessage });
    await handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000701",
        text: "native message",
      } as never,
      { source: "message" },
    );

    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    vi.useFakeTimers();
    try {
      // A scheduled native retry owns recovery for this race, so the flush
      // resolves instead of rejecting (see the matching production comment).
      await expect(onFlushCallbacks[0]?.([entry])).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);

      expect(releaseSeenMessage).toHaveBeenCalledWith("C111", "1709000000.000701");
      expect(recordSlackInboundMessageDeliveriesMock).not.toHaveBeenCalled();
      expect(hasSlackInboundMessageDeliveryMock).toHaveBeenCalledTimes(2);
      expect(enqueueMock).toHaveBeenCalledTimes(2);
      expect(enqueueMock.mock.calls[1]?.[0]).toMatchObject({
        opts: {
          retryAttempt: 1,
        },
      });
      expect(enqueueMock.mock.calls[1]?.[0]).not.toHaveProperty("opts.dispatchCompletion");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves relay session conflict retries to unacknowledged redelivery", async () => {
    const releaseSeenMessage = vi.fn();
    dispatchPreparedSlackMessageMock.mockRejectedValueOnce(
      new Error("Slack dispatch failed", {
        cause: new Error(
          "reply session initialization conflicted for agent:main:main:thread:123.456",
        ),
      }),
    );
    const { handler } = createHandlerWithTracker({ releaseSeenMessage });
    const handled = handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000800",
        text: "relay message",
      } as never,
      { source: "message", awaitDispatch: true },
    );

    await vi.waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    vi.useFakeTimers();
    try {
      const handledFailure = expect(handled).rejects.toThrow("Slack dispatch failed");
      const flushFailure = expect(onFlushCallbacks[0]?.([entry])).rejects.toThrow(
        "Slack dispatch failed",
      );
      await Promise.all([handledFailure, flushFailure]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(releaseSeenMessage).toHaveBeenCalledWith("C111", "1709000000.000800");
      expect(recordSlackInboundMessageDeliveriesMock).not.toHaveBeenCalled();
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an already-delivered relay event without enqueueing", async () => {
    hasSlackInboundMessageDeliveryMock.mockResolvedValueOnce(true);
    const { handler } = createHandlerWithTracker();

    await expect(
      handler(
        {
          type: "message",
          channel: "C111",
          user: "U111",
          ts: "1709000000.000850",
          text: "relay replay",
        } as never,
        { source: "message", awaitDispatch: true },
      ),
    ).resolves.toBeUndefined();

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("skips a native retry when another delivery already succeeded", async () => {
    dispatchPreparedSlackMessageMock.mockRejectedValueOnce(
      new Error("reply session initialization conflicted for agent:main:main:thread:123.456"),
    );
    hasSlackInboundMessageDeliveryMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { handler } = createHandlerWithTracker();
    await handler(
      {
        type: "message",
        channel: "C111",
        user: "U111",
        ts: "1709000000.000900",
        text: "native message",
      } as never,
      { source: "message" },
    );

    const entry = enqueueMock.mock.calls[0]?.[0] as Record<string, unknown>;
    vi.useFakeTimers();
    try {
      // A scheduled native retry owns recovery for this race, so the flush
      // resolves instead of rejecting (see the matching production comment).
      await expect(onFlushCallbacks[0]?.([entry])).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);

      expect(hasSlackInboundMessageDeliveryMock).toHaveBeenCalledTimes(2);
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
