/**
 * MonetizeKit Node.js SDK
 *
 * @example
 * ```ts
 * import { MonetizeKit } from "@monetizekit/node";
 *
 * const mk = new MonetizeKit({ apiKey: "mk_live_xxx" });
 *
 * // Check entitlement
 * const result = await mk.entitlements.check("cust_123", "api_access");
 * if (result.value) {
 *   // Feature is enabled
 * }
 *
 * // List customers
 * const customers = await mk.customers.list({ page: 1, pageSize: 10 });
 * ```
 */
import { HttpClient, type HttpClientConfig } from "./http-client";
import type {
  Customer,
  Plan,
  FeatureDefinition,
  Subscription,
  EntitlementResult,
  CreditBalance,
  PaginatedList,
} from "@monetizekit/types";

// Re-export types and errors
export * from "./errors";
export * from "./webhooks";
export type { HttpClientConfig } from "./http-client";
export type {
  Customer,
  Plan,
  FeatureDefinition,
  Subscription,
  EntitlementResult,
  CreditBalance,
  PaginatedList,
  WebhookEvent,
  WebhookEventType,
  CustomerJwtPayload,
} from "@monetizekit/types";

// ============================================================
// Resource Namespaces
// ============================================================

export interface PreflightResult {
  allowed: boolean;
  customerId: string;
  entitlement: {
    featureKey: string;
    allowed: boolean;
    effectiveValue: unknown;
    type: string;
    usage?: number;
    limit?: number;
    remaining?: number;
  } | null;
  budget: { denied: boolean; denyLimit: number | null; degraded: boolean; requiresTopup: boolean };
  credits: { balance: number; required: number; sufficient: boolean } | null;
  reasons: string[];
}

class EntitlementsResource {
  constructor(private http: HttpClient) {}

  async check(customerId: string, featureKey: string): Promise<EntitlementResult> {
    return this.http.get<EntitlementResult>(
      `/api/v1/entitlements/${customerId}/${featureKey}`,
    );
  }

  async getAll(customerId: string): Promise<EntitlementResult[]> {
    return this.http.get<EntitlementResult[]>(
      `/api/v1/entitlements/${customerId}`,
    );
  }

  /**
   * Combined pre-flight gate: resolves entitlement + budget policy + credit
   * balance in one call so an AI app can allow/degrade/top-up/deny before serving.
   */
  async preflight(params: {
    customerId: string;
    subjectId?: string;
    featureKey?: string;
    meterId?: string;
    estimatedValue?: number;
    requiredCredits?: number;
  }): Promise<PreflightResult> {
    return this.http.post<PreflightResult>("/api/v1/entitlements/preflight", params);
  }
}

class CustomersResource {
  constructor(private http: HttpClient) {}

  async list(params?: { page?: number; pageSize?: number }): Promise<PaginatedList<Customer>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    return this.http.get<PaginatedList<Customer>>(`/api/v1/customers?${qs}`);
  }

  async get(customerId: string): Promise<Customer> {
    return this.http.get<Customer>(`/api/v1/customers/${customerId}`);
  }

  async create(data: Partial<Customer>): Promise<Customer> {
    return this.http.post<Customer>("/api/v1/customers", data);
  }

  async update(customerId: string, data: Partial<Customer>): Promise<Customer> {
    return this.http.patch<Customer>(`/api/v1/customers/${customerId}`, data);
  }

  async delete(customerId: string): Promise<void> {
    await this.http.delete(`/api/v1/customers/${customerId}`);
  }
}

class SubscriptionsResource {
  constructor(private http: HttpClient) {}

  async create(data: { customerId: string; planId: string; [key: string]: unknown }): Promise<Subscription> {
    return this.http.post<Subscription>("/api/v1/subscriptions", data);
  }

  async get(subscriptionId: string): Promise<Subscription> {
    return this.http.get<Subscription>(`/api/v1/subscriptions/${subscriptionId}`);
  }

  async update(
    subscriptionId: string,
    data: { [key: string]: unknown },
  ): Promise<Subscription> {
    return this.http.patch<Subscription>(`/api/v1/subscriptions/${subscriptionId}`, data);
  }

  async cancel(subscriptionId: string): Promise<Subscription> {
    return this.http.delete<Subscription>(`/api/v1/subscriptions/${subscriptionId}`);
  }
}

class UsageResource {
  constructor(private http: HttpClient) {}

  async submit(data: {
    customerId: string;
    meterId: string;
    value: number;
    /** Optional sub-customer entity (user/agent/seat/team) this usage is attributed to. */
    subjectId?: string;
    /** Optional dimensional metadata (e.g. { model, operation }). */
    dimensions?: Record<string, string | number | boolean>;
    description?: string;
    idempotencyKey?: string;
    [key: string]: unknown;
  }): Promise<unknown> {
    return this.http.post("/api/v1/usage/events", data, data.idempotencyKey);
  }

