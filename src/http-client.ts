/**
 * HTTP client — Task 2.6
 * Fetch wrapper with retry, error mapping, and request ID.
 */
import { randomUUID } from "node:crypto";
import type { ApiErrorResponse } from "@monetizekit/types";
import { mapApiError } from "./error-mapper";
import { ConfigurationError } from "./errors";

export interface HttpClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: HttpClientConfig) {
    if (!config.apiKey) {
      throw new ConfigurationError("API key is required. Pass it as `apiKey` in the constructor.");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://app.monetizekit.app").replace(/\/+$/, "");
    this.timeout = config.timeout ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestId = randomUUID();

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      "User-Agent": "@monetizekit/node/0.1.0",
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Rate limited — retry with backoff
        if (response.status === 429 && attempt < this.maxRetries) {
          const retryAfter = parseInt(response.headers.get("Retry-After") ?? "1", 10);
          await this.sleep(retryAfter * 1000 + this.jitter());
          continue;
        }

        // Server error — retry with backoff
        if (response.status >= 500 && attempt < this.maxRetries) {
          await this.sleep(Math.pow(2, attempt) * 1000 + this.jitter());
          continue;
        }

        // Client error — don't retry, throw typed error
        const errorBody = (await response.json()) as ApiErrorResponse;
        throw mapApiError(response.status, errorBody, requestId);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${this.timeout}ms`);
          if (attempt < this.maxRetries) {
            await this.sleep(Math.pow(2, attempt) * 1000 + this.jitter());
            continue;
          }
        }
        throw error;
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>("POST", path, body, idempotencyKey);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private jitter(): number {
    return Math.floor(Math.random() * 500);
  }
}
