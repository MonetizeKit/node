/**
 * Small in-process TTL cache for entitlement decisions. Expired entries are
 * kept (until capacity eviction) so degradation modes can serve a stale
 * decision when the API is unreachable — stale-but-real beats synthesized.
 */

export interface DecisionCacheConfig {
  ttlMs?: number;
  maxEntries?: number;
}

export const DEFAULT_CACHE_TTL_MS = 30_000;
export const DEFAULT_CACHE_MAX_ENTRIES = 10_000;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export class DecisionCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(config?: DecisionCacheConfig) {
    this.ttlMs = config?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxEntries = config?.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  }

  /** A fresh (unexpired) value, or undefined. */
  getFresh(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Inclusive expiry so ttlMs: 0 means "never serve as fresh".
    if (now - entry.storedAt >= this.ttlMs) return undefined;
    return entry.value;
  }

  /** Any stored value, even expired — for degradation fallbacks. */
  getStale(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    // Refresh insertion order so eviction drops the least-recently-written.
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: now });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
