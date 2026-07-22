// Slack tests cover send.ts invalid-thread retry-to-channel (ENG-16286).
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSlackSendTestClient } from "./blocks.test-helpers.js";

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  logVerbose: vi.fn(),
  danger: (message: string) => message,
  shouldLogVerbose: () => false,
}));

const { sendMessageSlack } = await import("./send.js");
const SLACK_TEST_CFG = { channels: { slack: { botToken: "xoxb-test" } } };

type SlackApiError = Error & { data?: { error?: string } };

function buildSlackApiError(code: string): SlackApiError {
  const err = new Error(`An API error occurred: ${code}`) as SlackApiError;
  err.data = { error: code };
  return err;
}

function readPostMessagePayload(
  client: ReturnType<typeof createSlackSendTestClient>,
  index: number,
): Record<string, unknown> {
  const call = vi.mocked(client.chat.postMessage).mock.calls[index];
  if (!call) {
    throw new Error(`expected Slack postMessage call #${index + 1}`);
  }
  const [payload] = call;
  if (!payload || typeof payload !== "object") {
    throw new Error(`expected Slack postMessage payload #${index + 1}`);
  }
  return payload as Record<string, unknown>;
}

describe("sendMessageSlack invalid-thread retry-to-channel", () => {
  beforeEach(() => {
    vi.mocked(logVerbose).mockClear();
  });

  it("retries WITHOUT thread_ts when Slack rejects the anchor as invalid_thread_ts", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage)
      .mockRejectedValueOnce(buildSlackApiError("invalid_thread_ts"))
      .mockResolvedValueOnce({ ts: "171234.567" });

    const result = await sendMessageSlack("channel:C123", "hello", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      threadTs: "171200.deleted",
    });

    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    // First attempt carried the (now-invalid) thread anchor…
    expect(readPostMessagePayload(client, 0)).toMatchObject({
      channel: "C123",
      text: "hello",
      thread_ts: "171200.deleted",
    });
    // …the retry drops it so the reply lands in the channel.
    expect(readPostMessagePayload(client, 1)).not.toHaveProperty("thread_ts");
    expect(result.messageId).toBe("171234.567");
    expect(vi.mocked(logVerbose)).toHaveBeenCalledWith(
      "slack send: thread_ts 171200.deleted rejected as invalid; retrying to channel",
    );
  });

  it("retries to channel on thread_not_found too", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage)
      .mockRejectedValueOnce(buildSlackApiError("thread_not_found"))
      .mockResolvedValueOnce({ ts: "171234.999" });

    await sendMessageSlack("channel:C123", "hello", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      threadTs: "171200.gone",
    });

    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
    expect(readPostMessagePayload(client, 1)).not.toHaveProperty("thread_ts");
  });

  it("does NOT retry (rethrows) for unrelated errors", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(
      buildSlackApiError("channel_not_found"),
    );

    await expect(
      sendMessageSlack("channel:C123", "hello", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
        threadTs: "171200.100",
      }),
    ).rejects.toThrow("channel_not_found");

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry when there was no thread_ts to begin with", async () => {
    const client = createSlackSendTestClient();
    // A top-level send that fails invalid_thread_ts (shouldn't happen, but guard
    // against a retry loop): no thread_ts → rethrow, single attempt.
    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(
      buildSlackApiError("invalid_thread_ts"),
    );

    await expect(
      sendMessageSlack("channel:C123", "hello", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
      }),
    ).rejects.toThrow("invalid_thread_ts");

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
  });
});
