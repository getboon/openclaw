// ENG-21405 repro: a directory-less channel (anychat-boon-web's real contract,
// reproduced here without importing the external plugin package) rejects a
// target its own grammar disowns via PR #217's guard (ENG-18097). This proves
// whether that guard still holds end-to-end through resolveDeliveryTarget, or
// is bypassed somewhere between it and the cron failure-notification lane.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChannelMessagingAdapter,
  ChannelOutboundAdapter,
} from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../../plugins/runtime.js";
import { createOutboundTestPlugin, createTestRegistry } from "../../test-utils/channel-plugins.js";

const { extractDeliveryInfoMock } = vi.hoisted(() => ({
  extractDeliveryInfoMock: vi.fn(),
}));

vi.mock("../../config/sessions/main-session.js", () => ({
  canonicalizeMainSessionAlias: vi.fn(({ sessionKey }) => sessionKey),
  resolveAgentMainSessionKey: vi.fn().mockReturnValue("agent:test:main"),
}));

vi.mock("../../config/sessions/delivery-info.js", () => ({
  extractDeliveryInfo: extractDeliveryInfoMock,
}));

vi.mock("../../config/sessions/paths.js", () => ({
  resolveStorePath: vi.fn().mockReturnValue("/tmp/test-store.json"),
}));

vi.mock("../../config/sessions/session-accessor.js", () => ({
  loadSessionEntry: vi.fn(),
}));

vi.mock("../../infra/outbound/channel-selection.runtime.js", () => ({
  resolveMessageChannelSelection: vi
    .fn()
    .mockResolvedValue({ channel: "anychat-boon-web", configured: ["anychat-boon-web"] }),
}));

vi.mock("../../infra/outbound/target-id-resolution.js", () => ({
  maybeResolveIdLikeTarget: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../infra/outbound/targets.runtime.js", () => ({
  resolveOutboundTarget: vi.fn(),
}));

const mockedModuleIds = [
  "../../config/sessions/main-session.js",
  "../../config/sessions/delivery-info.js",
  "../../config/sessions/paths.js",
  "../../config/sessions/session-accessor.js",
  "../../infra/outbound/channel-selection.runtime.js",
  "../../infra/outbound/targets.runtime.js",
  "../../infra/outbound/target-id-resolution.js",
];

import { loadSessionEntry } from "../../config/sessions/session-accessor.js";
import { resolveDeliveryTarget } from "./delivery-target.js";

afterAll(() => {
  for (const id of mockedModuleIds) {
    vi.doUnmock(id);
  }
  vi.resetModules();
});

// Reproduces anychat-boon-web/src/transport/boon-web/target.ts's grammar: the
// only valid outbound target is the channel's own conversation id
// "thread-<id>" ([1-9]\d*, no leading zero). Everything else — including an
// email — is disowned.
const THREAD_SESSION_ID_RE = /^thread-([1-9]\d*)$/;
function isBoonWebSessionId(value: string): boolean {
  return THREAD_SESSION_ID_RE.test(value.trim());
}

// Reproduces the real plugin's outbound.resolveTarget
// (anychat-boon-web/src/transport/boon-web/outbound.ts:509): only rejects a
// blank target; otherwise passes any trimmed string through unvalidated.
// This is the plugin's own, deliberately lenient layer — the strict check is
// messaging.targetResolver.looksLikeId below, same as production.
const boonWebOutbound: ChannelOutboundAdapter = {
  deliveryMode: "gateway",
  resolveTarget: ({ to }) => {
    const trimmed = typeof to === "string" ? to.trim() : "";
    return trimmed ? { ok: true, to: trimmed } : { ok: false, error: new Error("target required") };
  },
};

