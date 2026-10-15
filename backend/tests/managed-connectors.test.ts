import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { ensureRuntimeSchema } from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";

beforeEach(async () => {
  await freshTestDatabase();
  (await resetConn());
  await ensureRuntimeSchema();
});

afterEach(async () => {
  (await resetConn());
});

describe("managed MCP connector catalog", () => {
  it("materializes only the built-in managed templates in the native PostgreSQL catalog", async () => {
    const db = getConn();
    expect(((await db.query("SELECT id,label,enabled,status FROM connectors ORDER BY id",[])).rows as Array<{ id: string; label: string; enabled: number; status: string }>)).toEqual([
      { id: "claw", label: "MediaCrawler MCP", enabled: 0, status: "draft" },
      { id: "starrykol", label: "Starry KOL MCP", enabled: 0, status: "draft" },
    ]);
  });
});
