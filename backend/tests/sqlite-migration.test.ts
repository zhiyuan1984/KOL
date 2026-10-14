import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseEngine, postgresDb, resetDatabase } from "../src/postgres/access.js";
import { freshTestDatabase } from "./support/pg.js";
beforeEach(async () => {
  await freshTestDatabase();
  await resetDatabase();
});
afterEach(async () => {
  await resetDatabase();
});
describe("PostgreSQL-only 数据层", () => {
  it("声明 PostgreSQL 为唯一数据库引擎", () => {
    expect(databaseEngine()).toBe("postgres");
  });
  it("使用原生 $n 参数并保留大整数与 JSON 值", async () => {
    const row = await postgresDb().one(`SELECT $1::text AS id,
          $2::bigint AS followers,
          $3::numeric AS score,
          $4::jsonb AS payload`, "creator_1", "9007199254740992", "0.7500", JSON.stringify({ platform: "youtube" }));
    expect(row).toEqual({
      id: "creator_1",
      followers: "9007199254740992",
      score: "0.7500",
      payload: { platform: "youtube" },
  });
  });
  it("在 PostgreSQL 中由参数边界区分文本，不执行字符串拼接", async () => {
    const payload = "creator_'quoted'";
    const row = await postgresDb().one("SELECT $1::text AS payload", payload);
    expect(row?.payload).toBe(payload);
  });
});
