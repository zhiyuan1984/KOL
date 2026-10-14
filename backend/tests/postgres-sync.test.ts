import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseEngine, postgresDb } from "../src/postgres/access.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
beforeEach(async () => {
  await freshTestDatabase();
});
afterEach(async () => {
  await closePostgresPool();
});
describe("native asynchronous PostgreSQL access", () => {
  it("executes independently parameterized queries asynchronously", async () => {
    const rows = await Promise.all(Array.from({ length: 50 }, async (_, value) => {
      return await postgresDb().one<{
        value: number;
      }>("SELECT $1::int AS value", value);
    }));
    expect(rows).toEqual(Array.from({ length: 50 }, (_, value) => ({ value })));
  });
  it("passes PostgreSQL positional parameters through unchanged", async () => {
    await expect(postgresDb().one("SELECT ? AS legacy", "x")).rejects.toMatchObject({ code: "42601" });
    await expect(postgresDb().one<{
      value: string;
    }>("SELECT $1::text AS value", "native")).resolves.toEqual({ value: "native" });
  });
  it("requires DATABASE_URL rather than constructing a SQLite fallback", async () => {
    const temp = mkdtempSync(join(tmpdir(), "native-pg-no-fallback-"));
    const databaseFile = join(temp, "lingong.db");
    const priorUrl = process.env.DATABASE_URL;
    const priorData = process.env.LINGONG_DATA;
    const priorDatabase = process.env.LINGONG_DB;
    await closePostgresPool();
    delete process.env.DATABASE_URL;
    process.env.LINGONG_DATA = temp;
    process.env.LINGONG_DB = databaseFile;
    try {
      expect(() => postgresDb()).toThrow("DATABASE_URL is required");
      expect(() => databaseEngine()).toThrow("DATABASE_URL is required");
      expect(existsSync(databaseFile)).toBe(false);
    }
    finally {
      if (priorUrl === undefined)
        delete process.env.DATABASE_URL;
      else
        process.env.DATABASE_URL = priorUrl;
      if (priorData === undefined)
        delete process.env.LINGONG_DATA;
      else
        process.env.LINGONG_DATA = priorData;
      if (priorDatabase === undefined)
        delete process.env.LINGONG_DB;
      else
        process.env.LINGONG_DB = priorDatabase;
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
