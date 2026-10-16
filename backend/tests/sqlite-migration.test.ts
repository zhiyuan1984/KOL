import { describe, expect, it } from "vitest";
import { databaseEngine, getConn, resetConn } from "../src/db.js";
import { postgresPool, requiredPostgresUrl } from "../src/postgres/pool.js";

describe("PostgreSQL-native migration contract", () => {
  it("rejects SQLite configuration instead of silently selecting a compatibility path", () => {
    const previous = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "file:./legacy.sqlite";
      expect(() => requiredPostgresUrl()).toThrow(/DATABASE_URL|PostgreSQL/i);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
  it("uses the isolated PostgreSQL test database and exposes native async queries", async () => {
    expect(databaseEngine()).toBe("postgres");
    expect(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL).toMatch(/^postgres(?:ql)?:\/\//);
    const result = await getConn().query("SELECT current_database() AS database_name, current_setting('server_version') AS server_version");
    expect(result.rows[0]?.database_name).toBeTruthy();
    expect(result.rows[0]?.server_version).toBeTruthy();
    expect(typeof postgresPool().query).toBe("function");
    await resetConn();
  });
});
