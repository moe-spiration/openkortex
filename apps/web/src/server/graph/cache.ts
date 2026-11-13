/*
 * Small in-process cache for graph results. A key carries the vault fingerprint (item count +
 * newest updated_at), so any edit, capture or delete changes the key and the next request
 * recomputes; the TTL only bounds how long a stale fingerprint-less entry could live. The cache is
 * per server process: a restart (or a second instance) just recomputes once.
 */

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<V>(max = 24, ttlMs = 10 * 60_000, now: () => number = Date.now): TtlCache<V> {
  const map = new Map<string, { at: number; value: V }>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      // Refresh recency (Map keeps insertion order).
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { at: now(), value });
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}

/** `count:newest-updated-at` of a user's vault; changes whenever an item is added, edited or removed. */
export const fingerprint = (count: number | null, newest: string | null): string => `${count ?? 0}:${newest ?? "-"}`;
