import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { closePostgresPool } from "../src/postgres/pool.js";
import { resetDatabase } from "../src/postgres/access.js";
import { DEMO_ADMIN } from "../src/config.js";
import { freshTestDatabase } from "./support/pg.js";
let app: Hono;
let cookie = "";
beforeEach(async () => {
  await freshTestDatabase();
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "enabled";
  await resetDatabase();
  const { createApp } = await import("../src/app.js");
  app = await createApp();
  const setup = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: DEMO_ADMIN.handle,
      name: DEMO_ADMIN.name,
      password: DEMO_ADMIN.password,
      brands: ["LT", "RO", "PQ"],
    }),
  });
  expect(setup.status).toBe(201);
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: DEMO_ADMIN.handle,
      password: DEMO_ADMIN.password,
    }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  expect(cookie).toContain("lingong_session=");
});
afterEach(async () => {
  await resetDatabase();
  delete process.env.AUTH_MODE;
  process.env.CODEX_MODE = "stub";
});
afterEach(async () => { await closePostgresPool(); });
describe("PostgreSQL-only full HTTP application", () => {
  it("uses the workbench cookie across health, formal tickets, and cron routes without reviving ticket login", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, name: "灵工" });
    const retiredLogin = await app.request("/api/ticket-auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: cookie },
      body: JSON.stringify({ username: "no-ticket-login", password: "not-used" }),
    });
    expect(retiredLogin.status).toBe(404);
    const anonymousTickets = await app.request("/api/tickets?view=authorized");
    expect(anonymousTickets.status).toBe(401);
    const tickets = await app.request("/api/tickets?view=authorized", { headers: { Cookie: cookie } });
    expect(tickets.status).toBe(200);
    const anonymousCron = await app.request("/api/cron/jobs/overdue-scan");
    expect(anonymousCron.status).toBe(401);
    const cron = await app.request("/api/cron/jobs/overdue-scan", { headers: { Cookie: cookie } });
    expect(cron.status).toBe(200);
    expect(await cron.json()).toMatchObject({ job: { id: expect.stringMatching(/^cjob_/), job_key: "overdue-scan" } });
  });
});
