---
"@monetizekit/node": minor
---

Enriched entitlement decisions, batch checks, caching/degradation, extension points, and credit reservations (FRD-PO-002).

- `entitlements.check()` now returns the enriched decision: stable `reasonCode`, `resetsAt` on limit denials, and `grantedByPlans` upgrade paths on denials.
- `entitlements.checkMany(customerId, featureKeys)` checks up to 50 features with a single customer resolution via `POST /entitlements/batch`.
- Opt-in local decision cache (`cache: true` or `{ ttlMs, maxEntries }`) and degradation modes (`degradation: "throw" | "fail_open" | "fail_closed"`; stale cache preferred over synthesized decisions).
- Shared extension points: `IdentityResolver` (identity-provider integrations) and `DecisionObserver` (observability integrations receive every decision, including cached and degraded ones).
- Credit reservations: `credits.reserve/getReservation/captureReservation/releaseReservation` and the `credits.withReservation(data, fn)` helper (reserve → work → capture actual cost; auto-release on failure).
