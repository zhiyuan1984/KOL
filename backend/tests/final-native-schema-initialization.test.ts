import { Client } from "pg";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { applyPostgresMigrations, postgresMigrationManifest } from "../src/postgres/migrations.js";
import { freshTestDatabase } from "./support/pg.js";
beforeEach(async () => { await freshTestDatabase({ empty: true }); });
afterEach(async () => { await resetConn(); });
describe("complete PostgreSQL-native schema initialization", () => {
  it("initializes an empty owned database and records every current migration checksum exactly once", async () => {
    const manifest = postgresMigrationManifest();
    expect(manifest.length).toBeGreaterThan(20);
    expect(new Set(manifest.map(row => row.id)).size).toBe(manifest.length);
    const ledger = (await getConn().query<{ id: string; checksum: string }>("SELECT id,checksum FROM schema_migrations ORDER BY id")).rows;
    for (const migration of manifest) expect(ledger.find(row => row.id === migration.id)).toEqual(migration);
    expect(manifest.some(row => row.id === "20261015_046_knowledge_legacy_backfill")).toBe(true);
    expect((await getConn().query("SELECT current_database() AS name,version() AS engine")).rows[0].engine).toMatch(/PostgreSQL/);
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try { await expect(applyPostgresMigrations(client)).resolves.toEqual([]); }
    finally { await client.end(); }
    expect((await getConn().query("SELECT id,checksum FROM schema_migrations ORDER BY id")).rows).toEqual(ledger);
  });
  it("rejects a checksum mismatch rather than silently treating a changed migration as applied", async () => {
    const migration = postgresMigrationManifest().at(-1);
    if (!migration) throw new Error("migration manifest is empty");
    await getConn().query("UPDATE schema_migrations SET checksum=$1 WHERE id=$2", ["f".repeat(64), migration.id]);
    const before = (await getConn().query("SELECT id FROM app_schema_migrations ORDER BY id")).rows;
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try { await expect(applyPostgresMigrations(client, { only: migration.id })).rejects.toThrow(/checksum mismatch/); }
    finally { await client.end(); }
    expect((await getConn().query("SELECT id FROM app_schema_migrations ORDER BY id")).rows).toEqual(before);
    expect((await getConn().query("SELECT checksum FROM schema_migrations WHERE id=$1", [migration.id])).rows[0].checksum).toBe("f".repeat(64));
  });
});
