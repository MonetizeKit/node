/**
 * Error mapper — Task 2.5
 * Maps API error responses to typed SDK error classes.
 */
import type { ApiErrorResponse } from "@monetizekit/types";
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
} from "./errors";

export function mapApiError(
  status: number,
  body: ApiErrorResponse,
  requestId?: string,
): MonetizeKitError {
  const { code, message, details } = body.error;
  const rid = requestId ?? body.error.request_id;

  switch (status) {
    case 401:
      return new AuthenticationError(message, rid);

    case 403:
      if (code === "ENTITLEMENT_DENIED") {
        return new EntitlementDeniedError("unknown", message, rid);
      }
      if (code === "PLAN_LIMIT_EXCEEDED") {
        return new PlanLimitExceededError("unknown", 0, message, rid);
      }
      return new MonetizeKitError(message, 403, code, rid);

    case 404:
      return new ResourceNotFoundError(message, rid);

    case 409:
      return new ConflictError(code, message, rid);

    case 422:
      return new ValidationError(message, details ?? [], rid);

    case 429:
      return new RateLimitExceededError(60, message, rid);

    case 500:
      return new InternalServerError(message, rid);

    default:
      return new MonetizeKitError(message, status, code, rid);
  }
}
