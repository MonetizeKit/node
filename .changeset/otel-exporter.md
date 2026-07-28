---
"@monetizekit/node": minor
---

OpenTelemetry exporter (`@monetizekit/node/otel`, FRD-PO-004) and evaluation deep links.

- New `@monetizekit/node/otel` subpath export: `instrumentMonetizeKit()` returns a `DecisionObserver` that maps every SDK entitlement decision onto the host application's existing OpenTelemetry tracer and meter. Registers instrumentation only — never installs a provider, collector, or exporter. No-ops silently when no OTel SDK is registered. `@opentelemetry/api` is an optional peer dependency, loaded only by the `/otel` subpath.
- Spans: `monetizekit.entitlement_check` / `monetizekit.batch_check`, nested in the caller's active trace, with stable `monetizekit.*` attributes (customer_id, feature_key, decision, reason_code, cache_hit, degraded, evaluation_id, inspector_url, error). Denials are span status OK — only transport failures are ERROR. Cache-served decisions are emitted as spans flagged `cache_hit=true`.
- Metrics: `monetizekit.check.duration` (histogram, ms), `monetizekit.checks` (counter), `monetizekit.degraded_checks` (counter) — attributes exclude customer and evaluation ids by design so cardinality is bounded. Traces and metrics are independently enableable.
- `EntitlementCheckDecision` and `DecisionEvent` now carry `evaluationId` when the API supplies one; the exporter renders it as a `monetizekit.inspector_url` deep link to the dashboard evaluation inspector (configurable via `inspectorBaseUrl`, disable with `null`).
