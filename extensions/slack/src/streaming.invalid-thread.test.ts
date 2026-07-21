// Slack tests cover invalid-thread finalize-error classification (ENG-16286).
import { describe, expect, it } from "vitest";
import { isInvalidThreadSlackError } from "./streaming.js";

function slackApiError(code: string): Error {
  const err = new Error(`An API error occurred: ${code}`);
  (err as unknown as { data: { error: string } }).data = { error: code };
  return err;
}

describe("isInvalidThreadSlackError", () => {
  it("classifies invalid_thread_ts as an invalid-thread error", () => {
    expect(isInvalidThreadSlackError(slackApiError("invalid_thread_ts"))).toBe(true);
  });

  it("classifies thread_not_found as an invalid-thread error", () => {
    expect(isInvalidThreadSlackError(slackApiError("thread_not_found"))).toBe(true);
  });

  it("does not classify unrelated Slack errors as invalid-thread", () => {
    expect(isInvalidThreadSlackError(slackApiError("user_not_found"))).toBe(false);
    expect(isInvalidThreadSlackError(slackApiError("channel_not_found"))).toBe(false);
    expect(isInvalidThreadSlackError(new Error("boom"))).toBe(false);
    expect(isInvalidThreadSlackError(undefined)).toBe(false);
  });
});
