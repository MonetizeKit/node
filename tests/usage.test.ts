/**
 * Usage reporting surface: request shape (endpoint, method, auth header,
 * body), idempotency-key propagation, and error handling. API responses are
 * mocked at the fetch boundary (unit scope); live conformance is covered by
 * the platform monorepo's SDK-API contract suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonetizeKit } from "../src/index";
import { ValidationError } from "../src/errors";

const API_KEY = "mk_test_key";
const BASE_URL = "https://api.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("usage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submit() POSTs the event to /api/v1/usage/events with auth header and exact body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accepted: true }));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await mk.usage.submit({
      customerId: "cust_1",
      meterId: "tokens",
      value: 1500,
      subjectId: "ent_agent_1",
      dimensions: { model: "fable-5", operation: "completion" },
      description: "agent run",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/v1/usage/events`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      customerId: "cust_1",
      meterId: "tokens",
      value: 1500,
      subjectId: "ent_agent_1",
      dimensions: { model: "fable-5", operation: "completion" },
      description: "agent run",
    });
  });

  it("submit() forwards idempotencyKey as the Idempotency-Key header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accepted: true }));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await mk.usage.submit({
      customerId: "cust_1",
      meterId: "tokens",
      value: 10,
      idempotencyKey: "evt_abc123",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("evt_abc123");
  });

  it("submit() omits the Idempotency-Key header when no key is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accepted: true }));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await mk.usage.submit({ customerId: "cust_1", meterId: "tokens", value: 10 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty("Idempotency-Key");
  });

  it("get() GETs /api/v1/usage/:customerId/:meterId and returns the payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ meterId: "tokens", total: 42_000, window: "month" }),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const result = await mk.usage.get("cust_1", "tokens");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/usage/cust_1/tokens`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({ meterId: "tokens", total: 42_000, window: "month" });
  });

  it("breakdown() GETs the breakdown endpoint with the dimension query param", async () => {
    const body = {
      meterId: "tokens",
      dimension: "model",
      window: "month",
      total: 100,
      totalCreditCost: 10,
      breakdown: [{ value: "fable-5", total: 100, count: 3, creditCost: 10 }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const result = await mk.usage.breakdown("cust_1", "tokens", "model");

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/usage/cust_1/tokens/breakdown?dimension=model`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual(body);
  });

  it("submit() propagates a 422 response as ValidationError with field details", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "value must be positive",
            details: [{ field: "value", message: "must be positive" }],
            request_id: "req_422",
          },
        },
        422,
      ),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const error = await mk.usage
      .submit({ customerId: "cust_1", meterId: "tokens", value: -1 })
      .then(
        () => {
          throw new Error("expected submit() to reject");
        },
        (err: unknown) => err,
      );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).statusCode).toBe(422);
    expect((error as ValidationError).details).toEqual([
      { field: "value", message: "must be positive" },
    ]);
  });

  it("submit() rejects with the underlying network error when fetch fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, maxRetries: 0 });

    await expect(
      mk.usage.submit({ customerId: "cust_1", meterId: "tokens", value: 10 }),
    ).rejects.toThrow("fetch failed");
  });
});
