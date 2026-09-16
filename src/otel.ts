/**
 * OpenTelemetry exporter for MonetizeKit entitlement decisions (FRD-PO-004).
 *
 * Implements the SDK's {@link DecisionObserver} extension point on top of the
 * host application's existing OpenTelemetry setup. This module registers
 * instrumentation only — it never installs a provider, collector, or exporter
 * of its own. When no OTel SDK is registered, the `@opentelemetry/api`
 * globals no-op, so an unused integration costs (almost) nothing and prints
 * no warnings.
 *
 * `@opentelemetry/api` is an optional peer dependency: it is only loaded when
 * you import from `@monetizekit/node/otel`.
 *
 * @example
 * ```ts
 * import { MonetizeKit } from "@monetizekit/node";
 * import { instrumentMonetizeKit } from "@monetizekit/node/otel";
 *
 * const mk = new MonetizeKit({
 *   apiKey: process.env.MONETIZEKIT_API_KEY,
 *   observers: [instrumentMonetizeKit()],
 * });
 * ```
 */
import {
  SpanKind,
  SpanStatusCode,
  ValueType,
  metrics as metricsApi,
  trace as traceApi,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type Tracer,
} from "@opentelemetry/api";
import type { DecisionEvent, DecisionObserver } from "./decision";

/**
 * Instrumentation scope name reported to the host's tracer/meter provider.
 */
export const OTEL_SCOPE_NAME = "@monetizekit/node/otel";

/**
 * Emitted span names, one per {@link DecisionEvent} kind. Names are public
 * API (Phase 0 naming contract): renames are breaking changes gated by the
 * `breaking-telemetry` label and ship with a migration note.
 */
export const OTEL_SPAN_NAMES = {
  entitlement_check: "monetizekit.entitlement_check",
  batch_check: "monetizekit.batch_check",
} as const;

/**
 * Emitted span attribute names (Phase 0 naming contract — stable public API).
 * `monetizekit.reason_code` carries the machine-readable reason; the
 * human-readable `reason` sentence is deliberately not exported (it is not
 * stable and would bloat every span).
 */
export const OTEL_ATTRIBUTES = {
  customerId: "monetizekit.customer_id",
  featureKey: "monetizekit.feature_key",
  decision: "monetizekit.decision",
  reasonCode: "monetizekit.reason_code",
  cacheHit: "monetizekit.cache_hit",
  degraded: "monetizekit.degraded",
  evaluationId: "monetizekit.evaluation_id",
  inspectorUrl: "monetizekit.inspector_url",
  error: "monetizekit.error",
} as const;

/**
 * Emitted metric instrument names (Phase 0 naming contract — stable public
 * API). Metric attributes are bounded by design: they carry decision,
 * cache-hit, degraded, and feature-key dimensions but never customer or
 * evaluation ids, so cardinality cannot grow with account count (R5.1).
 */
export const OTEL_METRICS = {
  /** Histogram of end-to-end check duration, in milliseconds. */
  checkDuration: "monetizekit.check.duration",
  /** Counter of decisions, dimensioned by outcome and cache provenance. */
  checks: "monetizekit.checks",
  /** Counter of degraded (API-unreachable fallback) decisions — alert on this. */
  degradedChecks: "monetizekit.degraded_checks",
} as const;

export interface InstrumentMonetizeKitOptions {
  /**
   * Emit decision spans into the host's active trace context. Default true.
   */
  traces?: boolean;
  /**
   * Emit bounded-cardinality decision metrics. Default true. Traces and
   * metrics are independently enableable (R5.3).
   */
  metrics?: boolean;
  /**
   * Dashboard origin used to render `monetizekit.inspector_url` deep links
   * (`{inspectorBaseUrl}/observability/inspector/{evaluationId}`). Defaults
   * to the hosted dashboard. Set to your dashboard origin when self-hosting;
   * set to null to omit the attribute entirely.
   */
  inspectorBaseUrl?: string | null;
}

const DEFAULT_INSPECTOR_BASE_URL = "https://app.monetizekit.app";

function spanAttributes(event: DecisionEvent, inspectorBaseUrl: string | null): Attributes {
  const attributes: Attributes = {
    [OTEL_ATTRIBUTES.customerId]: event.customerId,
    [OTEL_ATTRIBUTES.cacheHit]: event.cached,
    [OTEL_ATTRIBUTES.degraded]: event.degraded,
  };
  if (event.featureKey !== undefined) {
    attributes[OTEL_ATTRIBUTES.featureKey] = event.featureKey;
  }
  if (event.allowed !== undefined) {
    attributes[OTEL_ATTRIBUTES.decision] = event.allowed ? "allowed" : "denied";
  }
  if (event.reasonCode !== undefined) {
    attributes[OTEL_ATTRIBUTES.reasonCode] = event.reasonCode;
  }
  if (event.evaluationId !== undefined) {
    attributes[OTEL_ATTRIBUTES.evaluationId] = event.evaluationId;
    if (inspectorBaseUrl) {
      attributes[OTEL_ATTRIBUTES.inspectorUrl] =
        `${inspectorBaseUrl}/observability/inspector/${event.evaluationId}`;
    }
  }
  if (event.error !== undefined) {
    attributes[OTEL_ATTRIBUTES.error] = event.error;
  }
  return attributes;
}

