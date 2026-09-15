/**
 * OpenTelemetry exporter (`@monetizekit/node/otel`, FRD-PO-004): span and
 * metric mapping, status discipline, the emitted-name stability snapshot,
 * the no-op path when no provider is registered, and exporter-failure
 * isolation (a broken exporter can never break a check).
 *
 * Uses the real OTel SDK with in-memory exporters — the same objects a host
 * application would register — so the assertions cover actual emitted
 * telemetry, not our own mocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context, metrics as metricsApi, trace as traceApi, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { MonetizeKit, type DecisionEvent } from "../src/index";
import {
  OTEL_ATTRIBUTES,
  OTEL_METRICS,
  OTEL_SCOPE_NAME,
  OTEL_SPAN_NAMES,
  instrumentMonetizeKit,
} from "../src/otel";

const API_KEY = "mk_test_key";
const BASE_URL = "https://api.test";

function decisionEvent(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    kind: "entitlement_check",
    customerId: "cust_1",
    featureKey: "sso",
    allowed: true,
    reasonCode: "granted",
    latencyMs: 5,
    cached: false,
    degraded: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("emitted-name stability gate", () => {
  it("span, attribute, and metric names match the Phase 0 naming contract", () => {
    // Changing any of these is a breaking-telemetry change: dashboards and
    // alerts in customer monitoring tools reference them by name.
    expect(OTEL_SCOPE_NAME).toBe("@monetizekit/node/otel");
    expect(OTEL_SPAN_NAMES).toMatchInlineSnapshot(`
      {
        "batch_check": "monetizekit.batch_check",
        "entitlement_check": "monetizekit.entitlement_check",
      }
    `);
    expect(OTEL_ATTRIBUTES).toMatchInlineSnapshot(`
      {
        "cacheHit": "monetizekit.cache_hit",
        "customerId": "monetizekit.customer_id",
        "decision": "monetizekit.decision",
        "degraded": "monetizekit.degraded",
        "error": "monetizekit.error",
        "evaluationId": "monetizekit.evaluation_id",
        "featureKey": "monetizekit.feature_key",
        "inspectorUrl": "monetizekit.inspector_url",
        "reasonCode": "monetizekit.reason_code",
      }
    `);
    expect(OTEL_METRICS).toMatchInlineSnapshot(`
      {
        "checkDuration": "monetizekit.check.duration",
        "checks": "monetizekit.checks",
        "degradedChecks": "monetizekit.degraded_checks",
      }
    `);
  });
});

describe("no-op path (no provider registered)", () => {
  it("emits nothing and throws nothing when the host has no OTel SDK", () => {
    traceApi.disable();
    metricsApi.disable();
    const observer = instrumentMonetizeKit();
    expect(() => observer.onDecision(decisionEvent())).not.toThrow();
  });
});

describe("span mapping", () => {
  let spanExporter: InMemorySpanExporter;
  let tracerProvider: BasicTracerProvider;

  beforeEach(() => {
    traceApi.disable();
    metricsApi.disable();
    spanExporter = new InMemorySpanExporter();
    tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    traceApi.setGlobalTracerProvider(tracerProvider);
  });

  afterEach(() => {
    traceApi.disable();
  });

  function emittedSpans(): ReadableSpan[] {
    return spanExporter.getFinishedSpans();
  }

  it("maps an allowed decision to an OK span with the contract attributes", () => {
    const observer = instrumentMonetizeKit({ metrics: false });
    observer.onDecision(decisionEvent({ evaluationId: "eval_123" }));

    const spans = emittedSpans();
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("monetizekit.entitlement_check");
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes[OTEL_ATTRIBUTES.customerId]).toBe("cust_1");
    expect(span.attributes[OTEL_ATTRIBUTES.featureKey]).toBe("sso");
    expect(span.attributes[OTEL_ATTRIBUTES.decision]).toBe("allowed");
    expect(span.attributes[OTEL_ATTRIBUTES.reasonCode]).toBe("granted");
    expect(span.attributes[OTEL_ATTRIBUTES.cacheHit]).toBe(false);
    expect(span.attributes[OTEL_ATTRIBUTES.degraded]).toBe(false);
    expect(span.attributes[OTEL_ATTRIBUTES.evaluationId]).toBe("eval_123");
    expect(span.attributes[OTEL_ATTRIBUTES.inspectorUrl]).toBe(
      "https://app.monetizekit.app/observability/inspector/eval_123",
    );
  });

  it("status discipline: a denial is OK with decision=denied, never ERROR", () => {
    const observer = instrumentMonetizeKit({ metrics: false });
    observer.onDecision(
      decisionEvent({ allowed: false, reasonCode: "limit_reached" }),
    );

    const [span] = emittedSpans();
    expect(span.status.code).toBe(SpanStatusCode.OK);
    expect(span.attributes[OTEL_ATTRIBUTES.decision]).toBe("denied");
    expect(span.attributes[OTEL_ATTRIBUTES.reasonCode]).toBe("limit_reached");
  });

  it("status discipline: a transport failure is ERROR and carries the degraded flag", () => {
    const observer = instrumentMonetizeKit({ metrics: false });
    observer.onDecision(
      decisionEvent({
        allowed: true,
        reasonCode: "sdk_fail_open",
        degraded: true,
        error: "Request timeout after 30000ms",
      }),
    );

    const [span] = emittedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("Request timeout after 30000ms");
    expect(span.attributes[OTEL_ATTRIBUTES.degraded]).toBe(true);
    expect(span.attributes[OTEL_ATTRIBUTES.error]).toBe("Request timeout after 30000ms");
  });

  it("cache-served decisions emit spans flagged cache_hit=true (R1.3)", () => {
    const observer = instrumentMonetizeKit({ metrics: false });
    observer.onDecision(decisionEvent({ cached: true, evaluationId: "eval_orig" }));

    const [span] = emittedSpans();
    expect(span.attributes[OTEL_ATTRIBUTES.cacheHit]).toBe(true);
    // Cache hits keep the original evaluation's id, so the deep link still works.
    expect(span.attributes[OTEL_ATTRIBUTES.evaluationId]).toBe("eval_orig");
  });

  it("inspector_url honors a custom dashboard origin and can be disabled with null", () => {
    const custom = instrumentMonetizeKit({
      metrics: false,
      inspectorBaseUrl: "https://mk.example.com/",
    });
    custom.onDecision(decisionEvent({ evaluationId: "eval_a" }));

    const disabled = instrumentMonetizeKit({ metrics: false, inspectorBaseUrl: null });
    disabled.onDecision(decisionEvent({ evaluationId: "eval_b" }));

    const spans = emittedSpans();
    expect(spans[0].attributes[OTEL_ATTRIBUTES.inspectorUrl]).toBe(
      "https://mk.example.com/observability/inspector/eval_a",
    );
    expect(spans[1].attributes[OTEL_ATTRIBUTES.inspectorUrl]).toBeUndefined();
    expect(spans[1].attributes[OTEL_ATTRIBUTES.evaluationId]).toBe("eval_b");
  });

  it("nests the decision span inside the caller's active trace (R1.1)", async () => {
    // A real host app registers a context manager (NodeSDK does this for
    // you); the API's default context manager is a no-op, so register one
    // here to exercise actual parent propagation.
    const contextManager = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(contextManager.enable());

    const observer = instrumentMonetizeKit({ metrics: false });
    const tracer = tracerProvider.getTracer("host-app");

    const parent = tracer.startSpan("handle_request");
    context.with(traceApi.setSpan(context.active(), parent), () => {
      observer.onDecision(decisionEvent());
    });
    parent.end();
    context.disable();

    const spans = emittedSpans();
    const decisionSpan = spans.find((s) => s.name === "monetizekit.entitlement_check");
    const parentSpan = spans.find((s) => s.name === "handle_request");
    expect(decisionSpan?.parentSpanContext?.spanId).toBe(
      parentSpan?.spanContext().spanId,
    );
    expect(decisionSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId);
  });

  it("traces can be disabled independently of metrics (R5.3)", () => {
    const observer = instrumentMonetizeKit({ traces: false, metrics: false });
    observer.onDecision(decisionEvent());
    expect(emittedSpans()).toHaveLength(0);
  });
});

describe("metric mapping", () => {
  let metricExporter: InMemoryMetricExporter;
  let meterProvider: MeterProvider;

  beforeEach(() => {
    traceApi.disable();
    metricsApi.disable();
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    meterProvider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metricsApi.setGlobalMeterProvider(meterProvider);
  });

  afterEach(async () => {
    await meterProvider.shutdown();
    metricsApi.disable();
  });

  async function collectedMetrics() {
    await meterProvider.forceFlush();
    const resourceMetrics = metricExporter.getMetrics();
    return resourceMetrics.flatMap((rm) =>
      rm.scopeMetrics.flatMap((sm) => sm.metrics),
    );
  }

  it("records duration, decision count, and degraded count with bounded attributes", async () => {
    const observer = instrumentMonetizeKit({ traces: false });
    observer.onDecision(decisionEvent({ latencyMs: 12, evaluationId: "eval_1" }));
    observer.onDecision(
      decisionEvent({
        allowed: false,
        reasonCode: "sdk_fail_closed",
        degraded: true,
        error: "boom",
        latencyMs: 3,
      }),
    );

    const metrics = await collectedMetrics();
    const byName = new Map(metrics.map((m) => [m.descriptor.name, m]));

    const duration = byName.get(OTEL_METRICS.checkDuration);
    expect(duration?.descriptor.unit).toBe("ms");
    expect(duration?.dataPoints.length).toBeGreaterThan(0);

    const checks = byName.get(OTEL_METRICS.checks);
    const totalChecks = checks?.dataPoints.reduce(
      (sum, dp) => sum + Number(dp.value),
      0,
    );
    expect(totalChecks).toBe(2);

    const degraded = byName.get(OTEL_METRICS.degradedChecks);
    const totalDegraded = degraded?.dataPoints.reduce(
      (sum, dp) => sum + Number(dp.value),
      0,
    );
    expect(totalDegraded).toBe(1);

    // Cardinality guard (R5.1) and forbidden-field guard (R6.3): metric
    // attributes never carry customer ids, evaluation ids, balances, or
    // amounts — only the bounded decision dimensions.
    const allowedAttributeKeys = new Set([
      OTEL_ATTRIBUTES.featureKey,
      OTEL_ATTRIBUTES.decision,
      OTEL_ATTRIBUTES.cacheHit,
      OTEL_ATTRIBUTES.degraded,
    ]);
    for (const metric of metrics) {
      for (const dataPoint of metric.dataPoints) {
        for (const key of Object.keys(dataPoint.attributes)) {
          expect(allowedAttributeKeys.has(key)).toBe(true);
        }
      }
    }
  });

  it("metrics can be disabled independently of traces (R5.3)", async () => {
    const observer = instrumentMonetizeKit({ traces: false, metrics: false });
    observer.onDecision(decisionEvent());
    const metrics = await collectedMetrics();
    expect(metrics).toHaveLength(0);
  });
});

describe("isolation: a broken exporter never breaks a check (R7.2)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    traceApi.disable();
    metricsApi.disable();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    traceApi.disable();
  });

  it("check() resolves correctly even when the span pipeline throws", async () => {
    // Sabotage: a span processor that throws on every span lifecycle hook.
    const sabotagedProvider = new BasicTracerProvider({
      spanProcessors: [
        {
          onStart() {
            throw new Error("sabotaged onStart");
          },
          onEnd() {
            throw new Error("sabotaged onEnd");
          },
          forceFlush: () => Promise.resolve(),
          shutdown: () => Promise.resolve(),
        },
      ],
    });
    traceApi.setGlobalTracerProvider(sabotagedProvider);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
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
        evaluationId: "eval_ok",
      }),
    );

    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      observers: [instrumentMonetizeKit()],
    });

    const decision = await mk.entitlements.check("cust_1", "sso");
    expect(decision.allowed).toBe(true);
    expect(decision.evaluationId).toBe("eval_ok");
  });
});

describe("SDK decision event carries evaluationId end-to-end", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("observer events include the evaluationId returned by the API", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        customerId: "cust_1",
        featureKey: "sso",
        allowed: false,
        effectiveValue: false,
        type: "boolean",
        sources: [],
        reason: "Feature not granted",
        reasonCode: "not_in_plan",
        planName: "Free",
        planVersion: 1,
        latencyMs: 4,
        evaluationId: "eval_evt",
      }),
    );

    const events: DecisionEvent[] = [];
    const mk = new MonetizeKit({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      observers: [{ onDecision: (event) => events.push(event) }],
    });

    await mk.entitlements.check("cust_1", "sso");
    expect(events).toHaveLength(1);
    expect(events[0].evaluationId).toBe("eval_evt");
  });
});
