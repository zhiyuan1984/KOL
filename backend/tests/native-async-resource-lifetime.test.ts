import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { postgresPool } from "../src/postgres/pool.js";
import { withRemoteMcp, RemoteMcpClient } from "../src/mcp/remote.js";
import { withTimeout } from "../src/gateway/import-creator.js";
import { withCrawlerInstanceKeyLock } from "../src/crawl/runtime-gates.js";

describe("native asynchronous resource lifetime", () => {
  beforeEach(async () => { await freshTestDatabase({ reclaimPrevious: true }); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("keeps the remote client open until the operation settles and then closes once", async () => {
    const close = vi.spyOn(RemoteMcpClient.prototype, "close").mockResolvedValue(undefined);
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const result = withRemoteMcp(async () => pending, { url: "http://127.0.0.1:1/no-network-used", headers: { "x-native-test": "synthetic-local-only" } });
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    finish("actual-result");
    await expect(result).resolves.toBe("actual-result");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the remote client when an awaited operation rejects", async () => {
    const close = vi.spyOn(RemoteMcpClient.prototype, "close").mockResolvedValue(undefined);
    await expect(withRemoteMcp(async () => { throw new Error("actual-operation-failure"); },
      { url: "http://127.0.0.1:1/no-network-used", headers: { "x-native-test": "synthetic-local-only" } })).rejects.toThrow("actual-operation-failure");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retains the timeout until a never-settling operation is actually rejected", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 20, "lifetime-test"))
      .rejects.toThrow("lifetime-test request timed out");
  });

  it("keeps a native instance advisory lock throughout the awaited operation", async () => {
    const key = "native-resource-lifetime-instance";
    let enter!: () => void, finish!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const running = withCrawlerInstanceKeyLock(key, async () => {
      enter();
      await blocked;
      return "committed-operation";
    });
    await entered;
    const probe = await postgresPool().connect();
    try {
      const during = await probe.query<{ held: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held", [`crawler:${key}`]);
      expect(during.rows[0]?.held).toBe(false);
      finish();
      await expect(running).resolves.toBe("committed-operation");
      const after = await probe.query<{ held: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held", [`crawler:${key}`]);
      expect(after.rows[0]?.held).toBe(true);
      await probe.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`crawler:${key}`]);
    } finally {
      finish();
      await running.catch(() => undefined);
      probe.release();
    }
  });
});
