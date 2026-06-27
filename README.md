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
if (decision.value) {
  // entitled
}

// Manage customers
const { data: customers } = await mk.customers.list({ page: 1, pageSize: 20 });
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

MIT
