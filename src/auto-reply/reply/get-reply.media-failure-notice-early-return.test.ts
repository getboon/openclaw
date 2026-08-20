// Tests that a pre-existing ctx.MediaFailures is reported even when a
// before_agent_reply hook short-circuits the turn with a synthetic reply.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookRunner } from "../../plugins/hooks.js";
import {
  buildGetReplyGroupCtx,
  createGetReplyContinueDirectivesResult,
  createGetReplySessionState,
  registerGetReplyRuntimeOverrides,
} from "./get-reply.test-fixtures.js";
import { loadGetReplyModuleForTest } from "./get-reply.test-loader.js";
import "./get-reply.test-runtime-mocks.js";

const mocks = vi.hoisted(() => ({
  resolveReplyDirectives: vi.fn(),
  handleInlineActions: vi.fn(),
  initSessionState: vi.fn(),
  hasHooks: vi.fn<HookRunner["hasHooks"]>(),
  runBeforeAgentReply: vi.fn<HookRunner["runBeforeAgentReply"]>(),
}));

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () =>
    ({
      hasHooks: mocks.hasHooks,
      runBeforeAgentReply: mocks.runBeforeAgentReply,
    }) as unknown as HookRunner,
}));
registerGetReplyRuntimeOverrides(mocks);

let getReplyFromConfig: typeof import("./get-reply.js").getReplyFromConfig;
let sendInboundMediaFailureNoticeMock: ReturnType<typeof vi.fn>;

async function loadGetReplyRuntimeForTest() {
  ({ getReplyFromConfig } = await loadGetReplyModuleForTest({ cacheKey: import.meta.url }));
  ({ sendInboundMediaFailureNotice: sendInboundMediaFailureNoticeMock } =
    (await import("../inbound-media-failure-notice.runtime.js")) as unknown as {
      sendInboundMediaFailureNotice: ReturnType<typeof vi.fn>;
    });
}

describe("getReplyFromConfig media-failure notice on hook-handled early return", () => {
  beforeAll(async () => {
    await loadGetReplyRuntimeForTest();
  });

  beforeEach(() => {
    vi.stubEnv("OPENCLAW_ALLOW_SLOW_REPLY_TESTS", "1");
    mocks.resolveReplyDirectives.mockReset();
    mocks.handleInlineActions.mockReset();
    mocks.initSessionState.mockReset();
    mocks.hasHooks.mockReset();
    mocks.runBeforeAgentReply.mockReset();
    sendInboundMediaFailureNoticeMock.mockClear();

    mocks.initSessionState.mockResolvedValue(
      createGetReplySessionState({
        sessionCtx: buildGetReplyGroupCtx({
          OriginatingChannel: "Telegram",
          Provider: "telegram",
          SenderId: "42",
          ChatId: "-100123-native",
        }),
        sessionKey: "agent:main:telegram:-100123",
        sessionScope: "per-chat",
        isGroup: true,
        triggerBodyNormalized: "hello world",
        bodyStripped: "hello world",
      }),
    );
    mocks.resolveReplyDirectives.mockResolvedValue(
      createGetReplyContinueDirectivesResult({
        body: "hello world",
        abortKey: "agent:main:telegram:-100123",
        from: "telegram:user:42",
        to: "telegram:-100123",
        senderId: "42",
        commandSource: "text",
        senderIsOwner: false,
        resetHookTriggered: false,
      }),
    );
    mocks.handleInlineActions.mockResolvedValue({
      kind: "continue",
      directives: {},
      abortedLastRun: false,
      cleanedBody: "hello world",
    });
    mocks.hasHooks.mockImplementation((hookName) => hookName === "before_agent_reply");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports channel-level media failures even though the hook returns a reply before staging runs", async () => {
    mocks.runBeforeAgentReply.mockResolvedValue({
      handled: true,
      reply: { text: "plugin reply" },
    });

    const result = await getReplyFromConfig(
      buildGetReplyGroupCtx({
        SenderId: "telegram-user-42",
        MediaFailures: [{ name: "plans.pdf", reason: "expired_link" }],
      }),
      undefined,
      {},
    );

    expect(result).toEqual({ text: "plugin reply" });
    expect(sendInboundMediaFailureNoticeMock).toHaveBeenCalledTimes(1);
    expect(sendInboundMediaFailureNoticeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        failures: [{ name: "plans.pdf", reason: "expired_link" }],
      }),
    );
    // The hook's synthetic reply must not suppress the already-known
    // channel-level failure — this is the exact bypass a fix must close.
    expect(sendInboundMediaFailureNoticeMock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runBeforeAgentReply.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
