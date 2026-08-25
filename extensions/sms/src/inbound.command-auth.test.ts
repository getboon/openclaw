// Regression coverage for the SMS command-authorization gate: a control
// command from a sender who is not command-authorized must be blocked, not
// silently admitted because allowTextCommands was left at its false default.
import { describe, expect, it, vi } from "vitest";

const { resolveStableChannelMessageIngress } = vi.hoisted(() => ({
  resolveStableChannelMessageIngress: vi.fn(async () => ({
    senderAccess: { allowed: true, decision: "allow" },
    commandAccess: { requested: true, authorized: false, shouldBlockControlCommand: true },
  })),
}));

vi.mock("openclaw/plugin-sdk/channel-ingress-runtime", () => ({
  resolveStableChannelMessageIngress,
}));

vi.mock("openclaw/plugin-sdk/channel-pairing", () => ({
  createChannelPairingChallengeIssuer: () => vi.fn(),
}));

vi.mock("./phone.js", () => ({
  normalizeSmsPhoneNumber: (value: string) => value,
}));

vi.mock("./send.js", () => ({
  sendSmsTextChunks: vi.fn(),
}));

import { dispatchSmsInboundEvent, type SmsChannelRuntime } from "./inbound.js";
import type { ResolvedSmsAccount } from "./types.js";

function createAccount(overrides: Partial<ResolvedSmsAccount> = {}): ResolvedSmsAccount {
  return {
    accountId: "default",
    enabled: true,
    accountSid: "AC123",
    authToken: "secret",
    fromNumber: "+15557654321",
    messagingServiceSid: "",
    defaultTo: "",
    webhookPath: "/webhooks/sms",
    publicWebhookUrl: "https://gateway.example.com/webhooks/sms",
    dangerouslyDisableSignatureValidation: false,
    dmPolicy: "allowlist",
    allowFrom: ["+15551234567"],
    textChunkLimit: 1500,
    ...overrides,
  };
}

describe("authorizeSmsSender command gate wiring", () => {
  it("marks the request as an actual control command and enables the block gate", async () => {
    const isControlCommandMessage = vi.fn(() => true);
    const runtime = {
      commands: {
        isControlCommandMessage,
        shouldComputeCommandAuthorized: vi.fn(() => true),
      },
      pairing: { readAllowFromStore: vi.fn(async () => []) },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "main",
          accountId: "default",
          sessionKey: "agent:main:sms:direct:+15551234567",
        })),
      },
      inbound: { run: vi.fn(), buildContext: vi.fn() },
      session: { resolveStorePath: vi.fn(), recordInboundSession: vi.fn() },
      reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
    } as unknown as SmsChannelRuntime;

    await dispatchSmsInboundEvent({
      cfg: {},
      account: createAccount(),
      channelRuntime: runtime,
      msg: {
        from: "+15551234567",
        to: "+15557654321",
        body: "/dangerous-command",
        messageSid: "SM-blocked-command",
        accountSid: "AC123",
      },
    });

    expect(isControlCommandMessage).toHaveBeenCalledWith("/dangerous-command", {});
    const call = resolveStableChannelMessageIngress.mock.calls[0]?.[0];
    expect(call.command).toEqual(
      expect.objectContaining({
        allowTextCommands: true,
        hasControlCommand: true,
      }),
    );
    // The gate must actually drop the message, not just be computed and
    // carried along in a payload for some downstream consumer to check.
    expect(runtime.inbound.run).not.toHaveBeenCalled();
  });

  it("dispatches the turn when the control command gate does not block", async () => {
    resolveStableChannelMessageIngress.mockResolvedValueOnce({
      senderAccess: { allowed: true, decision: "allow" },
      commandAccess: { requested: true, authorized: true, shouldBlockControlCommand: false },
    });
    const runtime = {
      commands: {
        isControlCommandMessage: vi.fn(() => true),
        shouldComputeCommandAuthorized: vi.fn(() => true),
      },
      pairing: { readAllowFromStore: vi.fn(async () => []) },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "main",
          accountId: "default",
          sessionKey: "agent:main:sms:direct:+15551234567",
        })),
      },
      inbound: { run: vi.fn(), buildContext: vi.fn() },
      session: { resolveStorePath: vi.fn(), recordInboundSession: vi.fn() },
      reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
    } as unknown as SmsChannelRuntime;

    await dispatchSmsInboundEvent({
      cfg: {},
      account: createAccount(),
      channelRuntime: runtime,
      msg: {
        from: "+15551234567",
        to: "+15557654321",
        body: "/authorized-command",
        messageSid: "SM-allowed-command",
        accountSid: "AC123",
      },
    });

    expect(runtime.inbound.run).toHaveBeenCalledTimes(1);
  });
});
