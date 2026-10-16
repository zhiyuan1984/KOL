import { beforeEach, describe, expect, it } from "vitest";
import { postgresQuery } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
beforeEach(async () => { await freshTestDatabase(); });
describe("native PostgreSQL authority integer semantics", () => {
  it("does not treat disabled bigint flags as truthy string zero", async () => {
    const [row] = await postgresQuery("SELECT 0::bigint AS disabled, 1::bigint AS enabled");
    expect(row.disabled).toBe(0); expect(Boolean(row.disabled)).toBe(false);
    expect(row.enabled).toBe(1); expect(Boolean(row.enabled)).toBe(true);
  });
  it("preserves integers outside JavaScript safe range", async () => {
    const [row] = await postgresQuery("SELECT 9007199254740993::bigint AS large");
    expect(row.large).toBe("9007199254740993");
  });
});
