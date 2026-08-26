// formatSlackWebApiErrorMessage used to append granted:/accepted: scope lists
// to any Slack platform error carrying response_metadata headers — but Slack
// attaches those headers to every response, success or failure, so this
// decorated unrelated errors (e.g. file_update_failed) with a scope list that
// read as a mismatch that wasn't there. `needed` is the field Slack only sets
// on a genuine missing_scope failure, so the decoration is now gated on it.
import { describe, expect, it, vi } from "vitest";
import { createSlackSendTestClient } from "./blocks.test-helpers.js";

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  logVerbose: vi.fn(),
  danger: (message: string) => message,
  shouldLogVerbose: () => false,
}));

const { sendMessageSlack } = await import("./send.js");
const SLACK_TEST_CFG = { channels: { slack: { botToken: "xoxb-test" } } };

type SlackApiError = Error & {
  data?: {
    error?: string;
    needed?: string;
    response_metadata?: { scopes?: string[]; acceptedScopes?: string[] };
  };
};

function buildSlackApiError(params: {
  code: string;
  needed?: string;
  scopes?: string[];
  acceptedScopes?: string[];
}): SlackApiError {
  const err = new Error(`An API error occurred: ${params.code}`) as SlackApiError;
  err.data = {
    error: params.code,
    ...(params.needed ? { needed: params.needed } : {}),
    response_metadata: {
      ...(params.scopes ? { scopes: params.scopes } : {}),
      ...(params.acceptedScopes ? { acceptedScopes: params.acceptedScopes } : {}),
    },
  };
  return err;
}

async function captureSendError(
  client: ReturnType<typeof createSlackSendTestClient>,
): Promise<string> {
  try {
    await sendMessageSlack("channel:C123", "hello", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected sendMessageSlack to reject");
}

describe("sendMessageSlack error scope decoration", () => {
  it("appends no scope decoration to a non-scope error, even with scope headers present", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(
      buildSlackApiError({
        code: "file_update_failed",
        scopes: ["chat:write", "files:write"],
        acceptedScopes: ["files:write"],
      }),
    );

    // Exact equality, not substring: a decorated message would also contain
    // "file_update_failed", so only exact equality proves nothing was appended.
    expect(await captureSendError(client)).toBe("An API error occurred: file_update_failed");
  });

  it("still appends needed/granted/accepted on a genuine missing_scope failure", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(
      buildSlackApiError({
        code: "missing_scope",
        needed: "files:write",
        scopes: ["chat:write"],
        acceptedScopes: ["files:write"],
      }),
    );

    expect(await captureSendError(client)).toBe(
      "An API error occurred: missing_scope (needed: files:write; granted: chat:write; accepted: files:write)",
    );
  });

  it("omits decoration for the exact file_update_failed production repro", async () => {
    const client = createSlackSendTestClient();
    vi.mocked(client.chat.postMessage).mockRejectedValueOnce(
      buildSlackApiError({
        code: "file_update_failed",
        scopes: [
          "app_mentions:read",
          "chat:write",
          "files:read",
          "channels:history",
          "groups:history",
          "users:read",
          "files:write",
        ],
        acceptedScopes: ["files:write"],
      }),
    );

    expect(await captureSendError(client)).toBe("An API error occurred: file_update_failed");
  });
});
