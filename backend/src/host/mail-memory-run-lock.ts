import { currentTransactionClient, postgresPool } from "../postgres/pool.js";

/** A single session-level lock prevents overlapping cross-worker cron increments. */
export const MAIL_MEMORY_INCREMENT_LOCK_KEY = "-402819783216001093";

export type MailMemoryRunLock = {
  release: () => Promise<void>;
};

/**
 * The increment may make slow model calls, so this uses a session advisory lock
 * without BEGIN. It intentionally refuses an ambient transaction: leasing a
 * second pool client there would silently escape the caller's business unit,
 * while holding the ambient transaction across model I/O is unsafe.
 */
export async function acquireMailMemoryIncrementLock(): Promise<MailMemoryRunLock | null> {
  if (currentTransactionClient()) {
    throw new Error("mail_memory_increment_cannot_run_inside_transaction");
  }
  const client = await postgresPool().connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [MAIL_MEMORY_INCREMENT_LOCK_KEY],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        const result = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
          [MAIL_MEMORY_INCREMENT_LOCK_KEY],
        );
        if (result.rows[0]?.unlocked !== true) {
          throw new Error("mail_memory_increment_unlock_not_owned");
        }
        client.release();
      } catch (error) {
        // A session lock that could not be released must never be returned to
        // the shared pool; destroying its client makes PostgreSQL release it.
        client.release(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
  };
}
