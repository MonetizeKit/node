/**
 * MonetizeKit SDK error hierarchy — Task 2.1
 * Each API error code maps to a specific SDK error class.
 */

export class MonetizeKitError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "MonetizeKitError";
  }
}

export class AuthenticationError extends MonetizeKitError {
  constructor(message = "Invalid or missing API key", requestId?: string) {
    super(message, 401, "UNAUTHORIZED", requestId);
    this.name = "AuthenticationError";
  }
}

export class EntitlementDeniedError extends MonetizeKitError {
  constructor(
    public readonly featureKey: string,
    message?: string,
    requestId?: string,
  ) {
    super(message ?? `Feature '${featureKey}' is not available on the current plan`, 403, "ENTITLEMENT_DENIED", requestId);
    this.name = "EntitlementDeniedError";
  }
}

export class PlanLimitExceededError extends MonetizeKitError {
  constructor(
    public readonly featureKey: string,
    public readonly limit: number,
    message?: string,
    requestId?: string,
  ) {
    super(message ?? `Plan limit exceeded for '${featureKey}' (limit: ${limit})`, 403, "PLAN_LIMIT_EXCEEDED", requestId);
    this.name = "PlanLimitExceededError";
  }
}

export class ResourceNotFoundError extends MonetizeKitError {
  constructor(message = "Resource not found", requestId?: string) {
    super(message, 404, "NOT_FOUND", requestId);
    this.name = "ResourceNotFoundError";
  }
}

export class ConflictError extends MonetizeKitError {
  constructor(
    public readonly reason: string,
    message?: string,
    requestId?: string,
  ) {
    super(message ?? `Conflict: ${reason}`, 409, "CONFLICT", requestId);
    this.name = "ConflictError";
  }
}

export class ValidationError extends MonetizeKitError {
  constructor(
    message: string,
    public readonly details: Array<{ field: string; message: string }> = [],
    requestId?: string,
  ) {
    super(message, 422, "VALIDATION_ERROR", requestId);
    this.name = "ValidationError";
  }
}

export class RateLimitExceededError extends MonetizeKitError {
  constructor(
    public readonly retryAfter: number,
    message?: string,
    requestId?: string,
  ) {
    super(message ?? `Rate limit exceeded. Retry after ${retryAfter} seconds.`, 429, "RATE_LIMIT_EXCEEDED", requestId);
    this.name = "RateLimitExceededError";
  }
}

export class InternalServerError extends MonetizeKitError {
  constructor(message = "An internal error occurred", requestId?: string) {
    super(message, 500, "INTERNAL_SERVER_ERROR", requestId);
    this.name = "InternalServerError";
  }
}

export class ConfigurationError extends MonetizeKitError {
  constructor(message: string) {
    super(message, 0, "CONFIGURATION_ERROR");
    this.name = "ConfigurationError";
  }
}

export class WebhookSignatureError extends MonetizeKitError {
  constructor(message = "Invalid webhook signature") {
    super(message, 0, "WEBHOOK_SIGNATURE_ERROR");
    this.name = "WebhookSignatureError";
  }
}
