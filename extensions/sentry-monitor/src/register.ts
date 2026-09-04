import * as os from "node:os";
import * as Sentry from "@sentry/node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildAfterToolCallCapture,
  buildAgentEndCapture,
  buildCronChangedCapture,
  buildDeliveryRecoveryExhaustedCapture,
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
  // Allow-list of hooks to report. Unset registers every hook; an empty array
  // registers none. Empty must stay distinguishable from unset — a truthiness
  // check would silently re-enable every hook on a deliberately quiet host.
  hooks?: string[];
};

// The exact slice of the plugin API this monitor uses. Narrowing to a Pick
// keeps the surface honest and lets tests build a small typed fake instead of
// stubbing the whole host API.
export type SentryMonitorApi = Pick<
  OpenClawPluginApi,
  "pluginConfig" | "hostVersion" | "logger" | "on" | "lifecycle"
>;

export function registerSentryMonitor(api: SentryMonitorApi): void {
  const cfg = (api.pluginConfig ?? {}) as MonitorConfig;
  // Use `||` (not `??`) so an empty-string `dsn` in config — a common
  // documented-but-unset state — falls through to the env var instead of
  // shadowing it and silently disabling the plugin.
  const dsn = cfg.dsn || process.env.BOON_SENTRY_DSN;
  if (!dsn) {
    api.logger.warn(
      `${PLUGIN_ID}: BOON_SENTRY_DSN unset and no plugin-config dsn; plugin inactive`,
    );
    return;
  }

  // Keep these distinct: `environment` is the configurable Sentry environment
  // (defaults to the hostname); `hostname` is always the real machine and is
  // what the `host` tag reports. Conflating them makes the host tag wrong
  // whenever an operator sets a custom environment.
  const hostname = os.hostname();
  const environment = cfg.environment || hostname;
  // Deploy coordinates: `release` (host app version, below) already lets
  // Sentry cluster a post-deploy regression by build — the arguijo signature was
  // the same error across every host on one release. These tags add the finer
  // rollout dimensions so a spike also attributes to a boon-skills ref and a
  // specific wave. Read from env (same source as BOON_SENTRY_DSN above) so the
  // fleet standup/sweep can stamp them without a plugin-config change; each is
  // applied only when non-empty, so hosts that don't set them behave exactly as
  // before. Set as fleet-wide tags at init → attached to every capture without
  // touching the per-event builders.
  const deployTags: Record<string, string> = {};
  const boonSkillsRef = process.env.BOON_SKILLS_REF;
  if (boonSkillsRef) {
    deployTags.boon_skills_ref = boonSkillsRef;
  }
  const deployWave = process.env.DEPLOY_WAVE || process.env.WAVE;
  if (deployWave) {
    deployTags.wave = deployWave;
  }
  // Multi-tenant hosts share one hostname, so `host`/`environment` cannot
  // identify the tenant. A tag, not `environment`: tags carry cardinality and
  // do not affect grouping, so a per-tenant value cannot fragment issues.
  const tenantAccountId = process.env.BOON_TENANT_ACCOUNT_ID;
  if (tenantAccountId) {
    deployTags.trial_account_id = tenantAccountId;
  }
  Sentry.init({
    dsn,
    environment,
    // Must be the running app's version, not this plugin's own manifest
    // version — otherwise every host on every release reports the same
    // `release` tag and a per-deploy regression can never be attributed.
    release: typeof api.hostVersion === "string" ? api.hostVersion : undefined,
    // Guard the untrusted config value: only a finite number enables tracing;
    // anything else (string, NaN, Infinity, missing) falls back to 0. Note
    // `typeof NaN === "number"`, so the finite check is what rejects NaN.
    tracesSampleRate:
      typeof cfg.tracesSampleRate === "number" && Number.isFinite(cfg.tracesSampleRate)
        ? cfg.tracesSampleRate
        : 0,
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

  // Fleet-wide deploy tags on every subsequent capture (no-op when unset).
  if (Object.keys(deployTags).length > 0) {
    Sentry.setTags(deployTags);
  }

  api.logger.info(
    `${PLUGIN_ID}: Sentry initialized (environment=${environment}${api.hostVersion ? `, release=${api.hostVersion}` : ""})`,
  );

  // `null` (unset) registers everything, so an image that omits `hooks` is
  // unchanged. Checked per call site rather than via a generic wrapper so
  // `api.on` keeps its per-hook payload typing.
  const allowedHooks = Array.isArray(cfg.hooks) ? new Set(cfg.hooks) : null;
  const hookEnabled = (name: string): boolean => allowedHooks === null || allowedHooks.has(name);

  // Typed lifecycle subscriptions. api.on supplies a payload already typed per
  // hook name, so each builder receives its exact event shape with no cast.
  // safe() guards every handler so a reporting bug can never take down the host
  // gateway; builders return null for events that are not error-bearing.
  if (hookEnabled("model_call_ended")) {
    api.on("model_call_ended", (event) => {
      safe(api.logger, PLUGIN_ID, "model_call_ended", () => {
        dispatchCapture(Sentry, buildModelCallEndedCapture(event, hostname));
      });
    });
  }
  // The second arg is PluginHookAgentContext, which already carries
  // sessionId/agentId. Destructuring it here is what lets the capture tag the
  // correlation ids; no upstream hook-type change was needed.
  if (hookEnabled("agent_end")) {
    api.on("agent_end", (event, ctx) => {
      safe(api.logger, PLUGIN_ID, "agent_end", () => {
        dispatchCapture(Sentry, buildAgentEndCapture(event, hostname, ctx));
      });
    });
  }
  if (hookEnabled("after_tool_call")) {
    api.on("after_tool_call", (event) => {
      safe(api.logger, PLUGIN_ID, "after_tool_call", () => {
        dispatchCapture(Sentry, buildAfterToolCallCapture(event, hostname));
      });
    });
  }
  if (hookEnabled("message_sent")) {
    api.on("message_sent", (event) => {
      safe(api.logger, PLUGIN_ID, "message_sent", () => {
        dispatchCapture(Sentry, buildMessageSentCapture(event, hostname));
      });
    });
  }
  if (hookEnabled("delivery_recovery_exhausted")) {
    api.on("delivery_recovery_exhausted", (event) => {
      safe(api.logger, PLUGIN_ID, "delivery_recovery_exhausted", () => {
        dispatchCapture(Sentry, buildDeliveryRecoveryExhaustedCapture(event, hostname));
      });
    });
  }
  if (hookEnabled("subagent_ended")) {
    api.on("subagent_ended", (event) => {
      safe(api.logger, PLUGIN_ID, "subagent_ended", () => {
        dispatchCapture(Sentry, buildSubagentEndedCapture(event, hostname));
      });
    });
  }
  if (hookEnabled("cron_changed")) {
    api.on("cron_changed", (event) => {
      safe(api.logger, PLUGIN_ID, "cron_changed", () => {
        dispatchCapture(Sentry, buildCronChangedCapture(event, hostname));
      });
    });
  }
  if (hookEnabled("session_end")) {
    api.on("session_end", (event) => {
      safe(api.logger, PLUGIN_ID, "session_end", () => {
        dispatchCapture(Sentry, buildSessionEndCapture(event, hostname));
      });
    });
  }

  // Flush buffered Sentry events before the gateway exits.
  api.lifecycle.registerRuntimeLifecycle({
    id: `${PLUGIN_ID}/sentry-flush`,
    description: "Flush Sentry buffer on plugin / gateway shutdown",
    cleanup: async () => {
      await Sentry.close(2000);
    },
  });
}
