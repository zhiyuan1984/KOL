import { beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { pgCreateFirstUser, pgFindUserForLogin } from "../src/postgres/auth-pg.js";
import { postgresDb } from "../src/postgres/access.js";
import { hashPassword } from "../src/auth.js";
import { HttpFail } from "../src/host/errors.js";

beforeEach(async () => { await freshTestDatabase(); });

async function firstUser(id: string, username: string, name = username) {
  return pgCreateFirstUser({
    id, username, name,
    passwordHash: await hashPassword("isolated-test-password"),
    brands: ["LT"], site: "test", email: "", phone: "",
    now: new Date().toISOString(),
  });
}

describe("native PostgreSQL authentication setup", () => {
  it("creates exactly one first administrator under concurrent setup requests", async () => {
    const results = await Promise.allSettled([
      firstUser("usr_first_a", "first_a"),
      firstUser("usr_first_b", "first_b"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(HttpFail);
    expect(rejected.reason.status).toBe(409);
    expect(Number((await postgresDb().one<{ n: number }>("SELECT COUNT(*) AS n FROM users"))?.n)).toBe(1);
  });

  it("does not treat an empty email as a match for an unknown identifier", async () => {
    await firstUser("usr_owner", "owner_account", "Owner");
    expect(await pgFindUserForLogin("unknown_account")).toBeUndefined();
    expect((await pgFindUserForLogin("owner_account"))?.id).toBe("usr_owner");
  });

  it("rejects an ambiguous display name while retaining exact account lookup", async () => {
    const owner = await firstUser("usr_same_a", "unique_a", "Repeated display name");
    const now = new Date().toISOString();
    await postgresDb().execute(`INSERT INTO users
      (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,'','')`,
      "usr_same_b", "unique_b", "Repeated display name", owner.password_hash,
      JSON.stringify(["employee"]), JSON.stringify(["LT"]), "test", now);
    expect(await pgFindUserForLogin("Repeated display name")).toBeUndefined();
    expect((await pgFindUserForLogin("unique_a"))?.id).toBe("usr_same_a");
    expect((await pgFindUserForLogin("unique_b"))?.id).toBe("usr_same_b");
  });
});
