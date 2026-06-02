import * as os from "node:os";
import * as Sentry from "@sentry/node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildAfterToolCallCapture,
  buildAgentEndCapture,
  buildCronChangedCapture,
  buildMessageSentCapture,
  buildModelCallEndedCapture,
  buildSessionEndCapture,
  buildSubagentEndedCapture,
  type SentryCapture,
} from "./captures.js";
import { dispatchCapture } from "./dispatch.js";
import { safe } from "./format.js";

export const PLUGIN_ID = "sentry-monitor";

type MonitorConfig = {
  dsn?: string;
  environment?: string;
  tracesSampleRate?: number;
};

// The exact slice of the plugin API this monitor uses. Narrowing to a Pick
// keeps the surface honest and lets tests build a small typed fake instead of
// stubbing the whole host API.
export type SentryMonitorApi = Pick<
  OpenClawPluginApi,
  "pluginConfig" | "version" | "logger" | "registerHook" | "lifecycle"
>;

// Lifecycle hook payloads originate from the core hook dispatcher, a trusted
// in-process producer with declared payload shapes. We coerce the opaque hook
// event to its declared SDK type at this single boundary rather than
// re-validating every field on a hot path.
function coerceHookEvent<E>(raw: unknown): E {
  return raw as E;
}

export function registerSentryMonitor(api: SentryMonitorApi): void {
  const cfg = (api.pluginConfig ?? {}) as MonitorConfig;
  const dsn = cfg.dsn ?? process.env.BOON_SENTRY_DSN;
  if (!dsn) {
    api.logger.warn(
      `${PLUGIN_ID}: BOON_SENTRY_DSN unset and no plugin-config dsn; plugin inactive`,
    );
    return;
  }

  const host = cfg.environment ?? os.hostname();
  Sentry.init({
    dsn,
    environment: host,
    release: typeof api.version === "string" ? api.version : undefined,
    tracesSampleRate: cfg.tracesSampleRate ?? 0,
    // Disable default integrations and selectively re-enable only the ones that
    // capture genuine process-level failures. Skips noisy auto-instrumentation
    // (Http, Console, Modules) that would ship every outbound fetch and
    // console.error from the gateway.
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
      Sentry.onUnhandledRejectionIntegration({ mode: "warn" }),
      Sentry.linkedErrorsIntegration({ key: "cause", limit: 5 }),
      Sentry.contextLinesIntegration(),
    ],
  });

  api.logger.info(
    `${PLUGIN_ID}: Sentry initialized (environment=${host}${api.version ? `, release=${api.version}` : ""})`,
  );

  // Wire one error-bearing hook to its pure capture builder. The builder
  // decides whether the event warrants a capture (returns null to ignore);
  // dispatchCapture forwards non-null descriptors to Sentry. safe() guards the
  // whole body so a reporting bug can never take down the host gateway.
  const wire = <E>(hook: string, build: (event: E, host: string) => SentryCapture | null) => {
    api.registerHook(hook, (rawEvent) => {
      safe(api.logger, PLUGIN_ID, hook, () => {
        dispatchCapture(Sentry, build(coerceHookEvent<E>(rawEvent), host));
      });
    });
  };

  wire("model_call_ended", buildModelCallEndedCapture);
  wire("agent_end", buildAgentEndCapture);
  wire("after_tool_call", buildAfterToolCallCapture);
  wire("message_sent", buildMessageSentCapture);
  wire("subagent_ended", buildSubagentEndedCapture);
  wire("cron_changed", buildCronChangedCapture);
  wire("session_end", buildSessionEndCapture);

  // Flush buffered Sentry events before the gateway exits.
  api.lifecycle.registerRuntimeLifecycle({
    id: `${PLUGIN_ID}/sentry-flush`,
    description: "Flush Sentry buffer on plugin / gateway shutdown",
    cleanup: async () => {
      await Sentry.close(2000);
    },
  });
}
