/** Incremental memory merge. Unchanged keys keep the previous payload. */

export type MemoryFamily = "task" | "summary";
export type MemoryLayer = "raw" | "display";

export type MemoryIncrement = {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
};

export type MemoryItem<T = Record<string, unknown>> = {
  item_key: string;
  payload: T;
};

export function contentHash(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function mergeMemoryItems<T>(
  previous: MemoryItem<T>[],
  incoming: MemoryItem<T>[],
  removedKeys: string[] = [],
): { items: MemoryItem<T>[]; increment: MemoryIncrement } {
  const prevMap = new Map(previous.map((item) => [item.item_key, item]));
  const incomingKeys = new Set(incoming.map((item) => item.item_key));
  const removed = [...new Set(removedKeys.filter((key) => prevMap.has(key)))];
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const next = new Map(prevMap);

  for (const key of removed) next.delete(key);

  for (const item of incoming) {
    const prev = prevMap.get(item.item_key);
    if (!prev) {
      next.set(item.item_key, item);
      added.push(item.item_key);
      continue;
    }
    if (contentHash(prev.payload) === contentHash(item.payload)) {
      unchanged.push(item.item_key);
      continue;
    }
    next.set(item.item_key, item);
    updated.push(item.item_key);
  }

  for (const [key] of prevMap) {
    if (incomingKeys.has(key) || removed.includes(key)) continue;
    unchanged.push(key);
  }

  return {
    items: [...next.values()],
    increment: { added, updated, removed, unchanged },
  };
}
