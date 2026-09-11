import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { publishSession, subscribeSession, subscriberCount } from "../src/host/session-events.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json: text ? (JSON.parse(text) as Json) : {},
    raw: res,
  };
}

describe("session live events", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-stream-"));
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
  });

  it("publishes upserts to subscribers", () => {
    const seen: string[] = [];
    const stop = subscribeSession("ses_x", (ev) => seen.push(ev.type));
    publishSession("ses_x", { type: "status", agent_status: "running" });
    publishSession("ses_y", { type: "status", agent_status: "listening" });
    expect(seen).toEqual(["status"]);
    expect(subscriberCount("ses_x")).toBe(1);
    stop();
    expect(subscriberCount("ses_x")).toBe(0);
  });

  it("SSE snapshot loads the session record then streams an upsert", async () => {
    const created = await request("POST", "/api/sessions", { title: "流式会话" });
    const sid = String((created.json as { id?: string }).id || "");
    expect(sid).toBeTruthy();
    getConn().prepare(
      "INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)",
    ).run("msg_hist", sid, "me", "me", JSON.stringify({ text: "先记一条会话记录" }), new Date().toISOString());
    const res = await app.request(`/api/sessions/${sid}/events`);
    expect(res.status).toBe(200);
    expect(String(res.headers.get("content-type") || "")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const frame = new TextDecoder().decode(first.value);
    expect(frame).toContain("event: snapshot");
    expect(frame).toContain("先记一条会话记录");
    const got = new Promise<string>((resolve) => {
      const stop = subscribeSession(sid, (ev) => {
        if (ev.type === "upsert") {
          stop();
          resolve(String(ev.message?.kind || ""));
        }
      });
    });
    getConn().prepare(
      "INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)",
    ).run("msg_live", sid, "assistant", "assistant", JSON.stringify({ text: "增量" }), new Date().toISOString());
    publishSession(sid, {
      type: "upsert",
      message: { id: "msg_live", kind: "assistant", payload: { text: "增量" } },
    });
    await expect(got).resolves.toBe("assistant");
    await reader!.cancel();
  });
});
