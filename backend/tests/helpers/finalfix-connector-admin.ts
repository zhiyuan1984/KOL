import { seedPostgresReferenceData } from "../../src/postgres/reference-seed.js";

/**
 * Seed the authoritative built-in connector catalog in a fresh native-PG test
 * database.  Runtime store APIs deliberately reject rows that are absent from
 * this catalog, so callers must establish this production-equivalent precondition
 * before configuring a built-in connector.
 */
export async function seedBuiltinConnectorReferences(): Promise<void> {
  await seedPostgresReferenceData();
}

/** Poll a read model until its real asynchronous terminal predicate is true. */
export async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 40;
  const deadline = Date.now() + timeoutMs;
  let latest = await read();
  while (!ready(latest)) {
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${options.description || "asynchronous terminal state"}`);
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    latest = await read();
  }
  return latest;
}
