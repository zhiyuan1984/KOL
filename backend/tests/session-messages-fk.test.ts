import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, isSqliteForeignKeyError, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { ingestKolMail } from "../src/host/kol-journey.js";
import { insertSessionMessage, isSessionNotFound } from "../src/host/session-messages.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

function rawInsertMessage(sid: string): void {
  getConn().prepare(
    "INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)",
  ).run("msg_orphan_fk", sid, "assistant", "assistant", JSON.stringify({ text: "fk" }), new Date().toISOString());
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-msg-fk-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
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

describe("messages.session_id foreign key", () => {
  it("raw INSERT still enforces FK when session_id is missing", () => {
    const fk = getConn().pragma("foreign_keys");
    const enabled = Array.isArray(fk)
      ? fk.some((row) => Number((row as { foreign_keys?: number }).foreign_keys ?? Object.values(row as object)[0]) === 1)
      : Number(fk) === 1 || String(fk).includes("1");
    expect(enabled, "foreign_keys must stay ON").toBe(true);

    let thrown: unknown;
    try {
      rawInsertMessage("ses_does_not_exist");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeTruthy();
    expect(isSqliteForeignKeyError(thrown)).toBe(true);
    expect(String(thrown)).toMatch(/FOREIGN KEY constraint failed/i);
  });

  it("insertSessionMessage fail-closes with session_not_found instead of SqliteError", async () => {
    let thrown: unknown;
    try {
      insertSessionMessage("ses_does_not_exist", "assistant", "confirm_stage_card", {
        text: "would have crashed Host",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpFail);
    expect(isSessionNotFound(thrown)).toBe(true);
    expect(isSqliteForeignKeyError(thrown)).toBe(false);
    const fail = thrown as HttpFail;
    expect(fail.status).toBe(404);
    expect(fail.detail).toMatchObject({
      code: "session_not_found",
      session_id: "ses_does_not_exist",
    });

    const health = await request("GET", "/api/health");
    expect(health.status).toBe(200);
    expect((await health.json()).ok).toBe(true);
  });

  it("writes a message when the session exists", async () => {
    const created = await request("POST", "/api/sessions", { title: "fk-ok" });
    expect(created.status).toBe(200);
    const sid = String((await created.json()).id || "");
    const row = insertSessionMessage(sid, "assistant", "assistant", { text: "会话仍在" });
    expect(row.session_id).toBe(sid);
    expect(row.kind).toBe("assistant");
    const stored = getConn().prepare("SELECT kind FROM messages WHERE id=?").get(row.id) as { kind: string };
    expect(stored.kind).toBe("assistant");
  });

  it("POST /sessions/:sid/messages on a missing sid returns 404 and Host stays up", async () => {
    const missing = await request("POST", "/api/sessions/ses_ghost/messages", {
      text: "记状态",
      intent: "confirm_stage",
    });
    expect(missing.status).toBe(404);
    const body = await missing.json();
    expect(JSON.stringify(body)).toMatch(/session not found/i);

    const health = await request("GET", "/api/health");
    expect(health.status).toBe(200);
    const created = await request("POST", "/api/sessions", { title: "after-miss" });
    expect(created.status).toBe(200);
    const sid = String((await created.json()).id || "");
    const ok = await request("POST", `/api/sessions/${sid}/messages`, { text: "你好" });
    expect(ok.status, await ok.text()).toBe(200);
  });

  it("ingestKolMail with a stale session_id fails closed and does not crash", async () => {
    let thrown: unknown;
    try {
      ingestKolMail("col_xiaomei", {
        subject: "Re: collab",
        body: "interested",
        session_id: "ses_stale_from_other_datadir",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpFail);
    expect(isSessionNotFound(thrown)).toBe(true);
    expect(isSqliteForeignKeyError(thrown)).toBe(false);

    const viaApi = await request("POST", "/api/collaborations/col_xiaomei/ingest-mail", {
      subject: "Re: collab",
      body: "interested",
      session_id: "ses_stale_from_other_datadir",
    });
    expect(viaApi.status).toBe(404);
    expect(await viaApi.json()).toMatchObject({
      detail: {
        code: "session_not_found",
        session_id: "ses_stale_from_other_datadir",
      },
    });

    const health = await request("GET", "/api/health");
    expect(health.status).toBe(200);
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(opened.status).toBe(200);
    const sid = String((await opened.json()).id || "");
    expect(sid).toMatch(/^ses_/);
    const live = insertSessionMessage(sid, "assistant", "confirm_stage_card", {
      collaboration_id: "col_xiaomei",
      proposed_stage: "INTERESTED",
    });
    expect(live.kind).toBe("confirm_stage_card");
  });
});
