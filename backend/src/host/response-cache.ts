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
 *
 * Entries are additionally bounded by bytes: one browser tab's projection can
 * be several MB on a large owner, and 64 of those would pin the single host
 * thread's heap. A value above `POLL_CACHE_MAX_VALUE_BYTES` is still served,
 * it is just never retained; retained bytes are capped by
 * `POLL_CACHE_MAX_TOTAL_BYTES`, evicting the oldest entries first.
 */

export const POLL_CACHE_TTL_MS = 4000;
export const POLL_CACHE_MAX_ENTRIES = 64;
/** Per-value ceiling: bigger projections are served but not kept. */
export const POLL_CACHE_MAX_VALUE_BYTES = 512 * 1024;
/** Total retained payload bytes across every entry. */
export const POLL_CACHE_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

type Entry = { at: number; epoch: string; value: unknown; bytes: number };

const store = new Map<string, Entry>();

let hits = 0;
let misses = 0;
let retainedBytes = 0;
let skippedOversize = 0;
let evictions = 0;

/** Serialized size of a projection, i.e. what holding it costs the host. */
function entryBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value ?? null);
    return json ? Buffer.byteLength(json, "utf8") : 0;
  } catch {
    // A value that cannot even be stringified must not be retained.
    return Number.POSITIVE_INFINITY;
  }
}

function drop(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  retainedBytes -= entry.bytes;
  store.delete(key);
}

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
  const bytes = entryBytes(value);
  drop(key);
  misses += 1;
  if (bytes > POLL_CACHE_MAX_VALUE_BYTES) {
    skippedOversize += 1;
    return value;
  }
  store.set(key, { at: now, epoch, value, bytes });
  retainedBytes += bytes;
  while (store.size > POLL_CACHE_MAX_ENTRIES || retainedBytes > POLL_CACHE_MAX_TOTAL_BYTES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    drop(oldest.value);
    evictions += 1;
  }
  return value;
}

/** Drop every entry whose key starts with `prefix` (all of them when omitted). */
export function invalidatePollCache(prefix?: string): void {
  for (const key of [...store.keys()]) {
    if (!prefix || key.startsWith(prefix)) drop(key);
  }
}

export function resetPollCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
  retainedBytes = 0;
  skippedOversize = 0;
  evictions = 0;
}

export function pollCacheCounters(): {
  hits: number;
  misses: number;
  size: number;
  bytes: number;
  skipped: number;
  evictions: number;
} {
  return { hits, misses, size: store.size, bytes: retainedBytes, skipped: skippedOversize, evictions };
}
