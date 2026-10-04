import { afterAll, describe, expect, it } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import { bootstrapPostgresOnlyRuntime, createPostgresOnlyApp } from "../src/postgres-only-app.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

function hash(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 64).toString("base64")}`;
}

describePostgres("PostgreSQL-only formal HTTP application", () => {
  afterAll(async () => { await closePostgresPool(); });

  it("starts without legacy routes and authenticates formal ticket and Cron endpoints", async () => {
    const suffix = randomBytes(6).toString("hex");
    const accountId = `tacct-app-${suffix}`;
    const username = `app_${suffix}`;
    const password = "postgres-only-test-password";
    process.env.TICKET_AUTH_MODE = "enabled";
    await postgresPool().query(
      `INSERT INTO ticket_accounts (id,username,name,password_hash,roles,active,created_at,updated_at)
       VALUES ($1,$2,'PG App Test',$3,'["employee","admin"]'::jsonb,true,now(),now())`,
      [accountId, username, hash(password)],
    );
    try {
      await bootstrapPostgresOnlyRuntime();
      const app = createPostgresOnlyApp();
      const health = await app.fetch(new Request("http://test.local/api/health"));
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ runtime_mode: "postgres-only", authority_store: "postgresql", legacy_routes: "retired" });

      const login = await app.fetch(new Request("http://test.local/api/ticket-auth/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
      }));
      expect(login.status).toBe(200);
      const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];

      const tickets = await app.fetch(new Request("http://test.local/api/tickets?view=authorized", { headers: { cookie } }));
      expect(tickets.status).toBe(200);
      expect(await tickets.json()).toMatchObject({ items: expect.any(Array), schema_version: expect.any(String) });

      const cron = await app.fetch(new Request("http://test.local/api/cron/jobs", { headers: { cookie } }));
      expect(cron.status).toBe(200);
      expect(await cron.json()).toMatchObject({ jobs: expect.any(Array) });

      const retired = await app.fetch(new Request("http://test.local/api/tasks", { headers: { cookie } }));
      expect(retired.status).toBe(404);
    } finally {
      delete process.env.TICKET_AUTH_MODE;
      await postgresPool().query("DELETE FROM ticket_accounts WHERE id=$1", [accountId]);
    }
  });
});
