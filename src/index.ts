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
    description?: string;
    idempotencyKey?: string;
    [key: string]: unknown;
  }): Promise<unknown> {
    return this.http.post("/api/v1/usage/events", data, data.idempotencyKey);
  }

  async get(customerId: string, meterId: string): Promise<unknown> {
    return this.http.get(`/api/v1/usage/${customerId}/${meterId}`);
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

  async debit(data: { customerId: string; amount: number; reason?: string; [key: string]: unknown }): Promise<unknown> {
    return this.http.post("/api/v1/credits/debit", data);
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
  }
}
