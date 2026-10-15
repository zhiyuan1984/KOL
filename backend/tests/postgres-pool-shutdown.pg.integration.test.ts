import { afterEach, describe, expect, it, vi } from "vitest";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";

// The global setup owns this unique test clone. No shared or production URL is used.
afterEach(async () => {
  vi.restoreAllMocks();
  await closePostgresPool();
});

describe("native pool physical shutdown", () => {
  it("waits for every physical client close after pg-pool has marked itself ended", async () => {
    const pool = postgresPool();
    const first = await pool.connect();
    const second = await pool.connect();
    const finish: Array<() => void> = [];
    const hold = (client: typeof first) => {
      const end = client.end.bind(client);
      vi.spyOn(client, "end").mockImplementation(((callback?: () => void) => {
        finish.push(() => {
          if (callback) end(callback);
          else void end();
        });
      }) as typeof client.end);
    };
    hold(first);
    hold(second);
    first.release();
    second.release();
    let settled = false;
    const closing = closePostgresPool().then(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(finish).toHaveLength(2), { timeout: 1500, interval: 5 });
      // pg-pool removes clients from its array before their end callbacks fire.
      expect((pool as unknown as { ended: boolean }).ended).toBe(true);
      expect(settled).toBe(false);
      const firstRemoved = new Promise<void>((resolve) => pool.once("remove", () => resolve()));
      finish.shift()!();
      await firstRemoved;
      expect(settled).toBe(false);
      finish.shift()!();
      await closing;
      expect(settled).toBe(true);
    } finally {
      for (const release of finish.splice(0)) release();
      await closing;
    }
  });
});
