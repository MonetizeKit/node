/**
 * Client construction and HTTP-config contract: API-key validation, base-URL
 * defaulting and normalization, standard request headers, client-error retry
 * policy, and typed error propagation through resource methods. API responses
 * are mocked at the fetch boundary (unit scope).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonetizeKit } from "../src/index";
import {
  AuthenticationError,
  ConfigurationError,
  InternalServerError,
  ResourceNotFoundError,
} from "../src/errors";

const API_KEY = "mk_test_key";
const BASE_URL = "https://api.test";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function apiError(code: string, message: string, status: number) {
  return jsonResponse({ error: { code, message, request_id: "req_test" } }, status);
}

describe("client construction & config", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ConfigurationError when the API key is missing", () => {
    expect(() => new MonetizeKit({ apiKey: "" })).toThrow(ConfigurationError);
    expect(() => new MonetizeKit({ apiKey: "" })).toThrow(/API key is required/);
  });

  it("exposes every resource namespace on construction", () => {
    const mk = new MonetizeKit({ apiKey: API_KEY });
    for (const namespace of [
      "entitlements",
      "customers",
      "subscriptions",
      "usage",
      "credits",
      "plans",
      "features",
      "experiments",
      "entities",
    ] as const) {
      expect(mk[namespace], `mk.${namespace}`).toBeTypeOf("object");
    }
  });

  it("defaults the base URL to https://app.monetizekit.app", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "cust_1" }));
    const mk = new MonetizeKit({ apiKey: API_KEY });

    await mk.customers.get("cust_1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.monetizekit.app/api/v1/customers/cust_1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("strips trailing slashes from a custom base URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "cust_1" }));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: "https://api.test///" });

    await mk.customers.get("cust_1");

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/api/v1/customers/cust_1");
  });

  it("sends bearer auth, JSON content type, user agent, and a unique request id on every call", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: "cust_1" })));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await mk.customers.get("cust_1");
    await mk.customers.get("cust_2");

    const first = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const second = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(first["Authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(first["Content-Type"]).toBe("application/json");
    expect(first["User-Agent"]).toMatch(/^@monetizekit\/node\//);
    expect(first["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second["X-Request-Id"]).not.toBe(first["X-Request-Id"]);
  });

  it("maps a 401 response to AuthenticationError", async () => {
    fetchMock.mockResolvedValueOnce(apiError("UNAUTHORIZED", "Invalid API key", 401));
    const mk = new MonetizeKit({ apiKey: "mk_bad_key", baseUrl: BASE_URL });

    await expect(mk.customers.get("cust_1")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps a 404 response to ResourceNotFoundError without retrying", async () => {
    fetchMock.mockResolvedValueOnce(apiError("NOT_FOUND", "No such customer", 404));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await expect(mk.customers.get("cust_missing")).rejects.toBeInstanceOf(ResourceNotFoundError);
    // Client errors are terminal: one fetch even though maxRetries defaults to 3.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a 500 response to InternalServerError once retries are exhausted", async () => {
    fetchMock.mockResolvedValue(apiError("INTERNAL_SERVER_ERROR", "boom", 500));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, maxRetries: 0 });

    const error = await mk.customers.get("cust_1").then(
      () => {
        throw new Error("expected get() to reject");
      },
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).statusCode).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the API error message and requestId on mapped errors", async () => {
    fetchMock.mockResolvedValueOnce(apiError("NOT_FOUND", "Customer cust_9 not found", 404));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const error = await mk.customers.get("cust_9").then(
      () => {
        throw new Error("expected get() to reject");
      },
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ResourceNotFoundError);
    expect((error as ResourceNotFoundError).message).toBe("Customer cust_9 not found");
    // The client stamps its generated X-Request-Id onto mapped errors.
    expect((error as ResourceNotFoundError).requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
