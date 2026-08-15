# @monetizekit/node

Server-side Node.js SDK for [MonetizeKit](https://monetizekit.app) — entitlement
checks, customer & subscription management, usage and credits, and webhook
signature verification. Requires Node.js 18+ (uses the global `fetch`).

## Install

```bash
npm install @monetizekit/node
```

## Usage

```ts
import { MonetizeKit } from "@monetizekit/node";

const mk = new MonetizeKit({ apiKey: process.env.MONETIZEKIT_SECRET_KEY! });

// Gate a feature
const decision = await mk.entitlements.check("cust_123", "api_access");
if (decision.allowed) {
  // entitled
} else {
  // decision.reasonCode: "not_in_plan" | "limit_reached" | "unknown_feature" | ...
  // decision.grantedByPlans: plans that would grant access (upgrade path)
  // decision.resetsAt: when a reached limit's window resets
}

// Check many features with one customer resolution
const decisions = await mk.entitlements.checkMany("cust_123", [
  "api_access",
  "sso",
  "seats",
]);

// Manage customers
const { data: customers } = await mk.customers.list({ page: 1, pageSize: 20 });
```

### Caching, degradation, and observability

```ts
const mk = new MonetizeKit({
  apiKey: process.env.MONETIZEKIT_SECRET_KEY!,
  // Local decision cache (off by default): true for 30s TTL, or tune it.
  cache: { ttlMs: 30_000, maxEntries: 10_000 },
  // When the API is unreachable: "throw" (default) | "fail_open" | "fail_closed".
  // Stale cached decisions are preferred over synthesized ones.
  degradation: "fail_open",
  // Every decision (API-served, cached, degraded) is emitted to observers —
  // the hook OpenTelemetry/PostHog integrations attach to.
  observers: [{ onDecision: (event) => console.log(event) }],
});
```

### OpenTelemetry

One line maps every decision onto your existing OTel setup — spans nested in
your active traces plus bounded-cardinality metrics. Requires the optional
`@opentelemetry/api` peer dependency; no-ops silently when no OTel SDK is
registered (nothing to configure, nothing to pay for when unused):

```ts
import { instrumentMonetizeKit } from "@monetizekit/node/otel";

const mk = new MonetizeKit({
  apiKey: process.env.MONETIZEKIT_SECRET_KEY!,
  observers: [instrumentMonetizeKit()],
});
```

Denials are span status `OK` with `monetizekit.decision=denied` — never
`ERROR` (only transport failures are errors). Every span carries a
`monetizekit.inspector_url` attribute deep-linking to that exact evaluation in
the dashboard inspector (self-hosting: set `inspectorBaseUrl`; disable with
`null`). Traces and metrics are independently enableable via
`instrumentMonetizeKit({ traces, metrics })`.

### Credit reservations (AI/agent workloads)

Hold credits before work whose final cost is unknown, then capture the actual
cost — the platform guarantees concurrent holds never oversubscribe a wallet:

```ts
const { value } = await mk.credits.withReservation(
  { customerId: "cust_123", amount: 100, description: "agent run" },
  async () => {
    const output = await runAgent();
    return { value: output, cost: output.tokensUsed * 0.01 };
  },
);
// On failure the hold is released automatically; unresolved holds expire
// server-side after their TTL (default 300s).
```

Lower-level primitives: `credits.reserve()`, `credits.captureReservation()`,
`credits.releaseReservation()`, `credits.getReservation()`.

### Identity resolution

Identity-provider integrations (Clerk, Supabase, custom auth) implement the
`IdentityResolver` interface:

```ts
const mk = new MonetizeKit({
  apiKey: process.env.MONETIZEKIT_SECRET_KEY!,
  identityResolver: myResolver, // e.g. from @monetizekit/clerk
});
const customerId = await mk.resolveCustomerId("user_2abc...");
```

### Verify webhooks

```ts
import { verifyWebhookSignature } from "@monetizekit/node";

const ok = verifyWebhookSignature({
  rawBody,
  timestamp: req.headers["x-monetizekit-timestamp"],
  signature: req.headers["x-monetizekit-signature"],
  secret: process.env.MONETIZEKIT_WEBHOOK_SECRET!,
});
```

## License

Apache-2.0 © [Coordinated App LLC](https://monetizekit.com), d/b/a MonetizeKit. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
