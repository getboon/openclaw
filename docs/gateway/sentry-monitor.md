---
summary: "Forward error-bearing OpenClaw lifecycle events to Sentry through the bundled sentry-monitor plugin"
title: "Sentry monitoring"
sidebarTitle: "Sentry"
read_when:
  - You want OpenClaw Gateway errors reported to Sentry for alerting and dedup
  - You need to know which lifecycle failures are captured and how to configure the DSN
---

OpenClaw can forward every error-bearing lifecycle event to [Sentry](https://sentry.io) through the bundled `sentry-monitor` plugin. Sentry handles fingerprinting, dedup, frequency tracking, alert routing (Slack/PagerDuty/email), and issue lifecycle, so the plugin stays small and ships with the gateway.

The plugin is **bundled and enabled by default**, but stays **inactive until a DSN is configured** — install-everywhere safe.

<Note>
If no DSN is set, the plugin logs one warn line on boot and registers no hooks. It never ships prompt content, message history, tool payloads, or secrets — only structured metadata (host, model, provider, tool name, error string, run/call/session ids, durations).
</Note>

## Configure

Set the Sentry DSN via one of:

- **Env var:** `BOON_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>`
- **Plugin config** in `~/.openclaw/openclaw.json`:

  ```json5
  {
    plugins: {
      entries: {
        "sentry-monitor": {
          config: {
            dsn: "https://...",
            environment: "my-host-1",
            tracesSampleRate: 0,
          },
        },
      },
    },
  }
  ```

The `environment` tag defaults to the host's hostname, and the OpenClaw version is sent as the Sentry `release` for built-in regression tracking across upgrades.

## What it captures

Every error-bearing lifecycle hook plus node-level uncaught exceptions and unhandled promise rejections:

| Hook               | Captured when                                               | Sentry tags                                                                              |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `model_call_ended` | `outcome === "error"`                                       | `provider`, `model`, `api`, `transport`, `failure_kind`, `error_category`, `error_class` |
| `agent_end`        | `success === false`                                         | `host`                                                                                   |
| `after_tool_call`  | `error` is set                                              | `tool`                                                                                   |
| `message_sent`     | `success === false`                                         | `host`                                                                                   |
| `subagent_ended`   | `outcome ∈ {error, timeout, killed, reset, deleted}`        | `outcome`, `target_kind`                                                                 |
| `cron_changed`     | `status === "error"` or `deliveryError` set                 | `action`, `status`, `delivery_status`                                                    |
| `session_end`      | `reason === "unknown"` (other reasons are normal lifecycle) | `reason`                                                                                 |
| node-level         | `uncaughtException` / `unhandledRejection`                  | _(Sentry auto-tags)_                                                                     |

For a `model_call_ended` error, `error_class` classifies a 5xx failure by source so an alert can page on the two differently (ENG-16922): `upstream_provider_5xx` is a Bedrock/Anthropic 5xx (500/503/529, `api_error`/`overloaded`/`overloaded_error`) relayed verbatim by boon-llm-gateway — a provider outage, not our infra — while `gateway_origin_5xx` is a gateway-synthesized 5xx (chiefly a 502 from an exhausted chain, a WAF/HTML block page, or a no-response transport fault). It is unset for non-5xx failures. The raw numeric `http_status` is attached as event `extra` for drilldown. The classification is status-driven (see `classify5xxSource`), not message-text-driven.

Each capture is wrapped so a bug in the reporting path cannot take down the gateway. Performance tracing is off by default (`tracesSampleRate: 0`).

## Disable

Set `plugins.entries["sentry-monitor"].enabled = false`, or simply leave the DSN unset.

## Related

- [Prometheus metrics](/gateway/prometheus) — pull-based metrics surface
- [OpenTelemetry export](/gateway/opentelemetry) — OTLP push for traces, metrics, and logs
- [Health and readiness](/gateway/health) — `/healthz` and `/readyz` probes