  async get(customerId: string, meterId: string): Promise<unknown> {
    return this.http.get(`/api/v1/usage/${customerId}/${meterId}`);
  }

  /** Per-dimension usage breakdown (e.g. tokens by `model`) with per-model credit cost. */
  async breakdown(
    customerId: string,
    meterId: string,
    dimension: string,
  ): Promise<{
    meterId: string;
    dimension: string;
    window: string;
    total: number;
    totalCreditCost: number;
    breakdown: Array<{ value: string; total: number; count: number; creditCost: number }>;
  }> {
    const qs = new URLSearchParams({ dimension });
    return this.http.get(`/api/v1/usage/${customerId}/${meterId}/breakdown?${qs}`);
  }
}

export type EntityType = "user" | "agent" | "seat" | "team";

export interface Entity {
  id: string;
  customerId: string;
  type: EntityType;
  externalId: string;
  name: string;
  parentEntityId?: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Sub-customer entities (users/agents/seats/teams) under a customer. */
class EntitiesResource {
  constructor(private http: HttpClient) {}

  async list(customerId: string): Promise<Entity[]> {
    return this.http.get<Entity[]>(`/api/v1/customers/${customerId}/entities`);
  }

  async get(customerId: string, entityId: string): Promise<Entity> {
    return this.http.get<Entity>(`/api/v1/customers/${customerId}/entities/${entityId}`);
  }

  async create(
    customerId: string,
    data: {
      type: EntityType;
      externalId: string;
      name?: string;
      parentEntityId?: string | null;
      attributes?: Record<string, unknown>;
    },
  ): Promise<Entity> {
    return this.http.post<Entity>(`/api/v1/customers/${customerId}/entities`, data);
  }

  async update(
    customerId: string,
    entityId: string,
    data: { name?: string; parentEntityId?: string | null; attributes?: Record<string, unknown> },
  ): Promise<Entity> {
    return this.http.patch<Entity>(`/api/v1/customers/${customerId}/entities/${entityId}`, data);
  }

  async delete(customerId: string, entityId: string): Promise<{ id: string; deleted: boolean }> {
    return this.http.delete<{ id: string; deleted: boolean }>(
      `/api/v1/customers/${customerId}/entities/${entityId}`,
    );
  }
}

class CreditsResource {
  constructor(private http: HttpClient) {}

  async getBalance(customerId: string): Promise<CreditBalance> {
    return this.http.get<CreditBalance>(`/api/v1/credits/${customerId}`);
  }

  async grant(data: { customerId: string; amount: number; reason?: string; [key: string]: unknown }): Promise<unknown> {
    return this.http.post("/api/v1/credits/grant", data);
  }

  async debit(data: {
    customerId: string;
    amount: number;
    reason?: string;
    /** Source wallet (defaults to "default"). */
    walletKey?: string;
    /** Dimensional attribution recorded on the debit ledger entry (e.g. { model, feature }). */
    dimensions?: Record<string, string | number | boolean>;
    [key: string]: unknown;
  }): Promise<unknown> {
    return this.http.post("/api/v1/credits/debit", data);
  }

  /** Charge the wallet's credit pack off-session and grant its credits. */
  async topup(data: {
    customerId: string;
    walletKey?: string;
    packId?: string;
  }): Promise<{ status: string; paymentIntentId: string | null; granted: number; walletKey: string }> {
    return this.http.post("/api/v1/credits/topup", data);
  }

  /** Configure (or disable) a wallet's auto top-up policy. */
  async configureAutoTopup(data: {
    customerId: string;
    walletKey?: string;
    enabled: boolean;
    threshold: number;
    packId: string;
  }): Promise<unknown> {
    return this.http.request("PUT", "/api/v1/credits/auto-topup", data);
  }
}

class PlansResource {
  constructor(private http: HttpClient) {}

  async list(params?: { page?: number; pageSize?: number }): Promise<PaginatedList<Plan>> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    return this.http.get<PaginatedList<Plan>>(`/api/v1/plans?${qs}`);
  }

  async get(planId: string): Promise<Plan> {
    return this.http.get<Plan>(`/api/v1/plans/${planId}`);
  }
}

class FeaturesResource {
  constructor(private http: HttpClient) {}

  async list(): Promise<PaginatedList<FeatureDefinition>> {
    return this.http.get<PaginatedList<FeatureDefinition>>("/api/v1/features");
  }

  async get(featureKey: string): Promise<FeatureDefinition> {
    return this.http.get<FeatureDefinition>(`/api/v1/features/${featureKey}`);
  }
}

