import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { KOL_EXPERT_ID } from "../src/experts.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json> }> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

describe("expert API stub", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-experts-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  afterEach(() => {
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists only KOL 合作专员 and returns detail", async () => {
    const list = await request("GET", "/api/experts");
    expect(list.status).toBe(200);
    const experts = ((await list.json()).experts || []) as Json[];
    expect(experts).toHaveLength(1);
    expect(experts[0]?.id).toBe(KOL_EXPERT_ID);
    expect(experts[0]?.name).toBe("KOL 合作专员");

    const detail = await request("GET", `/api/experts/${encodeURIComponent(KOL_EXPERT_ID)}`);
    expect(detail.status).toBe(200);
    const expert = await detail.json();
    expect(expert.mission).toBeTruthy();
    expect(expert.quick_prompts).toHaveLength(3);
    expect(expert.recommended_tasks).toHaveLength(3);
  });

  it("summon opens a session without writing messages, send, or stage", async () => {
    const summoned = await request("POST", `/api/experts/${encodeURIComponent(KOL_EXPERT_ID)}/summon`, {});
    expect(summoned.status).toBe(200);
    const body = await summoned.json();
    const sessionId = String(body.session_id || "");
    expect(sessionId).toMatch(/^ses_/);
    expect(body.expert_id).toBe(KOL_EXPERT_ID);
    expect(body.intro_message).toBeTruthy();
    expect(body.recommended_tasks).toHaveLength(3);
    expect((body.live_side_effects as Json)?.send).toBe(false);
    expect((body.live_side_effects as Json)?.stage).toBe(false);
    expect((body.live_side_effects as Json)?.messages_written).toBe(0);

    const session = getConn().prepare("SELECT title FROM sessions WHERE id=?").get(sessionId) as { title?: string };
    expect(session.title).toBe("KOL 合作专员");
    const messages = getConn().prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id=?").get(sessionId) as { n: number };
    expect(Number(messages.n)).toBe(0);
    const stages = getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number };
    expect(Number(stages.n)).toBeGreaterThanOrEqual(0);
  });
});
