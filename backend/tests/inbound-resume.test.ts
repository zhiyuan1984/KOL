import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { inboundIdentity } from "../src/host/inbound-identity.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-inbound-"));
  process.env.LINGONG_DB = path.join(tmp, "inbound.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("inbound list resume and identity", () => {
  it("lists the inbound table with cursor paging and can resume a deferred row", async () => {
    const listed = await request("GET", "/api/inbound?limit=1");
    expect(listed.status).toBe(200);
    expect(listed.body.table).toBe("inbound");
    const items = listed.body.items as Json[];
    expect(items.length).toBe(1);
    expect(items[0].id).toBe("inb_unbound_1");

    const deferred = await request("POST", "/api/inbound/inb_unbound_1/defer");
    expect(deferred.body).toMatchObject({ ok: true, deferred: true, resumed: false });
    const waiting = await request("GET", "/api/inbound?deferred=1");
    expect((waiting.body.items as Json[]).map((row) => row.id)).toContain("inb_unbound_1");

    const resumed = await request("POST", "/api/inbound/inb_unbound_1/resume");
    expect(resumed.body).toMatchObject({ ok: true, deferred: false, resumed: true });
    const active = await request("GET", "/api/inbound?deferred=0");
    expect((active.body.items as Json[]).map((row) => row.id)).toContain("inb_unbound_1");
  });

  it("pages with a cursor instead of a hard 200-row slice", async () => {
    const db = getConn();
    for (let i = 0; i < 3; i += 1) {
      db.prepare(
        `INSERT INTO inbound (id, from_addr, subject, snippet, bound, deferred, ts)
         VALUES (?,?,?,?,0,0,?)`,
      ).run(`inb_page_${i}`, `p${i}@example.com`, `s${i}`, "x", `2026-09-0${7 - i}T00:00:00+00:00`);
    }
    const first = await request("GET", "/api/inbound?limit=2");
    expect((first.body.items as Json[]).length).toBe(2);
    expect(first.body.next_cursor).toBeTruthy();
    const second = await request("GET", `/api/inbound?limit=2&cursor=${encodeURIComponent(String(first.body.next_cursor))}`);
    expect((second.body.items as Json[]).length).toBeGreaterThan(0);
    const firstIds = new Set((first.body.items as Json[]).map((row) => String(row.id)));
    expect((second.body.items as Json[]).some((row) => firstIds.has(String(row.id)))).toBe(false);
  });

  it("treats webhook message id and fingerprint as the same letter", async () => {
    const keys = inboundIdentity({
      provider_message_id: "msg-starry-9",
      collaboration_id: "col_xiaomei",
      subject: "Re: weekend",
      body: "thanks",
    });
    expect(keys.seen_keys).toContain("mid:msg-starry-9");
    const first = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: weekend",
      body: "thanks",
      provider_message_id: "msg-starry-9",
    });
    expect(first.body.duplicate).not.toBe(true);
    const again = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Different subject",
      body: "other body",
      provider_message_id: "msg-starry-9",
    });
    expect(again.body.duplicate).toBe(true);
  });

  it("rejects a non-integer expected_version instead of coercing it to 0", async () => {
    const bad = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "INTERESTED",
      expected_version: "",
      reason: "empty version must not become 0",
    });
    expect(bad.status).toBe(200);
    const again = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "EVALUATING",
      expected_version: "not-a-number",
      reason: "invalid",
    });
    expect(again.status).toBe(400);
  });

  it("puts unbound inbound on the lifecycle-kanban session for a human to bind", async () => {
    const opened = await request("POST", "/api/sessions", { title: "合作生命周期看板" });
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "合作生命周期看板",
      content: "合作生命周期看板",
      act: "ask",
      intent: "creator_lifecycle_kanban",
    });
    expect(posted.status).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    const inbound = messages.find((row) => row.kind === "inbound_card");
    expect(inbound?.payload.inbound_id).toBe("inb_unbound_1");
    expect(JSON.stringify(inbound?.payload || "")).toMatch(/vanlife\.kit@example.com/);
    expect(messages.some((row) => row.kind === "sys_msg" && /无法判断，请人选阶段/.test(String(row.payload.text || "")))).toBe(true);
  });
});
