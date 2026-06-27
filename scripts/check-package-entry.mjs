/**
 * Package-entry guard: assert the built package exports the real client and
 * helpers (functions/classes), never placeholders. Run after `pnpm build`.
 */
import * as mk from "../dist/index.js";

const expectedFunctions = [
  "MonetizeKit",
  "verifyWebhookSignature",
  "ConfigurationError",
];

const problems = [];
for (const name of expectedFunctions) {
  if (typeof mk[name] !== "function") {
    problems.push(`${name}: expected function/class, got ${typeof mk[name]}`);
  }
}

// Constructing the client must wire up the resource namespaces.
try {
  const client = new mk.MonetizeKit({ apiKey: "mk_test_entryguard" });
  for (const ns of ["entitlements", "customers", "subscriptions", "usage", "credits", "plans", "features"]) {
    if (typeof client[ns] !== "object" || client[ns] === null) {
      problems.push(`client.${ns}: expected resource object, got ${typeof client[ns]}`);
    }
  }
} catch (err) {
  problems.push(`new MonetizeKit({ apiKey }) threw: ${err?.message ?? err}`);
}

if (problems.length > 0) {
  console.error("Package entry guard failed:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("Package entry guard passed: client + helpers are exported and wired.");
