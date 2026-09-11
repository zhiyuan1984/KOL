import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { recognizeTaskIntent, setTaskClassifier } from "../src/tasks/recognize.js";
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-recognize-"));
  process.env.LINGONG_DB = path.join(tmp, "recognize.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.INTENT_LLM_MODE = "stub";
  setTaskClassifier();
  setIntentLlmFetch();
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setTaskClassifier();
  setIntentLlmFetch();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.INTENT_LLM_MODE;
});

describe("Luna task recognition", () => {
  it("always calls the intent classifier, even when catalog titles match", async () => {
    let called = 0;
    setTaskClassifier(async () => {
      called += 1;
      return { task_type: "email_mailbox_list", confidence: 0.99 };
    });
    const result = await recognizeTaskIntent({ text: "品牌邮箱列表" });
    expect(result).toMatchObject({ task_type: "email_mailbox_list", source: "llm" });
    expect(called).toBe(1);
  });

  it("keeps 发件/收件/主题 on 首封建联 and does not ask inbox questions", async () => {
    const result = await recognizeTaskIntent({ text: FIRST_TOUCH });
    expect(result).toMatchObject({
      task_type: "email_compose",
      source: "llm",
      clarification_kind: "none",
      needs_clarification: false,
      missing_fields: [],
    });
    expect(result.entities.mailboxEmail).toBe(LARRY);
    expect(result.entities.to).toEqual([QQ]);
    expect(result.entities.subject).toBe("LiTime MCP 连通测试");
    expect(result.alternatives).toEqual([]);
  });

  it("locks 确认发送 to email_compose and never asks for a task direction", async () => {
    let called = 0;
    setTaskClassifier(async () => {
      called += 1;
      return { task_type: null, confidence: 0.1, clarification_kind: "direction" };
    });
    const result = await recognizeTaskIntent({ text: "确认发送" });
    expect(result).toMatchObject({
      task_type: "email_compose",
      source: "locked",
      entities: { confirm_send: true },
    });
    expect(result.clarification_kind).not.toBe("direction");
    expect(called).toBe(0);
  });

  it("treats bare 首封建联 as missing fields, not a direction picker", async () => {
    const result = await recognizeTaskIntent({ text: "首封建联" });
    expect(result).toMatchObject({
      task_type: "email_compose",
      clarification_kind: "missing_fields",
      needs_clarification: true,
    });
    expect(result.missing_fields).toEqual(["mailboxEmail", "to", "subject"]);
    expect(result.alternatives).toEqual([]);
  });

  it("uses a classifier verdict and rejects unknown ids", async () => {
    setTaskClassifier(async () => ({ task_type: "email_mailbox_list", confidence: 0.88 }));
    const hit = await recognizeTaskIntent({ text: "帮我看看合作用的发信账号现在授权了没有" });
    expect(hit).toMatchObject({
      task_type: "email_mailbox_list",
      source: "llm",
      needs_clarification: false,
    });

    setTaskClassifier(async () => ({ task_type: "not_a_skill", confidence: 0.99 }));
    const rejected = await recognizeTaskIntent({ text: "随便说一句和任务无关的话" });
    expect(rejected.task_type).toBeNull();
    expect(rejected.clarification_kind).toBe("direction");
    expect(rejected.needs_clarification).toBe(true);
  });

  it("exposes POST /api/tasks/recognize without creating a work item", async () => {
    setTaskClassifier(async () => ({ task_type: "email_conversation_list", confidence: 0.91 }));
    const recognized = await request("POST", "/api/tasks/recognize", {
      text: "看看最近有没有人回邮件",
    });
    expect(recognized.status).toBe(200);
    expect(recognized.body).toMatchObject({
      source: "llm",
      task_type: "email_conversation_list",
      needs_clarification: false,
    });
    const listed = await request("GET", "/api/tasks");
    expect((listed.body as unknown as Json[]).some((task) => String(task.title || "").includes("最近有没有人回邮件"))).toBe(false);
  });

  it("lets from-text create a compose task from the operator sentence", async () => {
    const created = await request("POST", "/api/tasks/from-text", { text: FIRST_TOUCH });
    expect(created.status).toBe(201);
    expect((created.body.task as Json).task_type).toBe("email_compose");
    expect((created.body.resolution as Json).clarification_kind).toBe("none");
    expect((created.body.resolution as Json).missing_fields).toEqual([]);
    expect(((created.body.resolution as Json).entities as Json).mailboxEmail).toBe(LARRY);
    expect(((created.body.resolution as Json).entities as Json).to).toEqual([QQ]);
  });

  it("does not split a first-touch sentence that uses 发件/收件/主题", async () => {
    const created = await request("POST", "/api/tasks/from-text", {
      text: `首封建联\n发件: ${LARRY}\n收件: ${QQ}\n主题: LiTime MCP 连通测试`,
    });
    expect(created.status).toBe(201);
    expect((created.body.tasks as Json[]).map((task) => task.task_type)).toEqual(["email_compose"]);
    expect((created.body.resolution as Json).clarification_kind).toBe("none");
  });
});