/** Bounded metric attributes — never customer or evaluation ids (R5.1). */
function metricAttributes(event: DecisionEvent): Attributes {
  const attributes: Attributes = {
    [OTEL_ATTRIBUTES.cacheHit]: event.cached,
    [OTEL_ATTRIBUTES.degraded]: event.degraded,
  };
  if (event.featureKey !== undefined) {
    attributes[OTEL_ATTRIBUTES.featureKey] = event.featureKey;
  }
  if (event.allowed !== undefined) {
    attributes[OTEL_ATTRIBUTES.decision] = event.allowed ? "allowed" : "denied";
  }
  return attributes;
}

class OtelDecisionObserver implements DecisionObserver {
  private readonly tracer: Tracer | null;
  private readonly meter: Meter | null;
  private readonly checkDuration: Histogram | null;
  private readonly checks: Counter | null;
  private readonly degradedChecks: Counter | null;
  private readonly inspectorBaseUrl: string | null;

  constructor(options: InstrumentMonetizeKitOptions) {
    // The @opentelemetry/api globals return no-op implementations when the
    // host has not registered a provider, so both paths are free-when-unused
    // (R7.1) — no warnings, no work beyond attribute construction.
    this.tracer = (options.traces ?? true) ? traceApi.getTracer(OTEL_SCOPE_NAME) : null;
    this.meter = (options.metrics ?? true) ? metricsApi.getMeter(OTEL_SCOPE_NAME) : null;
    this.checkDuration = this.meter
      ? this.meter.createHistogram(OTEL_METRICS.checkDuration, {
          description: "End-to-end MonetizeKit entitlement check duration",
          unit: "ms",
          valueType: ValueType.DOUBLE,
        })
      : null;
    this.checks = this.meter
      ? this.meter.createCounter(OTEL_METRICS.checks, {
          description: "MonetizeKit entitlement decisions",
          valueType: ValueType.INT,
        })
      : null;
    this.degradedChecks = this.meter
      ? this.meter.createCounter(OTEL_METRICS.degradedChecks, {
          description:
            "MonetizeKit decisions served by the SDK degradation fallback (API unreachable)",
          valueType: ValueType.INT,
        })
      : null;
    this.inspectorBaseUrl =
      options.inspectorBaseUrl === null
        ? null
        : (options.inspectorBaseUrl ?? DEFAULT_INSPECTOR_BASE_URL).replace(/\/+$/, "");
  }

  onDecision(event: DecisionEvent): void {
    // Isolation (R7.2): a broken exporter must never affect a decision. The
    // SDK already swallows observer errors, but we also guard here so a
    // partial failure (e.g. spans work, metrics throw) cannot half-emit.
    try {
      this.emitSpan(event);
    } catch {
      // Telemetry must never break a product decision.
    }
    try {
      this.emitMetrics(event);
    } catch {
      // Telemetry must never break a product decision.
    }
  }

  private emitSpan(event: DecisionEvent): void {
    if (!this.tracer) return;
    const endTime = Date.now();
    // Reconstruct the decision window so the span nests where the check
    // actually ran inside the caller's active trace (R1.1). Cache-served
    // decisions are real spans too, flagged cache_hit=true (R1.3).
    const span = this.tracer.startSpan(OTEL_SPAN_NAMES[event.kind], {
      kind: SpanKind.INTERNAL,
      startTime: endTime - Math.max(0, event.latencyMs),
      attributes: spanAttributes(event, this.inspectorBaseUrl),
    });
    // Status discipline (R2.x): a denial is a correct answer, never an error.
    // Only transport failures (event.error) mark the span as ERROR.
    if (event.error !== undefined) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: event.error });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end(endTime);
  }

  private emitMetrics(event: DecisionEvent): void {
    const attributes = metricAttributes(event);
    this.checkDuration?.record(Math.max(0, event.latencyMs), attributes);
    this.checks?.add(1, attributes);
    if (event.degraded) {
      this.degradedChecks?.add(1, attributes);
    }
  }
}

/**
 * One-line enable: returns a {@link DecisionObserver} that maps every SDK
 * decision onto the host application's OpenTelemetry tracer and meter.
 *
 * Pass it in the MonetizeKit constructor's `observers` array. Sampling is
 * parent-based and never overridden (R5.4): if the caller's trace is
 * unsampled, the decision span is too.
 */
export function instrumentMonetizeKit(
  options: InstrumentMonetizeKitOptions = {},
): DecisionObserver {
  return new OtelDecisionObserver(options);
}
