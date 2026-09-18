# diagnostics-otel

OpenTelemetry diagnostics exporter bundled with OpenClaw.

This plugin exports OpenClaw Gateway traces, metrics, and logs to an OTLP collector for observability stacks such as Grafana, Datadog, Honeycomb, New Relic, Tempo, and compatible collectors. It can also write diagnostic log records as stdout JSONL for container log pipelines.

## Enable

The plugin ships inside the OpenClaw package and is enabled by default. It stays a no-op until `diagnostics.otel.enabled` is `true`, so the only setup is the `diagnostics.otel` config block (endpoint, headers, service name, signals). If `plugins.allow` is a restrictive list, add `diagnostics-otel` to it. Restart the Gateway after changing the config.

The full config surface, metric names, span names, and collector examples live in the docs:

- https://docs.openclaw.ai/gateway/opentelemetry

## Package

- Plugin id: `diagnostics-otel`
