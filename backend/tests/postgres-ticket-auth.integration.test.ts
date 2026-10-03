import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { requireTicketPrincipal, ticketAuthMiddleware, ticketAuthRouter } from "../src/ticket-domain/auth.js";

const configured = Boolean(process.env.TEST_POSTGRES_URL?.trim());
if (configured) process.env.DATABASE_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = configured ? describe : describe.skip;

describePostgres("native PostgreSQL ticket identity", () => {
  beforeEach(async () => {
    await postgresPool().query("TRUNCATE ticket_auth_sessions, ticket_accounts CASCADE");
    delete process.env.TICKET_AUTH_MODE;
    delete process.env.TICKET_DEMO_USER_ID;
  });

  afterAll(async () => { await closePostgresPool(); });

  it("creates the explicit first administrator and authenticates a protected ticket request", async () => {
    const setup = await ticketAuthRouter.fetch(new Request("http://test.local/ticket-auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "formal_admin", name: "Formal Admin", password: "long-password-123" }),
    }));
    expect(setup.status).toBe(201);
    expect(await setup.json()).toMatchObject({ ok: true, account: { username: "formal_admin", role: "admin" } });
    const firstCookie = String(setup.headers.get("set-cookie") || "").split(";")[0];
    expect(firstCookie).toMatch(/^kol_ticket_session=/);

    const repeatSetup = await ticketAuthRouter.fetch(new Request("http://test.local/ticket-auth/setup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "other", password: "long-password-456" }),
    }));
    expect(repeatSetup.status).toBe(409);

    const logout = await ticketAuthRouter.fetch(new Request("http://test.local/ticket-auth/logout", {
      method: "POST", headers: { cookie: firstCookie },
    }));
    expect(logout.status).toBe(200);

    const login = await ticketAuthRouter.fetch(new Request("http://test.local/ticket-auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "formal_admin", password: "long-password-123" }),
    }));
    expect(login.status).toBe(200);
    const sessionCookie = String(login.headers.get("set-cookie") || "").split(";")[0];

    process.env.TICKET_AUTH_MODE = "enabled";
    const protectedApp = new Hono();
    protectedApp.use("*", ticketAuthMiddleware);
    protectedApp.get("/private", (c) => c.json({ actor: requireTicketPrincipal().id }));
    const protectedResponse = await protectedApp.fetch(new Request("http://test.local/private", { headers: { cookie: sessionCookie } }));
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toMatchObject({ actor: expect.any(String) });
  });
});
