import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Sentry SDK so the wiring path can be exercised without a real DSN or
// network client. Integration factories must return an object so init accepts
// them in the integrations array.
vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTags: vi.fn(),
  close: vi.fn(async () => true),
  onUncaughtExceptionIntegration: vi.fn(() => ({ name: "OnUncaughtException" })),
  onUnhandledRejectionIntegration: vi.fn(() => ({ name: "OnUnhandledRejection" })),
  linkedErrorsIntegration: vi.fn(() => ({ name: "LinkedErrors" })),
  contextLinesIntegration: vi.fn(() => ({ name: "ContextLines" })),
}));

import * as Sentry from "@sentry/node";
import { PLUGIN_ID, registerSentryMonitor, type SentryMonitorApi } from "./register.js";

const HOOK_NAMES = [
  "model_call_ended",
  "agent_end",
  "after_tool_call",
  "message_sent",
  "subagent_ended",
  "cron_changed",
  "session_end",
];

function makeApi(pluginConfig?: Record<string, unknown>) {
  const on = vi.fn<SentryMonitorApi["on"]>();
  const registerRuntimeLifecycle =
    vi.fn<SentryMonitorApi["lifecycle"]["registerRuntimeLifecycle"]>();
  const warn = vi.fn<(message: string) => void>();
  const info = vi.fn<(message: string) => void>();
  const error = vi.fn<(message: string) => void>();
  const debug = vi.fn<(message: string) => void>();
  const api: SentryMonitorApi = {
    pluginConfig,
    hostVersion: "1.2.3",
    logger: { info, warn, error, debug },
    on,
    lifecycle: { registerRuntimeLifecycle },
  };
  return { api, on, registerRuntimeLifecycle, warn, info };
}

describe("registerSentryMonitor", () => {
  // Snapshot every env var the plugin reads so a test can set them without
  // leaking into sibling tests or inheriting a value from the real shell.
  const ENV_KEYS = ["BOON_SENTRY_DSN", "BOON_SKILLS_REF", "DEPLOY_WAVE", "WAVE"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it("stays inactive when no DSN is configured: warns, inits nothing, registers nothing", () => {
    const { api, on, registerRuntimeLifecycle, warn } = makeApi();
    registerSentryMonitor(api);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("plugin inactive");
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
    expect(registerRuntimeLifecycle).not.toHaveBeenCalled();
  });

  it("activates from a plugin-config dsn: inits Sentry and registers all seven hooks plus flush", () => {
    const { api, on, registerRuntimeLifecycle, info } = makeApi({
      dsn: "https://abc@o1.ingest.sentry.io/1",
    });
    registerSentryMonitor(api);

    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledTimes(HOOK_NAMES.length);
    expect(on.mock.calls.map((call) => call[0])).toEqual(HOOK_NAMES);
    expect(registerRuntimeLifecycle).toHaveBeenCalledOnce();
    expect(registerRuntimeLifecycle.mock.calls[0]?.[0]?.id).toBe(`${PLUGIN_ID}/sentry-flush`);
  });

  it("activates from the BOON_SENTRY_DSN env var when no plugin-config dsn is set", () => {
    process.env.BOON_SENTRY_DSN = "https://abc@o1.ingest.sentry.io/2";
    const { api, on } = makeApi();
    registerSentryMonitor(api);
    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledTimes(HOOK_NAMES.length);
  });

  it("passes the resolved environment and release into Sentry.init", () => {
    const { api } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/3", environment: "host-x" });
    registerSentryMonitor(api);
    const initArg = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(initArg?.environment).toBe("host-x");
    expect(initArg?.release).toBe("1.2.3");
    expect(initArg?.tracesSampleRate).toBe(0);
  });

  it("does NOT set deploy tags when no deploy env vars are present", () => {
    const { api } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/8" });
    registerSentryMonitor(api);
    expect(Sentry.setTags).not.toHaveBeenCalled();
  });

  it("sets boon_skills_ref + wave deploy tags from env", () => {
    process.env.BOON_SKILLS_REF = "main";
    process.env.DEPLOY_WAVE = "wave-2";
    const { api } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/9" });
    registerSentryMonitor(api);
    expect(Sentry.setTags).toHaveBeenCalledWith({ boon_skills_ref: "main", wave: "wave-2" });
  });

  it("falls back to WAVE when DEPLOY_WAVE is unset, and omits an absent tag", () => {
    process.env.WAVE = "wave-1";
    const { api } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/10" });
    registerSentryMonitor(api);
    // boon_skills_ref unset → only wave is tagged (no empty-string key emitted)
    expect(Sentry.setTags).toHaveBeenCalledWith({ wave: "wave-1" });
  });

  it("falls through an empty-string config dsn to the env var (|| not ??)", () => {
    process.env.BOON_SENTRY_DSN = "https://abc@o1.ingest.sentry.io/4";
    const { api, on } = makeApi({ dsn: "" });
    registerSentryMonitor(api);
    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(on).toHaveBeenCalledTimes(HOOK_NAMES.length);
  });

  it.each([
    { label: "string", value: "0.5" },
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
  ])("ignores a non-finite tracesSampleRate ($label) and defaults to 0", ({ value }) => {
    const { api } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/5", tracesSampleRate: value });
    registerSentryMonitor(api);
    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]?.tracesSampleRate).toBe(0);
  });

  it("wires each hook to its builder: an errored event dispatches, a healthy one does not", () => {
    const { api, on } = makeApi({ dsn: "https://abc@o1.ingest.sentry.io/6" });
    registerSentryMonitor(api);
    const fire = (name: string, event: unknown) => {
      const handler = on.mock.calls.find((call) => call[0] === name)?.[1];
      expect(handler).toBeDefined();
      (handler as (e: unknown, ctx: unknown) => void)(event, undefined);
    };
    fire("model_call_ended", {
      outcome: "error",
      provider: "p",
      model: "m",
      runId: "r",
      callId: "c",
      durationMs: 1,
    });
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    fire("session_end", { sessionId: "s", messageCount: 1, reason: "unknown" });
    expect(Sentry.captureMessage).toHaveBeenCalledOnce();
    fire("agent_end", { messages: [], success: true });
    expect(Sentry.captureException).toHaveBeenCalledOnce(); // healthy turn is ignored
  });

  it("flushes Sentry with a 2s timeout on cleanup", async () => {
    const { api, registerRuntimeLifecycle } = makeApi({
      dsn: "https://abc@o1.ingest.sentry.io/7",
    });
    registerSentryMonitor(api);
    const registration = registerRuntimeLifecycle.mock.calls[0]?.[0];
    await registration?.cleanup?.({ reason: "restart" });
    expect(Sentry.close).toHaveBeenCalledWith(2000);
  });
});
