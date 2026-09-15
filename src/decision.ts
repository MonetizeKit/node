/**
 * Entitlement decision types (FRD-PO-002 §5.3) and the SDK's two shared
 * extension points:
 *
 * - {@link IdentityResolver}: maps an external identity (Clerk user id,
 *   Supabase user id, your own auth's subject) to a MonetizeKit customer id.
 *   Identity-provider integrations ship as implementations of this interface.
 * - {@link DecisionObserver}: receives every entitlement decision the SDK
 *   makes (API-served, cache-served, or degraded). Observability integrations
 *   (OpenTelemetry, PostHog) ship as implementations of this interface.
 */

/**
 * Machine-readable cause of an entitlement decision. Server-produced codes
 * are stable API; the two `sdk_*` codes are produced locally by the SDK's
 * degradation fallback when the API is unreachable.
 */
export type EntitlementReasonCode =
  | "granted"
  | "granted_unlimited"
  | "granted_no_meter"
  | "within_limit"
  | "limit_reached"
  | "not_in_plan"
  | "unknown_feature"
  | "sdk_fail_open"
  | "sdk_fail_closed";

export interface EntitlementCheckDecision {
  customerId: string;
  featureKey: string;
  allowed: boolean;
  effectiveValue: string | number | boolean;
  type: string;
  sources: string[];
  /** Human-readable sentence for logs — not stable; branch on `reasonCode`. */
  reason: string;
  reasonCode: EntitlementReasonCode;
  planName?: string;
  planVersion?: number;
  latencyMs?: number;
  /** Present for limit-type features backed by a usage meter. */
  usage?: number;
  limit?: number;
  remaining?: number;
  /** ISO timestamp when the metering window resets (daily/monthly meters). */
  resetsAt?: string;
  /** On denial: published plans that would grant (or raise the limit for) this feature. */
  grantedByPlans?: string[];
  /** True when served from the SDK's local cache rather than the API. */
  cached?: boolean;
  /** True when produced by the degradation fallback after an API failure. */
  degraded?: boolean;
  /**
   * Id of the platform evaluation-log record behind this decision
   * (FRD-PO-004). Deep-links to the dashboard inspector at
   * `/observability/inspector/{evaluationId}`; retained for 90 days.
   * Absent on cache-served and degraded decisions that never hit the API
   * (cache hits reuse the original evaluation's id).
   */
  evaluationId?: string;
}

export interface BatchCheckResponse {
  customerId: string;
  latencyMs: number;
  results: Array<Omit<EntitlementCheckDecision, "customerId">>;
}

export type DegradationMode = "throw" | "fail_open" | "fail_closed";

export type DecisionEventKind = "entitlement_check" | "batch_check";

/** Emitted to every configured {@link DecisionObserver} for each decision. */
export interface DecisionEvent {
  kind: DecisionEventKind;
  customerId: string;
  featureKey?: string;
  allowed?: boolean;
  reasonCode?: EntitlementReasonCode;
  latencyMs: number;
  cached: boolean;
  degraded: boolean;
  timestamp: string;
  /** Platform evaluation-log id for this decision, when the API supplied one. */
  evaluationId?: string;
  /** Set when the underlying API call failed (degraded or thrown decisions). */
  error?: string;
}

/**
 * Observability extension point. Implementations must not throw — the SDK
 * swallows observer errors so telemetry can never break a product decision —
 * and should not block (do async work fire-and-forget).
 */
export interface DecisionObserver {
  onDecision(event: DecisionEvent): void;
}

/**
 * Identity extension point: resolve an external identity to a MonetizeKit
 * customer id. Return null when no mapping exists (callers decide whether to
 * create a customer or deny).
 */
export interface IdentityResolver {
  resolveCustomerId(
    externalId: string,
    context?: Record<string, unknown>,
  ): Promise<string | null>;
}
