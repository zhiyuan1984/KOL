import { onConnReset } from "../db.js";

/**
 * Short-lived in-process cache for the high-frequency polling endpoints
 * (`GET /api/sessions`, `GET /api/tasks`). Those endpoints are read-only
 * projections: several browser tabs poll them every few seconds, and the
 * projection is far more expensive than the poll interval.
 *
 * Two independent guards keep the answer honest:
 *  - a caller-supplied `epoch` string (cheap fingerprint of the rows the
 *    endpoint reads, e.g. MAX(rowid)/MAX(updated_at)); any write that moves
 *    the fingerprint drops the entry immediately, regardless of TTL;
 *  - a TTL backstop (default 4s) that also covers state no SQL fingerprint
 *    sees, such as the in-memory run-control sets behind `agent_status`.
 *
 * Keep the counters: they are how tests prove reuse without reaching into
 * the store.
 */

export const POLL_CACHE_TTL_MS = 4000;
export const POLL_CACHE_MAX_ENTRIES = 64;

type Entry = { at: number; epoch: string; value: unknown };

const store = new Map<string, Entry>();

let hits = 0;
let misses = 0;

onConnReset(() => {
  resetPollCache();
});

/** Fingerprint parts joined into one epoch token. */
export function pollEpoch(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? "")).join("\u0001");
}

export function pollCacheTtlMs(): number {
  const raw = Number(process.env.LINGONG_POLL_CACHE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : POLL_CACHE_TTL_MS;
}

/**
 * Return the cached projection for `key` while `epoch` is unchanged and the
 * TTL has not elapsed; otherwise recompute it. `key` must include the owner
 * and every query parameter that changes the payload.
 */
export function cachedPoll<T>(key: string, epoch: string, produce: () => T): T {
  const ttl = pollCacheTtlMs();
  const found = store.get(key);
  const now = Date.now();
  if (found && found.epoch === epoch && now - found.at < ttl) {
    hits += 1;
    // Refresh insertion order so the LRU trim drops genuinely cold keys.
    store.delete(key);
    store.set(key, found);
    return found.value as T;
  }
  const value = produce();
  store.delete(key);
  store.set(key, { at: now, epoch, value });
  while (store.size > POLL_CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  misses += 1;
  return value;
}

/** Drop every entry whose key starts with `prefix` (all of them when omitted). */
export function invalidatePollCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function resetPollCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
}

export function pollCacheCounters(): { hits: number; misses: number; size: number } {
  return { hits, misses, size: store.size };
}
