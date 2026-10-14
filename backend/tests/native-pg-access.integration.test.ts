import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, databaseEngine, pgSerialTransaction, pgTransaction, postgresDb, resetDatabase } from "../src/postgres/access.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
const adminUrl = String(process.env.TEST_DATABASE_URL || "").trim();
if (!adminUrl)
    throw new Error("TEST_DATABASE_URL is required for native PostgreSQL integration tests; no production or SQLite fallback");
const databaseName = `pg_access_${randomUUID().replace(/-/g, "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const priorUrl = process.env.DATABASE_URL;
beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE ${databaseName}`);
    }
    finally {
        await admin.end();
    }
    process.env.DATABASE_URL = databaseUrl.toString();
    await postgresDb().command(`
    CREATE TABLE access_counter (id TEXT PRIMARY KEY, value BIGINT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    INSERT INTO access_counter(id,value) VALUES ('counter',0);
    CREATE TABLE audit_events (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ts TEXT, actor TEXT, event_type TEXT, payload TEXT);
  `);
});
afterAll(async () => {
    await closePostgresPool();
    if (priorUrl === undefined)
        delete process.env.DATABASE_URL;
    else
        process.env.DATABASE_URL = priorUrl;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    }
    finally {
        await admin.end();
    }
});
describe("native PostgreSQL access", () => {
    it("returns rows and row counts using native positional parameters", async () => {
        const result = await postgresDb().execute("UPDATE access_counter SET value=$1 WHERE id=$2", 3, "counter");
        expect(result.changes).toBe(1);
        expect(await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter")).toEqual({ value: 3 });
        expect(await postgresDb().many("SELECT id FROM access_counter WHERE value=$1", 3)).toEqual([{ id: "counter" }]);
        expect(await postgresDb().one("SELECT id FROM access_counter WHERE id=$1", "missing")).toBeUndefined();
    });
    it("normalizes only safe integer values, preserving large integers and text IDs", async () => {
        const row = await postgresDb().one("SELECT 0::bigint AS disabled, 9007199254740993::bigint AS large, '00001'::text AS external_id");
        expect(row).toEqual({ disabled: 0, large: "9007199254740993", external_id: "00001" });
    });
    it("does not translate legacy placeholder or conflict SQL at runtime", async () => {
        await expect(postgresDb().one("SELECT ? AS legacy", "x")).rejects.toMatchObject({ code: "42601" });
        await expect(postgresDb().execute("INSERT OR IGNORE INTO access_counter(id,value) VALUES ('x',1)")).rejects.toMatchObject({ code: "42601" });
    });
    it("pins nested helpers and audits to one transaction and rolls everything back", async () => {
        const before = await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter");
        await expect(pgTransaction(async (db) => {
            const local = await db.one("SELECT pg_backend_pid() AS pid");
            expect((await postgresDb().one("SELECT pg_backend_pid() AS pid"))?.pid).toBe(local?.pid);
            await postgresDb().execute("UPDATE access_counter SET value=99 WHERE id=$1", "counter");
            await audit("tester", "native.rollback", { action: "test" });
            throw new Error("rollback sentinel");
        })).rejects.toThrow("rollback sentinel");
        expect(await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter")).toEqual(before);
        expect(await postgresDb().many("SELECT * FROM audit_events WHERE event_type=$1", "native.rollback")).toEqual([]);
    });
    it("uses nested savepoints without discarding successful outer writes", async () => {
        await pgTransaction(async (db) => {
            await db.execute("UPDATE access_counter SET value=10 WHERE id=$1", "counter");
            await expect(pgTransaction(async (nested) => {
                await nested.execute("UPDATE access_counter SET value=20 WHERE id=$1", "counter");
                throw new Error("nested rollback");
            })).rejects.toThrow("nested rollback");
            expect((await db.one("SELECT value FROM access_counter WHERE id=$1", "counter"))?.value).toBe(10);
        });
        expect((await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter"))?.value).toBe(10);
    });
    it("uses serializable retry for concurrent database-only updates", async () => {
        await postgresDb().execute("UPDATE access_counter SET value=0 WHERE id=$1", "counter");
        const increment = async () => (await pgSerialTransaction(async (db) => {
            const row = await db.one("SELECT value FROM access_counter WHERE id=$1", "counter");
            await db.command("SELECT pg_sleep(0.03)");
            await db.execute("UPDATE access_counter SET value=$1,version=version+1 WHERE id=$2", Number(row?.value) + 1, "counter");
        }));
        await Promise.all([( increment()), ( increment())]);
        expect((await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter"))?.value).toBe(2);
    });
    it("can use an explicitly supplied native PoolClient", async () => {
        const client = await postgresPool().connect();
        try {
            await client.query("BEGIN");
            await postgresDb(client).execute("UPDATE access_counter SET value=700 WHERE id=$1", "counter");
            expect((await postgresDb(client).one("SELECT value FROM access_counter WHERE id=$1", "counter"))?.value).toBe(700);
            await client.query("ROLLBACK");
        }
        finally {
            client.release();
        }
        expect((await postgresDb().one("SELECT value FROM access_counter WHERE id=$1", "counter"))?.value).toBe(2);
    });
    it("rejects missing PostgreSQL configuration without creating a local database", async () => {
        const tmp = mkdtempSync(join(tmpdir(), "native-no-fallback-"));
        const previousData = process.env.LINGONG_DATA;
        const previousDb = process.env.LINGONG_DB;
        const configured = process.env.DATABASE_URL;
        process.env.LINGONG_DATA = tmp;
        process.env.LINGONG_DB = join(tmp, "lingong.db");
        delete process.env.DATABASE_URL;
        try {
            expect(() => postgresDb()).toThrow("DATABASE_URL is required");
            expect(() => databaseEngine()).toThrow("DATABASE_URL is required");
            expect(existsSync(join(tmp, "lingong.db"))).toBe(false);
            await expect(resetDatabase()).rejects.toThrow("DATABASE_URL is required");
        }
        finally {
            process.env.DATABASE_URL = configured;
            if (previousData === undefined)
                delete process.env.LINGONG_DATA;
            else
                process.env.LINGONG_DATA = previousData;
            if (previousDb === undefined)
                delete process.env.LINGONG_DB;
            else
                process.env.LINGONG_DB = previousDb;
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
