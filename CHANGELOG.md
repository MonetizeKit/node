# @monetizekit/node

## 0.2.0

### Minor Changes

- afd19d2: OpenTelemetry exporter (`@monetizekit/node/otel`, FRD-PO-004) and evaluation deep links.

  - New `@monetizekit/node/otel` subpath export: `instrumentMonetizeKit()` returns a `DecisionObserver` that maps every SDK entitlement decision onto the host application's existing OpenTelemetry tracer and meter. Registers instrumentation only — never installs a provider, collector, or exporter. No-ops silently when no OTel SDK is registered. `@opentelemetry/api` is an optional peer dependency, loaded only by the `/otel` subpath.
  - Spans: `monetizekit.entitlement_check` / `monetizekit.batch_check`, nested in the caller's active trace, with stable `monetizekit.*` attributes (customer_id, feature_key, decision, reason_code, cache_hit, degraded, evaluation_id, inspector_url, error). Denials are span status OK — only transport failures are ERROR. Cache-served decisions are emitted as spans flagged `cache_hit=true`.
  - Metrics: `monetizekit.check.duration` (histogram, ms), `monetizekit.checks` (counter), `monetizekit.degraded_checks` (counter) — attributes exclude customer and evaluation ids by design so cardinality is bounded. Traces and metrics are independently enableable.
  - `EntitlementCheckDecision` and `DecisionEvent` now carry `evaluationId` when the API supplies one; the exporter renders it as a `monetizekit.inspector_url` deep link to the dashboard evaluation inspector (configurable via `inspectorBaseUrl`, disable with `null`).

- 06808f7: Enriched entitlement decisions, batch checks, caching/degradation, extension points, and credit reservations (FRD-PO-002).

  - `entitlements.check()` now returns the enriched decision: stable `reasonCode`, `resetsAt` on limit denials, and `grantedByPlans` upgrade paths on denials.
  - `entitlements.checkMany(customerId, featureKeys)` checks up to 50 features with a single customer resolution via `POST /entitlements/batch`.
  - Opt-in local decision cache (`cache: true` or `{ ttlMs, maxEntries }`) and degradation modes (`degradation: "throw" | "fail_open" | "fail_closed"`; stale cache preferred over synthesized decisions).
  - Shared extension points: `IdentityResolver` (identity-provider integrations) and `DecisionObserver` (observability integrations receive every decision, including cached and degraded ones).
  - Credit reservations: `credits.reserve/getReservation/captureReservation/releaseReservation` and the `credits.withReservation(data, fn)` helper (reserve → work → capture actual cost; auto-release on failure).
