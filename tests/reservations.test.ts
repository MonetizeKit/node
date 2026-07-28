/**
 * Credit reservation surface: reserve/capture/release wiring and the
 * withReservation lifecycle helper (capture actual cost on success, release
 * on failure, surface the original error).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonetizeKit, type CreditReservation } from "../src/index";

const API_KEY = "mk_test_key";
const BASE_URL = "https://api.test";

function reservation(overrides: Partial<CreditReservation> = {}): CreditReservation {
  return {
    id: "resv_1",
    customerId: "cust_1",
    walletId: "wal_1",
    status: "held",
    amount: 100,
    capturedAmount: null,
    description: "agent run",
    expiresAt: "2026-07-28T13:00:00.000Z",
    resolvedAt: null,
    createdAt: "2026-07-28T12:55:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("credit reservations", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reserve() posts the hold and forwards the idempotency key as a header", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ reservation: reservation(), walletBalance: 400 }),
    );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const result = await mk.credits.reserve({
      customerId: "cust_1",
      amount: 100,
      description: "agent run",
      idempotencyKey: "run-42",
    });

    expect(result.reservation.status).toBe("held");
    expect(result.walletBalance).toBe(400);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/v1/credits/reserve`);
    expect((init as RequestInit).headers).toMatchObject({ "Idempotency-Key": "run-42" });
  });

  it("captureReservation() sends the partial amount; releaseReservation() posts to release", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          reservation: reservation({ status: "captured", capturedAmount: 40 }),
          walletBalance: 460,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation({ status: "released" }), walletBalance: 500 }),
      );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const captured = await mk.credits.captureReservation("resv_1", 40);
    expect(captured.reservation.capturedAmount).toBe(40);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE_URL}/api/v1/credits/reservations/resv_1/capture`,
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      amount: 40,
    });

    const released = await mk.credits.releaseReservation("resv_1");
    expect(released.reservation.status).toBe("released");
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${BASE_URL}/api/v1/credits/reservations/resv_1/release`,
    );
  });

  it("withReservation() captures the actual cost reported by the work function", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation(), walletBalance: 400 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          reservation: reservation({ status: "captured", capturedAmount: 37 }),
          walletBalance: 463,
        }),
      );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    const outcome = await mk.credits.withReservation(
      { customerId: "cust_1", amount: 100 },
      async (held) => {
        expect(held.status).toBe("held");
        return { value: "agent output", cost: 37 };
      },
    );

    expect(outcome.value).toBe("agent output");
    expect(outcome.reservation.capturedAmount).toBe(37);
    expect(outcome.walletBalance).toBe(463);
    // reserve → capture(37); no release call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      amount: 37,
    });
  });

  it("withReservation() captures the full hold when the work reports no cost", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation(), walletBalance: 400 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          reservation: reservation({ status: "captured", capturedAmount: 100 }),
          walletBalance: 400,
        }),
      );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await mk.credits.withReservation({ customerId: "cust_1", amount: 100 }, async () => ({
      value: null,
    }));

    // Full capture posts an empty body (platform defaults to the held amount).
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({});
  });

  it("withReservation() releases the hold and rethrows when the work fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation(), walletBalance: 400 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation({ status: "released" }), walletBalance: 500 }),
      );
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL });

    await expect(
      mk.credits.withReservation({ customerId: "cust_1", amount: 100 }, async () => {
        throw new Error("model provider exploded");
      }),
    ).rejects.toThrow("model provider exploded");

    expect(fetchMock.mock.calls[1][0]).toBe(
      `${BASE_URL}/api/v1/credits/reservations/resv_1/release`,
    );
  });

  it("withReservation() surfaces the original error even when the release also fails", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ reservation: reservation(), walletBalance: 400 }),
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const mk = new MonetizeKit({ apiKey: API_KEY, baseUrl: BASE_URL, maxRetries: 0 });

    await expect(
      mk.credits.withReservation({ customerId: "cust_1", amount: 100 }, async () => {
        throw new Error("model provider exploded");
      }),
    ).rejects.toThrow("model provider exploded");
  });
});