export interface ExperimentVariantInput {
  name: string;
  allocation: number;
  description?: string;
  color?: string;
  isControl?: boolean;
  planId?: string;
  priceOverride?: number;
  pricingOverride?: unknown[];
  copyOverride?: string;
}

export interface CreateExperimentInput {
  name: string;
  type: "plan_variant" | "pricing_variant" | "paywall_copy";
  audienceSegment: string;
  primaryMetric: string;
  description?: string;
  hypothesis?: string;
  secondaryMetrics?: string[];
  environment?: string;
  approach?: "frequentist" | "bayesian";
  significanceLevel?: number;
  direction?: "one_sided" | "two_sided";
  tags?: string[];
  maintainer?: string;
  variants: ExperimentVariantInput[];
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  audienceSegment: string;
  primaryMetric: string;
  secondaryMetrics: string[];
  variants: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
  approach: string;
  significanceLevel: number;
  direction: string;
  currentIteration?: number;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ExperimentAssignmentResult {
  experimentId: string;
  experimentType: string;
  variantId: string;
  variantName: string;
  isControl: boolean;
  bucket: number;
  assigned: boolean;
  planId?: string;
  pricing?: unknown[];
  copyOverride?: string;
  exposedAt: string | null;
  exposureCount: number;
  convertedAt: string | null;
}

export interface ConversionResult {
  converted: number;
}

/**
 * Experiments: create/manage pricing, plan, and paywall A/B tests; resolve a
 * customer's sticky variant assignment (recording an exposure) and record
 * conversions; drive the lifecycle and on-demand evaluation.
 */
class ExperimentsResource {
  constructor(private http: HttpClient) {}

  async list(): Promise<Experiment[]> {
    return this.http.get<Experiment[]>("/api/v1/experiments");
  }

  async get(experimentId: string): Promise<Experiment> {
    return this.http.get<Experiment>(`/api/v1/experiments/${experimentId}`);
  }

  async create(data: CreateExperimentInput): Promise<Experiment> {
    return this.http.post<Experiment>("/api/v1/experiments", data);
  }

  async start(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/start`, {});
  }

  async pause(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/pause`, {});
  }

  async resume(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/resume`, {});
  }

  async stop(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/stop`, {});
  }

  async archive(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/archive`, {});
  }

  async evaluate(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/evaluate`, {});
  }

  async iterate(experimentId: string): Promise<Experiment> {
    return this.http.post<Experiment>(`/api/v1/experiments/${experimentId}/iterate`, {});
  }

  async ship(experimentId: string, variantId?: string): Promise<Experiment> {
    return this.http.post<Experiment>(
      `/api/v1/experiments/${experimentId}/ship`,
      variantId ? { variantId } : {},
    );
  }

  /** Resolve the customer's sticky variant and (by default) record an exposure. */
  async assign(
    experimentId: string,
    customerId: string,
    options?: { record?: boolean },
  ): Promise<ExperimentAssignmentResult> {
    return this.http.post<ExperimentAssignmentResult>(
      `/api/v1/experiments/${experimentId}/assignments`,
      { customerId, ...(options?.record !== undefined ? { record: options.record } : {}) },
    );
  }

  /** Record a conversion for the customer's assignment on this experiment. */
  async recordConversion(
    experimentId: string,
    customerId: string,
    value?: number,
  ): Promise<ConversionResult> {
    return this.http.post<ConversionResult>(
      `/api/v1/experiments/${experimentId}/conversions`,
      { customerId, ...(value !== undefined ? { value } : {}) },
    );
  }
}

// ============================================================
// Main Client
// ============================================================

export class MonetizeKit {
  public readonly entitlements: EntitlementsResource;
  public readonly customers: CustomersResource;
  public readonly subscriptions: SubscriptionsResource;
  public readonly usage: UsageResource;
  public readonly credits: CreditsResource;
  public readonly plans: PlansResource;
  public readonly features: FeaturesResource;
  public readonly experiments: ExperimentsResource;
  public readonly entities: EntitiesResource;

  private readonly http: HttpClient;

  constructor(config: HttpClientConfig) {
    this.http = new HttpClient(config);
    this.entitlements = new EntitlementsResource(this.http);
    this.customers = new CustomersResource(this.http);
    this.subscriptions = new SubscriptionsResource(this.http);
    this.usage = new UsageResource(this.http);
    this.credits = new CreditsResource(this.http);
    this.plans = new PlansResource(this.http);
    this.features = new FeaturesResource(this.http);
    this.experiments = new ExperimentsResource(this.http);
    this.entities = new EntitiesResource(this.http);
  }
}
