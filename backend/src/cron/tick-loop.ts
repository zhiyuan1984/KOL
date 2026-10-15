import { setTimeout as delay } from "node:timers/promises";

export type CronTickResult = { claimed: string[]; stale: boolean };

export function cronTickPollMs(value: unknown): number {
  const parsed = Number(value ?? 5_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(60_000, Math.floor(parsed))) : 5_000;
}

/** Sequential durable enqueue only; a separate execution worker owns handlers. */
export async function runCronTickLoop(options: {
  signal: AbortSignal;
  poll_ms?: number;
  tick: () => Promise<CronTickResult>;
  heartbeat: (result: CronTickResult) => Promise<void>;
  on_error?: (error: unknown) => void;
}): Promise<void> {
  const pollMs = cronTickPollMs(options.poll_ms);
  let failures = 0;
  while (!options.signal.aborted) {
    try {
      const result = await options.tick();
      // A success heartbeat follows the committed tick, never precedes it.
      await options.heartbeat(result);
      failures = 0;
    } catch (error) {
      options.on_error?.(error);
      failures += 1;
      if (failures >= 3) throw error;
    }
    if (options.signal.aborted) break;
    try {
      await delay(pollMs, undefined, { signal: options.signal });
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  }
}
