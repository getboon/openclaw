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
  "pluginConfig" | "version" | "logger" | "on" | "lifecycle"
>;

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

  // Typed lifecycle subscriptions. api.on supplies a payload already typed per
  // hook name, so each builder receives its exact event shape with no cast.
  // safe() guards every handler so a reporting bug can never take down the host
  // gateway; builders return null for events that are not error-bearing.
  api.on("model_call_ended", (event) => {
    safe(api.logger, PLUGIN_ID, "model_call_ended", () => {
      dispatchCapture(Sentry, buildModelCallEndedCapture(event, host));
    });
  });
  api.on("agent_end", (event) => {
    safe(api.logger, PLUGIN_ID, "agent_end", () => {
      dispatchCapture(Sentry, buildAgentEndCapture(event, host));
    });
  });
  api.on("after_tool_call", (event) => {
    safe(api.logger, PLUGIN_ID, "after_tool_call", () => {
      dispatchCapture(Sentry, buildAfterToolCallCapture(event, host));
    });
  });
  api.on("message_sent", (event) => {
    safe(api.logger, PLUGIN_ID, "message_sent", () => {
      dispatchCapture(Sentry, buildMessageSentCapture(event, host));
    });
  });
  api.on("subagent_ended", (event) => {
    safe(api.logger, PLUGIN_ID, "subagent_ended", () => {
      dispatchCapture(Sentry, buildSubagentEndedCapture(event, host));
    });
  });
  api.on("cron_changed", (event) => {
    safe(api.logger, PLUGIN_ID, "cron_changed", () => {
      dispatchCapture(Sentry, buildCronChangedCapture(event, host));
    });
  });
  api.on("session_end", (event) => {
    safe(api.logger, PLUGIN_ID, "session_end", () => {
      dispatchCapture(Sentry, buildSessionEndCapture(event, host));
    });
  });

  // Flush buffered Sentry events before the gateway exits.
  api.lifecycle.registerRuntimeLifecycle({
    id: `${PLUGIN_ID}/sentry-flush`,
    description: "Flush Sentry buffer on plugin / gateway shutdown",
    cleanup: async () => {
      await Sentry.close(2000);
    },
  });
}
