// Tests the /retry command's fallback-to-normal-prompt behavior.
import { describe, expect, it } from "vitest";
import { handleRetryCommand, RETRY_NUDGE_TEXT } from "./commands-retry.js";
import { baseCommandTestConfig, buildCommandTestParams } from "./commands.test-harness.js";

function buildParams(commandBody: string) {
  return buildCommandTestParams(commandBody, baseCommandTestConfig);
}

describe("handleRetryCommand", () => {
  it("returns null when the body is not a bare /retry command", async () => {
    const result = await handleRetryCommand(buildParams("/retry redo the extract step"), true);
    expect(result).toBeNull();
  });

  it("returns null when text commands are disallowed", async () => {
    const result = await handleRetryCommand(buildParams("/retry"), false);
    expect(result).toBeNull();
  });

  it("rewrites the body to the fixed nudge and continues as a normal prompt", async () => {
    const params = buildParams("/retry");
    const result = await handleRetryCommand(params, true);

    expect(result).toEqual({ shouldContinue: true });
    expect(params.ctx.Body).toBe(RETRY_NUDGE_TEXT);
    expect(params.ctx.BodyForAgent).toBe(RETRY_NUDGE_TEXT);
    expect((params.ctx as Record<string, unknown>).BodyStripped).toBe(RETRY_NUDGE_TEXT);
    expect(params.command.commandBodyNormalized).toBe(RETRY_NUDGE_TEXT);
  });

  it("ignores /retry from an unauthorized sender", async () => {
    const params = buildParams("/retry");
    params.command.isAuthorizedSender = false;

    const result = await handleRetryCommand(params, true);

    expect(result).toEqual({ shouldContinue: false });
    expect(params.ctx.Body).toBe("/retry");
  });
});
