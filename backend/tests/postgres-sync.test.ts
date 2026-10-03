import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { PostgresSyncConn, translateSqliteSql } from "../src/postgres/sync.js";

describe("PostgreSQL synchronous repository bridge", () => {
  it("converts positional parameters while preserving literals", () => {
    expect(translateSqliteSql("SELECT ? AS value, '?' AS literal")).toBe("SELECT $1 AS value, '?' AS literal");
  });

  it("maps SQLite conflict helpers to PostgreSQL conflict clauses", () => {
    expect(translateSqliteSql("INSERT OR IGNORE INTO app_state (key,value) VALUES (?,?)"))
      .toBe("INSERT INTO app_state (key,value) VALUES ($1,$2) ON CONFLICT DO NOTHING");
    expect(translateSqliteSql("INSERT OR REPLACE INTO app_state (key,value) VALUES (?,?)"))
      .toBe("INSERT INTO app_state (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET key=EXCLUDED.key,value=EXCLUDED.value");
  });

  it("maps transactional and scalar compatibility forms", () => {
    expect(translateSqliteSql("BEGIN IMMEDIATE")).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(translateSqliteSql("SELECT IFNULL(json_extract(payload,'$.kind'),'')")).toBe("SELECT COALESCE(payload::jsonb ->> 'kind','')");
    expect(translateSqliteSql("SELECT json_extract(condition_json,'$.schedule.interval_minutes')"))
      .toBe("SELECT condition_json::jsonb #>> '{schedule,interval_minutes}'");
    expect(translateSqliteSql("schema_hash NOT GLOB '*[^0123456789abcdef]*'"))
      .toBe("schema_hash !~ '[^0123456789abcdef]'");
  });

  it("maps SQLite NOCASE sorting without requiring a PostgreSQL collation", () => {
    expect(translateSqliteSql("SELECT id,label FROM connectors ORDER BY label COLLATE NOCASE, id"))
      .toBe("SELECT id,label FROM connectors ORDER BY LOWER(label), id");
  });
});

type StubStep = "drop" | { afterMs?: number; payload: unknown };

/**
 * Runs the real bridge against a scripted worker that speaks the same
 * SharedArrayBuffer protocol, so buffer management is exercised without a
 * PostgreSQL server. The constructor starts its own unreachable worker; that
 * worker is terminated and replaced before the first request.
 */
function connectWithStubWorker(script: StubStep[]) {
  const connection = new PostgresSyncConn("postgresql://192.0.2.1:5432/stub");
  const internals = connection as unknown as { worker: Worker };
  const unreachable = internals.worker;
  unreachable.on("error", () => {});
  void unreachable.terminate();
  const stub = new Worker(new URL("./fixtures/postgres-bridge-stub-worker.mjs", import.meta.url), {
    workerData: { script },
  });
  stub.unref();
  const seen: SharedArrayBuffer[] = [];
  const originalPost = stub.postMessage.bind(stub);
  stub.postMessage = ((message: unknown) => {
    seen.push((message as { shared: SharedArrayBuffer }).shared);
    originalPost(message);
  }) as unknown as typeof stub.postMessage;
  internals.worker = stub;
  return { connection, seen };
}

describe("PostgreSQL bridge response buffer", () => {
  it("reuses one buffer across sequential requests", () => {
    const { connection, seen } = connectWithStubWorker([{ payload: { ok: true, rows: [{ value: 7 }], rowCount: 1 } }]);
    try {
      for (let i = 0; i < 50; i += 1) {
        expect(connection.prepare("SELECT ? AS value").get(i)).toEqual({ value: 7 });
      }
      expect(seen).toHaveLength(50);
      expect(new Set(seen).size).toBe(1);
    } finally {
      connection.close();
    }
  });

  it("discards the buffer after a timeout so a late response cannot answer the next query", () => {
    process.env.PG_SYNC_TIMEOUT_MS = "1000";
    const { connection, seen } = connectWithStubWorker([
      { afterMs: 1400, payload: { ok: true, rows: [{ value: "stale" }], rowCount: 1 } },
      { afterMs: 1200, payload: { ok: true, rows: [{ value: "fresh" }], rowCount: 1 } },
    ]);
    try {
      expect(() => connection.exec("SELECT 1")).toThrow(/timed out/);
      process.env.PG_SYNC_TIMEOUT_MS = "5000";
      expect(connection.exec("SELECT 2")).toEqual([{ value: "fresh" }]);
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
    } finally {
      delete process.env.PG_SYNC_TIMEOUT_MS;
      connection.close();
    }
  });

  it("serves the next request on a fresh buffer after a dropped answer", () => {
    process.env.PG_SYNC_TIMEOUT_MS = "1000";
    const { connection, seen } = connectWithStubWorker(["drop", { payload: { ok: true, rows: [{ value: "ok" }], rowCount: 1 } }]);
    try {
      expect(() => connection.exec("SELECT 1")).toThrow(/timed out/);
      process.env.PG_SYNC_TIMEOUT_MS = "5000";
      expect(connection.exec("SELECT 2")).toEqual([{ value: "ok" }]);
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
    } finally {
      delete process.env.PG_SYNC_TIMEOUT_MS;
      connection.close();
    }
  });
});
