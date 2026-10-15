// In-process lifecycle bookkeeping, not a work queue or an authority store.
// Callers still execute immediately and own their durable state/failure receipts.
const pending = new Set<Promise<unknown>>();
const failures: unknown[] = [];

export function trackBackgroundWork<T>(work: Promise<T>, label: string): Promise<T> {
  const owned = work.finally(() => pending.delete(owned));
  pending.add(owned);
  // Observe rejection immediately; retain it for the shutdown/reset owner to
  // surface rather than producing an unhandled rejection after the pool closes.
  void owned.catch((error: unknown) => {
    failures.push(error);
    console.error("[background-work] task failed", { label, error_type: error instanceof Error ? error.name : "Error" });
  });
  return owned;
}

export async function drainBackgroundWork(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Background work did not settle before the database close deadline");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...pending]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Background work did not settle before the database close deadline")), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (failures.length) throw new AggregateError(failures.splice(0), "Registered background work failed before database close");
}