// Mirrors anychat-boon-web/src/transport/boon-web/channel.ts:68-130's real
// messaging adapter: no resolveTarget (the channel has no directory), and
// looksLikeId as the sole grammar gate PR #217 relies on.
const boonWebMessaging: ChannelMessagingAdapter = {
  targetPrefixes: ["anychat-boon-web", "boon-web", "boon-chat"],
  normalizeTarget: (raw) =>
    raw
      .trim()
      .replace(/^(?:anychat-boon-web|boon-web|boon-chat|thread|conversation):\s*/i, "")
      .trim() || undefined,
  inferTargetChatType: () => "direct",
  targetResolver: {
    looksLikeId: (raw, normalized) => isBoonWebSessionId(normalized ?? raw),
    hint: 'the conversation id in the form "thread-<id>"',
  },
};

function registerBoonWebPlugin() {
  setActivePluginRegistry(
    createTestRegistry([
      {
        pluginId: "anychat-boon-web",
        plugin: createOutboundTestPlugin({
          id: "anychat-boon-web" as never,
          outbound: boonWebOutbound,
          messaging: boonWebMessaging,
        }),
        source: "test",
      },
    ]),
  );
}

function makeCfg(overrides?: Partial<OpenClawConfig>): OpenClawConfig {
  return {
    bindings: [],
    channels: {},
    ...overrides,
  } as OpenClawConfig;
}

const AGENT_ID = "agent-macc";

type SessionStore = Record<string, SessionEntry>;

function setSessionStore(store: SessionStore) {
  vi.mocked(loadSessionEntry).mockImplementation(({ sessionKey }) => store[sessionKey]);
}

function setMainSessionEntry(entry?: SessionStore[string]) {
  const store = entry ? ({ "agent:test:main": entry } as SessionStore) : ({} as SessionStore);
  setSessionStore(store);
}

beforeEach(() => {
  resetPluginRuntimeStateForTest();
  extractDeliveryInfoMock.mockReset();
  extractDeliveryInfoMock.mockReturnValue({ deliveryContext: undefined, threadId: undefined });
  vi.mocked(loadSessionEntry).mockReset().mockReturnValue(undefined);
  registerBoonWebPlugin();
});

afterEach(() => {
  resetPluginRuntimeStateForTest();
});

describe("resolveDeliveryTarget against a directory-less channel (ENG-21405 repro)", () => {
  it("rejects an explicit email delivery target instead of forwarding it unresolved", async () => {
    setMainSessionEntry(undefined);

    const result = await resolveDeliveryTarget(makeCfg(), AGENT_ID, {
      channel: "anychat-boon-web" as never,
      to: "francesca.dudley@4macc.com",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(
        `expected the email target to be rejected, got forwarded to="${result.to}" instead`,
      );
    }
    expect(result.error.message).toContain("Unknown target");
  });

  it("still forwards an explicit thread-<id> delivery target", async () => {
    setMainSessionEntry(undefined);

    const result = await resolveDeliveryTarget(makeCfg(), AGENT_ID, {
      channel: "anychat-boon-web" as never,
      to: "thread-94",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.to).toBe("thread-94");
  });

  it("rejects an implicit (session-inherited) email delivery target for a job with its own session", async () => {
    // A job with its own sessionKey (not the shared agent-main bucket) whose
    // stored lastTo was contaminated with an email — distinct from the
    // #91613 shared-main-bucket refusal, which fires earlier for a genuinely
    // keyless cron and is already covered by delivery-target.test.ts.
    setSessionStore({
      "agent:test:thread:77": {
        sessionId: "boon-web-thread-77",
        updatedAt: 1000,
        lastChannel: "anychat-boon-web",
        lastTo: "francesca.dudley@4macc.com",
      },
    } as SessionStore);

    const result = await resolveDeliveryTarget(makeCfg(), AGENT_ID, {
      channel: "last" as never,
      sessionKey: "agent:test:thread:77",
      to: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(
        `expected the inherited email target to be rejected, got forwarded to="${result.to}" instead`,
      );
    }
    expect(result.error.message).toContain("Unknown target");
  });
});
