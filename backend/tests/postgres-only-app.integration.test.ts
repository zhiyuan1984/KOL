import { afterAll, describe, expect, it } from "vitest";
import { bootstrapPostgresOnlyRuntime, createPostgresOnlyApp } from "../src/postgres-only-app.js";
import { closePostgresPool } from "../src/postgres/pool.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("PostgreSQL-only formal HTTP application", () => {
  afterAll(async () => { await closePostgresPool(); });

  it("never exposes a second ticket login and waits for the shared workbench identity provider", async () => {
    await bootstrapPostgresOnlyRuntime();
    const app = createPostgresOnlyApp();
    const health = await app.fetch(new Request("http://test.local/api/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      runtime_mode: "postgres-only",
      authority_store: "postgresql",
      identity_mode: "workbench_provider_required",
    });

    const retiredLogin = await app.fetch(new Request("http://test.local/api/ticket-auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "no-ticket-login", password: "not-used" }),
    }));
    expect(retiredLogin.status).toBe(503);
    expect(await retiredLogin.json()).toMatchObject({ detail: { code: "workbench_identity_provider_required" } });

    const tickets = await app.fetch(new Request("http://test.local/api/tickets?view=authorized"));
    expect(tickets.status).toBe(503);

    const retired = await app.fetch(new Request("http://test.local/api/tasks"));
    expect(retired.status).toBe(503);
  });
});
