// A cron delivery target is operator-typed config, not a conversation id core
// inferred, so an unresolved passthrough the channel's grammar disowns must be
// surfaced here rather than deferred to a downstream contract check.
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

const mocks = vi.hoisted(() => ({
  resolveChannelTarget: vi.fn(),
  resolveOutboundChannelPlugin: vi.fn(),
}));

vi.mock("../../infra/outbound/target-resolver.js", () => ({
  resolveChannelTarget: (...args: unknown[]) => mocks.resolveChannelTarget(...args),
}));

vi.mock("../../infra/outbound/channel-resolution.js", () => ({
  resolveOutboundChannelPlugin: (...args: unknown[]) => mocks.resolveOutboundChannelPlugin(...args),
}));

const { resolveChannelTargetForDelivery } = await import("./delivery-target.runtime.js");

// Mirrors a directory-less channel: the only valid target is its own
// conversation id, so an email can never resolve.
function mockThreadOnlyChannel() {
  mocks.resolveOutboundChannelPlugin.mockReturnValue({
    meta: { label: "ThreadChat" },
    messaging: {
      targetResolver: {
        looksLikeId: (raw: string) => /^thread-[1-9]\d*$/.test(raw.trim()),
        hint: 'the conversation id in the form "thread-<id>"',
      },
    },
  });
}

function callDelivery(input: string) {
  return resolveChannelTargetForDelivery({
    cfg: {} as OpenClawConfig,
    channel: "threadchat" as never,
    input,
  });
}

describe("resolveChannelTargetForDelivery", () => {
  it("rejects an unresolved delivery target the channel disowns", async () => {
    mockThreadOnlyChannel();
    mocks.resolveChannelTarget.mockResolvedValue({
      ok: true,
      target: {
        to: "francesca.dudley@4macc.com",
        kind: "user",
        source: "normalized",
        resolutionSource: "normalized",
      },
    });

    const result = await callDelivery("francesca.dudley@4macc.com");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected the delivery target to be rejected");
    }
    expect(result.error.message).toContain("Unknown target");
    expect(result.error.message).toContain("thread-<id>");
  });

  it("still forwards an unresolved target the channel's grammar accepts", async () => {
    mockThreadOnlyChannel();
    mocks.resolveChannelTarget.mockResolvedValue({
      ok: true,
      target: {
        to: "thread-668",
        kind: "user",
        source: "normalized",
        resolutionSource: "normalized",
      },
    });

    const result = await callDelivery("thread-668");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.target.to).toBe("thread-668");
  });
});
