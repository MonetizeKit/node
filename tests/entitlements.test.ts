/**
 * Entitlement decision surface: enriched check, batch check, cache behavior,
 * degradation modes, and decision observers. API responses are mocked at the
 * fetch boundary (unit scope); live conformance is covered by the platform
 * monorepo's SDK-API contract suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonetizeKit, type DecisionEvent, type EntitlementCheckDecision } from "../src/index";

const API_KEY = "mk_test_key";
const BASE_URL = "https://api.test";

function decisionBody(overrides: Partial<EntitlementCheckDecision> = {}) {
  return {
    customerId: "cust_1",
    featureKey: "sso",
    allowed: true,
    effectiveValue: true,
    type: "boolean",
    sources: ["Plan"],
    reason: "Entitlement grants access",
    reasonCode: "granted",
    planName: "Pro",
    planVersion: 1,
    latencyMs: 4,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("entitlements", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("check() returns the enriched decision including reasonCode and grantedByPlans", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        decisionBody({
          allowed: false,
          effectiveValue: false,
          reason: "Feature not granted by plan/add-ons/overrides",
          reasonCode: "not_in_plan",
          grantedByPlans: ["Pro", "Enterprise"],
        }),
      ),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const decision = await mk.entitlements.check("cust_1", "sso");

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("not_in_plan");
    expect(decision.grantedByPlans).toEqual(["Pro", "Enterprise"]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/entitlements/cust_1/sso`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("checkMany() posts to the batch endpoint and re-attaches customerId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        customerId: "cust_1",
        latencyMs: 12,
        results: [
          { ...decisionBody(), customerId: undefined },
          {
            ...decisionBody({
              featureKey: "api_calls",
              type: "limit",
              effectiveValue: 100,
              reasonCode: "within_limit",
              usage: 30,
              limit: 100,
              remaining: 70,
              resetsAt: "2026-08-01T00:00:00.000Z",
            }),
            customerId: undefined,
          },
        ],
      }),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const decisions = await mk.entitlements.checkMany("cust_1", ["sso", "api_calls"]);

    expect(decisions).toHaveLength(2);
    expect(decisions[1].customerId).toBe("cust_1");
    expect(decisions[1].remaining).toBe(70);
    expect(decisions[1].resetsAt).toBe("2026-08-01T00:00:00.000Z");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/entitlements/batch`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      customerId: "cust_1",
      featureKeys: ["sso", "api_calls"],
    });
  });

  it("serves repeat checks from the cache within the TTL and marks them cached", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(decisionBody())));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, cache: true });

    const first = await mk.entitlements.check("cust_1", "sso");
    const second = await mk.entitlements.check("cust_1", "sso");

    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // bypassCache forces a real call.
    await mk.entitlements.check("cust_1", "sso", { bypassCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checkMany() populates the cache used by check()", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        customerId: "cust_1",
        latencyMs: 5,
        results: [decisionBody()],
      }),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, cache: true });

    await mk.entitlements.checkMany("cust_1", ["sso"]);
    const decision = await mk.entitlements.check("cust_1", "sso");

    expect(decision.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degradation=throw (default) rethrows API failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, maxRetries: 0 });

    await expect(mk.entitlements.check("cust_1", "sso")).rejects.toThrow("fetch failed");
  });

  it("degradation=fail_open synthesizes an allow with sdk_fail_open when there is no cache", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 0,
      degradation: "fail_open",
    });

    const decision = await mk.entitlements.check("cust_1", "sso");

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("sdk_fail_open");
    expect(decision.degraded).toBe(true);
  });

  it("degradation=fail_closed synthesizes a deny with sdk_fail_closed", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 0,
      degradation: "fail_closed",
    });

    const decision = await mk.entitlements.check("cust_1", "sso");

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("sdk_fail_closed");
    expect(decision.degraded).toBe(true);
  });

  it("degradation prefers a stale cached decision over a synthesized one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(decisionBody()));
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 0,
      // TTL 0: every entry is stale immediately, so a fresh-cache hit can't mask the fallback.
      cache: { ttlMs: 0 },
      degradation: "fail_closed",
    });

    await mk.entitlements.check("cust_1", "sso");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const decision = await mk.entitlements.check("cust_1", "sso");

    // The real (allowed) decision survives, marked stale+degraded — even
    // though the mode is fail_closed.
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("granted");
    expect(decision.cached).toBe(true);
    expect(decision.degraded).toBe(true);
  });

  it("notifies observers for API-served, cached, and degraded decisions — and survives observer throws", async () => {
    const events: DecisionEvent[] = [];
    const throwingObserver = {
      onDecision: () => {
        throw new Error("observer bug");
      },
    };
    const collector = { onDecision: (event: DecisionEvent) => events.push(event) };

    fetchMock.mockResolvedValueOnce(jsonResponse(decisionBody()));
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      maxRetries: 0,
      cache: true,
      degradation: "fail_open",
      observers: [throwingObserver, collector],
    });

    await mk.entitlements.check("cust_1", "sso");
    await mk.entitlements.check("cust_1", "sso");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await mk.entitlements.check("cust_2", "sso");

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      kind: "entitlement_check",
      customerId: "cust_1",
      featureKey: "sso",
      allowed: true,
      reasonCode: "granted",
      cached: false,
      degraded: false,
    });
    expect(events[1]).toMatchObject({ cached: true });
    expect(events[2]).toMatchObject({
      customerId: "cust_2",
      degraded: true,
      reasonCode: "sdk_fail_open",
      error: expect.stringContaining("fetch failed"),
    });
  });

  it("resolveCustomerId() delegates to the configured IdentityResolver", async () => {
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      identityResolver: {
        resolveCustomerId: async (externalId) =>
          externalId === "user_clerk_1" ? "cust_1" : null,
      },
    });

    expect(await mk.resolveCustomerId("user_clerk_1")).toBe("cust_1");
    expect(await mk.resolveCustomerId("user_unknown")).toBeNull();
  });

  it("resolveCustomerId() throws ConfigurationError when no resolver is configured", async () => {
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });
    await expect(mk.resolveCustomerId("user_1")).rejects.toThrow(/identityResolver/);
  });
});
