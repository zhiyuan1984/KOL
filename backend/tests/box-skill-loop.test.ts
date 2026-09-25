import { getConn } from "../src/db.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setIntentLlmFetch } from "../src/tasks/openai-intent.js";

type Json = Record<string, unknown>;
let tmp = "";
let app: Hono;

const LARRY = "larry.zhao@amperetime.com";
const QQ = "100705721@qq.com";
const FIRST_TOUCH = `首封建联 发件: ${LARRY} 收件: ${QQ} 主题: LiTime MCP 连通测试`;

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-box-loop-"));
  process.env.LINGONG_DB = path.join(tmp, "box.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.INTENT_LLM_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.INTENT_LLM_MODE;
});

describe("box loop: 起箱 → 识别 → skill → 追问/工具", () => {
  it("starts a box and completes labeled 首封建联 without asking inbox questions", async () => {
    const created = await request("POST", "/api/sessions", { title: "连通测试" });
    expect(created.status).toBeLessThan(300);
    const posted = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: FIRST_TOUCH,
      act: "ask",
    });
    expect(posted.status).toBe(200);
    const rows = (posted.body.messages as Array<{ kind: string; payload?: Json }>) || [];
    expect(rows.some((row) => row.kind === "me")).toBe(true);
    const supplement = rows.find((row) => row.kind === "supplement_card");
    expect(supplement).toBeUndefined();
    expect(rows.some((row) => row.kind === "task_result_card" || row.kind === "error_card")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/是否合作邮箱|查收件箱/);
  });

  it("routes chat 确认发送 to the right-rail snapshot instead of sending", async () => {
    const created = await request("POST", "/api/sessions", { title: "连通测试发送" });
    const previewed = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: FIRST_TOUCH,
      act: "ask",
    });
    expect(previewed.status).toBe(200);
    const previewCard = ((previewed.body.messages as Array<{ kind: string; payload?: Json }>) || [])
      .find((row) => row.kind === "task_result_card");
    expect(previewCard?.payload?.skill).toBe("email_compose");
    expect(JSON.stringify(previewCard)).toContain("确认发送");
    const sent = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: "确认发送",
      act: "ask",
    });
    expect(sent.status).toBe(200);
    const rows = (sent.body.messages as Array<{ kind: string; payload?: Json }>) || [];
    const card = [...rows].reverse().find((row) => row.kind === "task_result_card");
    expect(card?.payload).toMatchObject({ skill: "email_compose" });
    expect(sent.body).toMatchObject({ needs_confirmation: true, sent: false });
    expect(JSON.stringify(rows)).toContain("请在右栏草稿");
    expect(JSON.stringify(card?.payload?.starrykol_data || {})).not.toMatch(/"sent":true/);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get()).toMatchObject({ n: 0 });
    const another = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: "加一封",
      act: "ask",
    });
    expect(another.status).toBe(200);
    const nextRows = (another.body.messages as Array<{ kind: string; payload?: Json }>) || [];
    const nextCard = [...nextRows].reverse().find((row) => row.kind === "task_result_card");
    expect(nextCard?.payload?.skill).toBe("email_compose");
    expect(String(nextCard?.payload?.summary || "")).toContain("确认发送");
    expect(JSON.stringify(nextCard?.payload?.starrykol_data || {})).not.toMatch(/"sent":true/);
    expect(JSON.stringify(nextCard)).toContain("Re: LiTime MCP 连通测试");
  });

  it("loads the compose skill and asks in the box when 首封建联 is missing fields", async () => {
    const created = await request("POST", "/api/sessions", { title: "首封" });
    const posted = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: "首封建联",
      act: "ask",
    });
    expect(posted.status).toBe(200);
    const rows = (posted.body.messages as Array<{ kind: string; payload?: Json }>) || [];
    const asked = rows.find((row) => row.kind === "supplement_card" || row.kind === "task_result_card");
    expect(asked).toBeTruthy();
    expect(JSON.stringify(asked)).toMatch(/发件邮箱|收件邮箱|主题/);
    expect(JSON.stringify(rows)).not.toMatch(/是否合作邮箱|查收件箱/);
  });

  it("asks for direction in the box when the utterance is vague", async () => {
    const created = await request("POST", "/api/sessions", { title: "闲聊" });
    const posted = await request("POST", `/api/sessions/${created.body.id}/messages`, {
      text: "帮我看看这个",
      act: "ask",
    });
    expect(posted.status).toBe(200);
    const supplement = ((posted.body.messages as Array<{ kind: string; payload?: Json }>) || [])
      .find((row) => row.kind === "supplement_card");
    expect(supplement?.payload).toMatchObject({ clarification_kind: "direction" });
  });
});

describe("box loop: API key is enough to recognize", () => {
  it("does not block on Codex when OPENAI_API_KEY works", async () => {
    const prevMode = process.env.INTENT_LLM_MODE;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevPath = process.env.PATH;
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-intent";
    process.env.PATH = path.join(tmp, "emptybin");
    fs.mkdirSync(process.env.PATH, { recursive: true });
    delete process.env.CODEX_BIN;
    setIntentLlmFetch(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        task_type: "email_compose",
        confidence: 0.96,
        entities: { mailboxEmail: LARRY, to: [QQ], subject: "LiTime MCP 连通测试" },
        missing_fields: [],
        clarification_kind: "none",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const created = await request("POST", "/api/sessions", { title: "密钥识别" });
      const posted = await request("POST", `/api/sessions/${created.body.id}/messages`, {
        text: FIRST_TOUCH,
        act: "ask",
      });
      expect(posted.status).toBe(200);
      const rows = (posted.body.messages as Array<{ kind: string; payload?: Json }>) || [];
      const blocked = rows.find((row) => row.kind === "error_card" && String(row.payload?.message || "").includes("识别服务未就绪"));
      expect(blocked).toBeUndefined();
      expect(JSON.stringify(rows)).not.toMatch(/codex login/);
    } finally {
      setIntentLlmFetch();
      if (prevMode === undefined) delete process.env.INTENT_LLM_MODE;
      else process.env.INTENT_LLM_MODE = prevMode;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
    }
  });
});
