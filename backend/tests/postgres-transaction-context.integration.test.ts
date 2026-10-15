import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit, getConn } from "../src/db.js";
import { closePostgresPool, currentTransactionClient, postgresConnection, postgresPool, postgresQuery, postgresTransaction } from "../src/postgres/pool.js";

const schema = `native_tx_context_${process.pid}`;
const table = `${schema}.probe`;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const count = async (id: string) => (await postgresQuery<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id=$1`, [id]))[0]!.n;
const injectedConflict = () => Object.assign(new Error("injected serialization failure"), { code: "40001" });

beforeAll(async () => {
  const url = new URL(String(process.env.DATABASE_URL || ""));
  if (process.env.NODE_ENV !== "test" || !/^\/kolnative_resolution_suite_[0-9]+$/.test(url.pathname) || process.env.TEST_POSTGRES_URL !== process.env.DATABASE_URL) {
    throw new Error("This integration test requires the dedicated isolated suite runner; production is forbidden");
  }
  await postgresPool().query(`CREATE SCHEMA ${schema}`);
  await postgresPool().query(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)`);
});
afterAll(async () => {
  await postgresPool().query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await closePostgresPool();
});

describe("native PostgreSQL transaction ownership and truthful completion", () => {
  it("uses one physical client and serializable snapshot for every native access path", async () => {
    expect(currentTransactionClient()).toBeUndefined();
    await postgresTransaction(async (client) => {
      expect(getConn()).toBe(client);
      expect(postgresConnection()).toBe(client);
      const direct = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const throughQuery = (await postgresQuery<{ pid: number }>("SELECT pg_backend_pid() AS pid"))[0]!.pid;
      const throughDb = (await getConn().query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      expect([throughQuery, throughDb]).toEqual([direct, direct]);
      const isolation = (await client.query<{ transaction_isolation: string }>("SHOW transaction_isolation")).rows[0]!.transaction_isolation;
      expect(isolation).toBe("serializable");
    });
    expect(currentTransactionClient()).toBeUndefined();
  });

  it("rolls back business rows and implicit audit together", async () => {
    const eventType = `native_tx_context.rollback.${process.pid}`;
    const failure = new Error("domain failure after audit");
    await expect(postgresTransaction(async () => {
      await getConn().query(`INSERT INTO ${table} (id) VALUES ($1)`, ["rollback"]);
      await audit("transaction-test", eventType, { test_only: true });
      throw failure;
    })).rejects.toBe(failure);
    expect(await count("rollback")).toBe(0);
    expect((await postgresQuery<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE event_type=$1", [eventType]))[0]!.n).toBe(0);
  });

  it("a caught nested failure rolls back only its savepoint, on the same client", async () => {
    await postgresTransaction(async (parent) => {
      await parent.query(`INSERT INTO ${table} (id) VALUES ('parent-kept')`);
      await expect(postgresTransaction(async (nested) => {
        expect(nested).toBe(parent);
        await getConn().query(`INSERT INTO ${table} (id) VALUES ('child-rolled-back')`);
        throw new Error("nested rejection");
      })).rejects.toThrow("nested rejection");
      await getConn().query(`INSERT INTO ${table} (id) VALUES ('parent-after-child')`);
    });
    expect(await count("parent-kept")).toBe(1);
    expect(await count("child-rolled-back")).toBe(0);
    expect(await count("parent-after-child")).toBe(1);
  });

  it("serializes sibling savepoints while allowing reentrant descendants", async () => {
    const order: string[] = [];
    await postgresTransaction(async (parent) => {
      const results = await Promise.allSettled([
        postgresTransaction(async (first) => {
          expect(first).toBe(parent);
          order.push("first-start");
          await first.query(`INSERT INTO ${table} (id) VALUES ('sibling-first')`);
          await postgresTransaction(async (grandchild) => {
            expect(grandchild).toBe(parent);
            await grandchild.query(`INSERT INTO ${table} (id) VALUES ('grandchild')`);
            order.push("grandchild");
          });
          await pause(5);
          order.push("first-end");
        }),
        postgresTransaction(async (second) => {
          expect(second).toBe(parent);
          order.push("second-start");
          await second.query(`INSERT INTO ${table} (id) VALUES ('sibling-second-failed')`);
          throw new Error("second sibling rejection");
        }),
      ]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    });
    expect(order).toEqual(["first-start", "grandchild", "first-end", "second-start"]);
    expect(await count("sibling-first")).toBe(1);
    expect(await count("grandchild")).toBe(1);
    expect(await count("sibling-second-failed")).toBe(0);
  });

  it("keeps simultaneous outer transactions in distinct async contexts", async () => {
    let entered = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const pids = await Promise.all([0, 1].map(() => postgresTransaction(async (client) => {
      const before = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      entered += 1;
      if (entered === 2) release();
      await ready;
      expect(currentTransactionClient()).toBe(client);
      const after = (await postgresQuery<{ pid: number }>("SELECT pg_backend_pid() AS pid"))[0]!.pid;
      expect(after).toBe(before);
      return before;
    }, { maxRetries: 0 })));
    expect(pids[0]).not.toBe(pids[1]);
    expect(currentTransactionClient()).toBeUndefined();
  });

  it("does not refresh a serializable fact snapshot from another connection mid-unit", async () => {
    await postgresPool().query(`INSERT INTO ${table} (id,value) VALUES ('snapshot-fact',1)`);
    const external = await postgresPool().connect();
    try {
      await postgresTransaction(async () => {
        const before = (await postgresQuery<{ value: number }>(`SELECT value FROM ${table} WHERE id='snapshot-fact'`))[0]!.value;
        await external.query(`UPDATE ${table} SET value=0 WHERE id='snapshot-fact'`);
        const after = (await postgresQuery<{ value: number }>(`SELECT value FROM ${table} WHERE id='snapshot-fact'`))[0]!.value;
        expect([before, after]).toEqual([1, 1]);
      }, { maxRetries: 0 });
      expect((await postgresQuery<{ value: number }>(`SELECT value FROM ${table} WHERE id='snapshot-fact'`))[0]!.value).toBe(0);
    } finally { external.release(); }
  });

  it("never reports success when a swallowed SQL error makes COMMIT perform ROLLBACK", async () => {
    await expect(postgresTransaction(async (client) => {
      await client.query(`INSERT INTO ${table} (id) VALUES ('swallowed-sql-error')`);
      try { await client.query("SELECT 1/0"); } catch { /* Deliberately swallowed to exercise the commit receipt. */ }
      return { ok: true };
    }, { maxRetries: 0 })).rejects.toThrow("rolled back rather than committed");
    expect(await count("swallowed-sql-error")).toBe(0);
  });

  it("retries an injected 40001 only after real rollback, committing one final row", async () => {
    let attempts = 0;
    await postgresTransaction(async (client) => {
      attempts += 1;
      await client.query(`INSERT INTO ${table} (id,value) VALUES ('retried-row',$1)`, [attempts]);
      if (attempts === 1) throw injectedConflict();
    }, { maxRetries: 1 });
    expect(attempts).toBe(2);
    expect(await count("retried-row")).toBe(1);
    expect((await postgresQuery<{ value: number }>(`SELECT value FROM ${table} WHERE id='retried-row'`))[0]!.value).toBe(2);
  });

  it("does not let an inner catch consume a retryable failure and commit partial writes", async () => {
    let attempts = 0;
    await postgresTransaction(async (client) => {
      attempts += 1;
      await client.query(`INSERT INTO ${table} (id,value) VALUES ('outer-after-retry',$1)`, [attempts]);
      try {
        await postgresTransaction(async (nested) => {
          await nested.query(`INSERT INTO ${table} (id) VALUES ('nested-after-retry')`);
          if (attempts === 1) throw injectedConflict();
        });
      } catch { /* Outer unit still must retry. */ }
    }, { maxRetries: 1 });
    expect(attempts).toBe(2);
    expect(await count("outer-after-retry")).toBe(1);
    expect(await count("nested-after-retry")).toBe(1);
  });

  it("rejects stronger nested isolation instead of silently using a weaker snapshot", async () => {
    await postgresTransaction(async () => {
      await expect(postgresTransaction(async () => 1, { isolation: "SERIALIZABLE" })).rejects.toThrow("cannot strengthen isolation");
    }, { isolation: "READ COMMITTED" });
  });

  it("does not retry an ambiguous non-SQLSTATE failure", async () => {
    let attempts = 0;
    const failure = Object.assign(new Error("ambiguous transport outcome"), { code: "ECONNRESET" });
    await expect(postgresTransaction(async () => { attempts += 1; throw failure; })).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it("cannot close a caller-owned client and never exposes it to a delayed callback after completion", async () => {
    let deferredClient: unknown = "not-run";
    await postgresTransaction(async () => {
      await expect(closePostgresPool()).rejects.toThrow("active business transaction");
      setTimeout(() => { deferredClient = currentTransactionClient(); }, 20);
    });
    await pause(40);
    expect(deferredClient).toBeUndefined();
  });
});
