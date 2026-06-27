/**
 * SDK error hierarchy tests.
 * Property tests for error mapping, typed fields, and completeness.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  MonetizeKitError,
  AuthenticationError,
  EntitlementDeniedError,
  PlanLimitExceededError,
  ResourceNotFoundError,
  ConflictError,
  ValidationError,
  RateLimitExceededError,
  InternalServerError,
  ConfigurationError,
  WebhookSignatureError,
} from "../src/errors";
import { mapApiError } from "../src/error-mapper";

describe("SDK error hierarchy", () => {
  it("all error classes extend MonetizeKitError", () => {
    const errors = [
      new AuthenticationError(),
      new EntitlementDeniedError("feat"),
      new PlanLimitExceededError("feat", 10),
      new ResourceNotFoundError(),
      new ConflictError("reason"),
      new ValidationError("bad"),
      new RateLimitExceededError(60),
      new InternalServerError(),
      new ConfigurationError("missing key"),
      new WebhookSignatureError(),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(MonetizeKitError);
      expect(error).toBeInstanceOf(Error);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("each error has correct status code", () => {
    expect(new AuthenticationError().statusCode).toBe(401);
    expect(new EntitlementDeniedError("x").statusCode).toBe(403);
    expect(new PlanLimitExceededError("x", 5).statusCode).toBe(403);
    expect(new ResourceNotFoundError().statusCode).toBe(404);
    expect(new ConflictError("x").statusCode).toBe(409);
    expect(new ValidationError("x").statusCode).toBe(422);
    expect(new RateLimitExceededError(30).statusCode).toBe(429);
    expect(new InternalServerError().statusCode).toBe(500);
  });

  it("each error has correct error code", () => {
    expect(new AuthenticationError().errorCode).toBe("UNAUTHORIZED");
    expect(new EntitlementDeniedError("x").errorCode).toBe("ENTITLEMENT_DENIED");
    expect(new ResourceNotFoundError().errorCode).toBe("NOT_FOUND");
    expect(new ConflictError("x").errorCode).toBe("CONFLICT");
    expect(new ValidationError("x").errorCode).toBe("VALIDATION_ERROR");
    expect(new RateLimitExceededError(30).errorCode).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("Error mapping", () => {
  const errorMappings: Array<[number, string, new (...args: never[]) => MonetizeKitError]> = [
    [401, "UNAUTHORIZED", AuthenticationError],
    [403, "ENTITLEMENT_DENIED", EntitlementDeniedError],
    [403, "PLAN_LIMIT_EXCEEDED", PlanLimitExceededError],
    [404, "NOT_FOUND", ResourceNotFoundError],
    [409, "CONFLICT", ConflictError],
    [422, "VALIDATION_ERROR", ValidationError],
    [429, "RATE_LIMIT_EXCEEDED", RateLimitExceededError],
    [500, "INTERNAL_SERVER_ERROR", InternalServerError],
  ];

  it("maps each status code to correct error class", () => {
    for (const [status, code, ErrorClass] of errorMappings) {
      const error = mapApiError(status, {
        error: { code, message: "test", request_id: "req_1" },
      });
      expect(error).toBeInstanceOf(ErrorClass);
      expect(error.statusCode).toBe(status);
    }
  });
});

describe("Typed error fields", () => {
  it("ValidationError contains details array", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            field: fc.string({ minLength: 1 }),
            message: fc.string({ minLength: 1 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (details) => {
          const error = new ValidationError("bad input", details);
          expect(error.details).toEqual(details);
          expect(error.statusCode).toBe(422);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("RateLimitExceededError contains retryAfter", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3600 }), (retryAfter) => {
        const error = new RateLimitExceededError(retryAfter);
        expect(error.retryAfter).toBe(retryAfter);
      }),
      { numRuns: 100 },
    );
  });

  it("ConflictError contains reason", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (reason) => {
        const error = new ConflictError(reason);
        expect(error.reason).toBe(reason);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Error type completeness", () => {
  const apiErrorCodes = [
    "UNAUTHORIZED",
    "ENTITLEMENT_DENIED",
    "PLAN_LIMIT_EXCEEDED",
    "NOT_FOUND",
    "CONFLICT",
    "VALIDATION_ERROR",
    "RATE_LIMIT_EXCEEDED",
    "INTERNAL_SERVER_ERROR",
    "PERMISSION_DENIED",
    "FORBIDDEN",
  ];

  it("SDK handles all known API error codes", () => {
    for (const code of apiErrorCodes) {
      const status = code === "NOT_FOUND" ? 404 : code === "UNAUTHORIZED" ? 401 : 500;
      const error = mapApiError(status, {
        error: { code, message: "test", request_id: "req" },
      });
      expect(error).toBeInstanceOf(MonetizeKitError);
    }
  });
});
