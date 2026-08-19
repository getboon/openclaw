// Covers channel/target inference, legacy target rewrite, target validation,
// and plugin alias-aware message-action normalization.
import { describe, expect, it, vi } from "vitest";
import { normalizeMessageActionInput } from "./message-action-normalization.js";

vi.mock("../../channels/plugins/bootstrap-registry.js", async () => ({
  getBootstrapChannelPlugin: (
    await import("./message-action-test-fixtures.js")
  ).createPinboardMessageActionBootstrapRegistryMock(),
}));

vi.mock("../../utils/message-channel.js", () => ({
  isDeliverableMessageChannel: (value: string) => ["workspace", "forum"].includes(value),
  normalizeMessageChannel: (value?: string | null) =>
    typeof value === "string" ? value.trim().toLowerCase() : undefined,
}));

describe("normalizeMessageActionInput", () => {
  type NormalizeMessageActionInputCase = {
    input: Parameters<typeof normalizeMessageActionInput>[0];
    expectedFields?: Record<string, unknown>;
    absentFields?: string[];
    // "tool-context" only when the target came from the live inbound tool
    // context (core's own inference); every explicit/legacy-caller target
    // stays "agent" — resolution softens only the former.
    expectedTargetSource: "agent" | "tool-context";
  };

  it.each([
    {
      input: {
        action: "send",
        args: {
          target: "channel:C1",
          to: "legacy",
          channelId: "legacy-channel",
        },
      },
      expectedFields: { target: "channel:C1", to: "channel:C1" },
      absentFields: ["channelId"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "send",
        args: {
          target: "1214056829",
          channelId: "",
          to: "   ",
        },
      },
      expectedFields: { target: "1214056829", to: "1214056829" },
      absentFields: ["channelId"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "send",
        args: {
          to: "channel:C1",
        },
      },
      expectedFields: { target: "channel:C1", to: "channel:C1" },
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "send",
        args: {},
        toolContext: {
          currentChannelId: "channel:C1",
        },
      },
      expectedFields: { target: "channel:C1", to: "channel:C1" },
      expectedTargetSource: "tool-context",
    },
    {
      input: {
        action: "send",
        args: {},
        toolContext: {
          currentChannelId: "user:U1",
          currentChannelProvider: "slack",
        },
      },
      expectedFields: { target: "user:U1", to: "user:U1" },
      expectedTargetSource: "tool-context",
    },
    {
      input: {
        action: "send",
        args: {},
        toolContext: {
          currentMessagingTarget: "user:U1",
          currentChannelProvider: "slack",
        },
      },
      expectedFields: { target: "user:U1", to: "user:U1" },
      expectedTargetSource: "tool-context",
    },
    {
      input: {
        action: "send",
        args: {
          target: "channel:C1",
        },
        toolContext: {
          currentChannelId: "C1",
          currentChannelProvider: "workspace",
        },
      },
      expectedFields: { channel: "workspace" },
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "broadcast",
        args: {},
        toolContext: {
          currentChannelId: "channel:C1",
        },
      },
      absentFields: ["target", "to"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "send",
        args: {
          target: "channel:C1",
        },
        toolContext: {
          currentChannelProvider: "webchat",
        },
      },
      absentFields: ["channel"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "edit",
        args: {
          messageId: "msg_123",
        },
        toolContext: {
          currentChannelId: "channel:C1",
        },
      },
      expectedFields: { messageId: "msg_123" },
      absentFields: ["target", "to"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "pin",
        args: {
          channel: "pinboard",
          messageId: "om_123",
        },
      },
      expectedFields: { messageId: "om_123" },
      absentFields: ["target", "to"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "list-pins",
        args: {
          channel: "pinboard",
          chatId: "oc_123",
        },
      },
      expectedFields: { chatId: "oc_123" },
      absentFields: ["target", "to"],
      expectedTargetSource: "agent",
    },
    {
      input: {
        action: "read",
        args: {
          channel: "workspace",
          messageId: "123.456",
        },
        toolContext: {
          currentChannelId: "C12345678",
          currentChannelProvider: "workspace",
        },
      },
      expectedFields: { target: "C12345678", messageId: "123.456" },
      expectedTargetSource: "tool-context",
    },
    {
      input: {
        action: "channel-info",
        args: {
          channelId: "C123",
        },
      },
      expectedFields: { target: "C123", channelId: "C123" },
      absentFields: ["to"],
      expectedTargetSource: "agent",
    },
  ] satisfies NormalizeMessageActionInputCase[])(
    "normalizes message action input for %j",
    ({ input, expectedFields, absentFields, expectedTargetSource }) => {
      const { args, targetSource } = normalizeMessageActionInput(input);
      if (expectedFields) {
        for (const [field, value] of Object.entries(expectedFields)) {
          expect(args[field]).toBe(value);
        }
      }
      for (const field of absentFields ?? []) {
        expect(field in args).toBe(false);
      }
      expect(targetSource).toBe(expectedTargetSource);
    },
  );

  it("throws when required target remains unresolved", () => {
    expect(() =>
      normalizeMessageActionInput({
        action: "send",
        args: {},
      }),
    ).toThrow(/requires a target/);
  });
});