describe("Codex app-server intent", () => {
  const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.mjs");
  let savedOpenAi = "";
  let savedCodexKey = "";

  beforeEach(async () => {
    fs.chmodSync(fake, 0o755);
    savedOpenAi = process.env.OPENAI_API_KEY || "";
    savedCodexKey = process.env.CODEX_API_KEY || "";
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    process.env.INTENT_LLM_MODE = "real";
    process.env.CODEX_MODE = "real";
    process.env.CODEX_BIN = fake;
    process.env.FAKE_CODEX_MODE = "recognize-success";
    process.env.FAKE_CODEX_DELAY = "30";
    process.env.TASK_RECOGNIZE_TIMEOUT = "5";
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, ".codex");
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    setTaskClassifier();
    setIntentLlmFetch();
  });

  afterEach(() => {
    setTaskClassifier();
    setIntentLlmFetch();
    delete process.env.CODEX_BIN;
    delete process.env.FAKE_CODEX_MODE;
    delete process.env.FAKE_CODEX_DELAY;
    delete process.env.TASK_RECOGNIZE_TIMEOUT;
    if (savedOpenAi) process.env.OPENAI_API_KEY = savedOpenAi;
    else delete process.env.OPENAI_API_KEY;
    if (savedCodexKey) process.env.CODEX_API_KEY = savedCodexKey;
    else delete process.env.CODEX_API_KEY;
    process.env.INTENT_LLM_MODE = "stub";
    process.env.CODEX_MODE = "stub";
  });

  it("routes a Codex-shaped verdict without creating a task", async () => {
    setTaskClassifier(async () => ({
      task_type: "email_mailbox_list",
      confidence: 0.92,
      clarification_kind: "none",
      entities: {},
      missing_fields: [],
    }));
    const result = await recognizeTaskIntent({
      text: "帮我看看合作用的发信账号现在授权了没有",
    });
    expect(result).toMatchObject({
      task_type: "email_mailbox_list",
      source: "llm",
      needs_clarification: false,
    });
  });

  it("fails open to retry copy when Codex is missing", async () => {
    delete process.env.CODEX_BIN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    process.env.PATH = path.join(tmp, "emptybin");
    fs.mkdirSync(process.env.PATH, { recursive: true });
    const result = await recognizeTaskIntent({ text: "随便说一句和任务无关的话" });
    expect(result.task_type).toBeNull();
    expect(result.needs_clarification).toBe(true);
    expect(result.source).toBe("none");
    expect(String(result.error || "")).toContain("识别服务未就绪");
    expect(String(result.next_action || "")).toMatch(/codex login|OPENAI_API_KEY/);
  });

  it("uses GPT-5.6 Luna when OPENAI_API_KEY is set even if Codex is missing", async () => {
    delete process.env.CODEX_BIN;
    process.env.PATH = path.join(tmp, "emptybin");
    fs.mkdirSync(process.env.PATH, { recursive: true });
    process.env.OPENAI_API_KEY = "sk-test-intent";
    setIntentLlmFetch(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        task_type: "email_compose",
        confidence: 0.96,
        entities: { mailboxEmail: LARRY, to: [QQ], subject: "LiTime MCP 连通测试" },
        missing_fields: [],
        clarification_kind: "none",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await recognizeTaskIntent({ text: FIRST_TOUCH });
    expect(result).toMatchObject({
      task_type: "email_compose",
      source: "llm",
      clarification_kind: "none",
    });
    expect(result.error).toBeUndefined();
  });
});
