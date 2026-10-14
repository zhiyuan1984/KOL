import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { mapUser, tokenDigest, type AppUser } from "../src/auth.js";

let app: Hono;
let alice: AppUser;
let bob: AppUser;

async function as(user: AppUser, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `lingong_session=settings-token-${user.id}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
}

function insertUser(id: string, name: string, brands = ["LT"]) {
  const stamp = nowIso();
  getConn().prepare(`INSERT INTO users(id,username,name,email,phone,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES (?,?,?,?,?,'x',?,?,?,1,?,?)`).run(id, `${id}@example.test`, name, `${id}@example.test`, "", JSON.stringify(["employee"]), JSON.stringify(brands), "", stamp, stamp);
  getConn().prepare("INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(tokenDigest(`settings-token-${id}`), id, "2099-01-01T00:00:00.000Z", stamp);
  return mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(id) as Record<string, unknown>);
}

beforeEach(async () => {
  process.env.AUTH_MODE = "enabled";
  await freshTestDatabase();
  delete process.env.LINGONG_DB;
  resetConn();
  alice = insertUser("settings-alice", "Alice");
  bob = insertUser("settings-bob", "Bob");
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
});

afterEach(() => { resetConn(); process.env.AUTH_MODE = "disabled"; });

describe("KOL settings route boundaries (isolated PostgreSQL)", () => {
  it("returns a minimal context and rejects unknown/invalid preference values", async () => {
    const context = await as(alice, "GET", "/api/me/settings-context");
    expect(context.status).toBe(200);
    expect(context.body).toHaveProperty("profile");
    expect(JSON.stringify(context.body)).not.toMatch(/password_hash|bearer_token|credential|secret/i);
    expect((context.body.editable_fields as unknown[])).toEqual(["name", "email", "phone"]);
    expect((await as(alice, "PATCH", "/api/preferences", { unexpected: true })).status).toBe(400);
    expect((await as(alice, "PATCH", "/api/preferences", { theme: "neon" })).status).toBe(400);
    expect((await as(alice, "PATCH", "/api/preferences", { notifications: "yes" })).status).toBe(400);
    expect((await as(alice, "PATCH", "/api/preferences", { default_brand: "NOT_A_BRAND" })).status).toBe(400);
  });

  it("saves only current authorized defaults and rejects expiry, revocation and fallback", async () => {
    const stamp = nowIso();
    getConn().prepare(`INSERT INTO mailbox_owners(email,brand,owner_name,account_type,status) VALUES (?,?,?,?,?)`)
      .run("owned@litime.test", "LT", "Alice", "personal", "active");
    for (const [email, isDefault] of [["owned@litime.test", 0], ["other@litime.test", 1]] as const) {
      getConn().prepare(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,mailbox_id,status,updated_at) VALUES (?,?,?,?,?,?)`)
        .run(alice.id, email, isDefault, email, "connected", stamp);
    }
    const saved = await as(alice, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "owned@litime.test", theme: "dark" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ default_brand: "LT", default_mailbox: "owned@litime.test", theme: "dark" });
    expect((await as(bob, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "owned@litime.test" })).status).toBe(400);
    getConn().prepare("UPDATE user_starry_bindings SET status='expired' WHERE user_id=? AND mailbox_email=?").run(alice.id, "owned@litime.test");
    expect((await as(alice, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "owned@litime.test" })).status).toBe(400);
    const expired = await as(alice, "GET", "/api/preferences");
    expect(expired.body.default_mailbox).toBe("");
    expect((await as(alice, "PATCH", "/api/preferences", { analytics_cookies: true })).status).toBe(200);
    getConn().prepare("UPDATE user_starry_bindings SET status='connected' WHERE user_id=? AND mailbox_email=?").run(alice.id, "owned@litime.test");
    expect((await as(alice, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "owned@litime.test" })).status).toBe(200);
    getConn().prepare("UPDATE users SET brands='[]' WHERE id=?").run(alice.id);
    expect((await as(alice, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "owned@litime.test" })).status).toBe(400);
    getConn().prepare("UPDATE users SET brands='[\"LT\"]' WHERE id=?").run(alice.id);
    expect((await as(alice, "DELETE", "/api/me/starry-binding?mailbox_email=owned%40litime.test")).status).toBe(200);
    const bindings = getConn().prepare("SELECT is_default FROM user_starry_bindings WHERE user_id=?").all(alice.id) as Array<{ is_default: number }>;
    expect(bindings).toEqual([{ is_default: 0 }]);
    expect((await as(alice, "GET", "/api/preferences")).body.default_mailbox).toBe("");
  });

  it("does not grant a default mailbox from preferences, promotes no fallback, and isolates sessions/memory", async () => {
    const stamp = nowIso();
    getConn().prepare(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,mailbox_id,status,updated_at)
      VALUES (?,?,?,?,?,?)`).run(alice.id, "one@example.test", 1, "one", "connected", stamp);
    getConn().prepare(`INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,mailbox_id,status,updated_at)
      VALUES (?,?,?,?,?,?)`).run(alice.id, "two@example.test", 0, "two", "connected", stamp);
    // No mailbox owner / sender PEP fact: even an owned connected binding cannot be selected.
    expect((await as(alice, "PATCH", "/api/preferences", { default_brand: "LT", default_mailbox: "one@example.test" })).status).toBe(400);
    getConn().prepare(`INSERT INTO sessions(id,title,created_at,updated_at,kind,owner_user_id,archived_at)
      VALUES (?,?,?,?,?,?,?)`).run("alice-active", "Alice active", stamp, stamp, "chat", alice.id, null);
    getConn().prepare(`INSERT INTO sessions(id,title,created_at,updated_at,kind,owner_user_id,archived_at)
      VALUES (?,?,?,?,?,?,?)`).run("alice-archived", "Alice archived", stamp, stamp, "chat", alice.id, stamp);
    getConn().prepare(`INSERT INTO sessions(id,title,created_at,updated_at,kind,owner_user_id)
      VALUES (?,?,?,?,?,?)`).run("bob-session", "Bob secret", stamp, stamp, "chat", bob.id);
    const sessions = await as(alice, "GET", "/api/me/settings-sessions");
    expect(sessions.status).toBe(200);
    expect((sessions.body as unknown as unknown[]).map((row) => (row as Record<string, unknown>).id)).toEqual(["alice-active", "alice-archived"]);
    getConn().prepare(`INSERT INTO memory_entries(id,owner_user_id,title,body_md,scope,enabled,version,created_at,updated_at)
      VALUES (?,?,?,?,?,1,1,?,?)`).run("bob-team", bob.id, "old team", "never exposed", "team", stamp, stamp);
    const memory = await as(alice, "GET", "/api/memory");
    expect(memory.status).toBe(200);
    expect(JSON.stringify(memory.body)).not.toContain("never exposed");
    expect((await as(alice, "POST", "/api/memory", { scope: "team", title: "new" })).status).toBe(409);
  });

  it("locks enterprise profile fields while retaining no-op compatibility", async () => {
    // The settings context ensures the runtime organization tables exist on this fresh PG clone.
    expect((await as(alice, "GET", "/api/me/settings-context")).status).toBe(200);
    const stamp = nowIso();
    getConn().prepare(`INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run("person:alice", "Alice", alice.id, "active", stamp, stamp);
    expect((await as(alice, "PATCH", "/api/me", { name: "Changed" })).status).toBe(403);
    expect((await as(alice, "PATCH", "/api/me", { name: "Alice", email: alice.email, phone: "" })).status).toBe(200);
  });
});
