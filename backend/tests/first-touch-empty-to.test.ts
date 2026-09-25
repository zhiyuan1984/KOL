import { confirmAndSendDraft } from "./helpers/confirmed-mail.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES, PERSONAS } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { persistDraft } from "../src/host/api.js";
import { enforceSend } from "../src/host/pep.js";
import { seedAll } from "../src/seed.js";
import type { Json, Row } from "../src/types.js";

let tmp = "";
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

async function ask(prompt: string, extra: Json = {}, expectStatus = 200) {
  const session = await request("POST", "/api/sessions", { title: prompt.slice(0, 40) });
  const listed = await request("POST", `/api/sessions/${session.body.id}/messages`, {
    text: prompt,
    content: prompt,
    act: "ask",
    model_tier: "default",
    ...extra,
  });
  expect(listed.status, JSON.stringify(listed.body)).toBe(expectStatus);
  return [String(session.body.id), listed.body] as const;
}

function cite(knowledgeId: string): void {
  getConn().prepare(
    "INSERT OR REPLACE INTO knowledge_citations (user_id, knowledge_id, cited_at) VALUES (?,?,?)",
  ).run(PERSONAS.sriphy.id, knowledgeId, new Date().toISOString());
}

function insertQiyou(email = ""): string {
  const id = "col_KOL20260901LINGONG";
  getConn().prepare(
    `INSERT OR REPLACE INTO collaborations
     (id, handle, display_name, brand, platform, followers, email, mailbox_from,
      lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,
      stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    "灵工连通测试-qiyou1984",
    "灵工连通测试-qiyou1984",
    "LT",
    "YouTube",
    "",
    email,
    BRAND_MAILBOXES.LT,
    "lc_KOL20260901LINGONG",
    "conv_KOL20260901LINGONG",
    "INITIAL_CONTACT",
    1,
    "居家办公；储能",
    0,
    0,
    "",
    "",
    "",
    "美国",
    "",
    "",
    "",
    0,
  );
  getConn().prepare("UPDATE collaborations SET kol_uid=? WHERE id=?").run("KOL20260901LINGONG", id);
  return id;
}

describe("first-touch To cannot stay empty for 灵工连通测试-qiyou1984", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qiyou-to-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.LG_DATA_DIR = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  afterEach(() => {
    getConn().close();
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("asks Starry MCP for 发件/收件/主题 instead of creating a sendable empty-To draft", async () => {
    const id = insertQiyou("");
    const [, data] = await ask("首封建联 发送给 灵工连通测试-qiyou1984", {
      intent: "email_compose",
      collaboration_id: id,
    });
    expect(data.draft).toBeFalsy();
    const card = ((data.messages as Json[]) || []).find((row) => row.kind === "task_result_card" || row.kind === "supplement_card") as Json;
    expect(card).toBeTruthy();
    const payload = JSON.stringify(card.payload);
    expect(payload).toContain("发件邮箱");
    expect(payload).toContain("收件邮箱");
    expect(payload).toContain("邮件主题");
    expect(payload).not.toContain("邮件会话");
    expect(JSON.stringify(data)).not.toMatch(/decryptKolContact|qiyou1984@gmail\.com/);
  });

  it("does not put larry.zhao into Host draft To when the prompt also has a KOL inbox", async () => {
    cite("kb_mail_kol");
    const [, data] = await ask(
      "首封建联 发件箱 larry.zhao@amperetime.com 发给 qiyou1984@gmail.com 主题：LiTime Mini 12V — weekend van test",
      { intent: "email_compose", knowledge_id: "kb_mail_kol" },
    );
    const draft = data.draft as Json | null;
    expect(String(draft?.to_addr || draft?.to || "")).not.toBe("larry.zhao@amperetime.com");
    const blob = JSON.stringify(data);
    expect(blob).toContain("qiyou1984@gmail.com");
    expect(blob).not.toContain("还需要补充：邮件会话");
    expect(blob).not.toMatch(/当前 Starry KOL MCP 账号/);
    const card = ((data.messages as Json[]) || []).find((row) => row.kind === "task_result_card") as Json | undefined;
    const email = ((data.messages as Json[]) || []).find((row) => row.kind === "email_card") as Json | undefined;
    if (card) {
      expect(JSON.stringify(card.payload)).toContain("发件邮箱：larry.zhao@amperetime.com");
      expect(JSON.stringify(card.payload)).toContain("收件邮箱：qiyou1984@gmail.com");
    } else if (email) {
      expect(String((email.payload as Json).to)).toBe("qiyou1984@gmail.com");
    } else {
      throw new Error("expected a compose result or Host draft");
    }
  });

  it("does not fall back to a Host draft when 首封建联 is missing 发件箱", async () => {
    const id = insertQiyou("");
    cite("kb_mail_kol");
    const [, data] = await ask(
      "首封建联 发送给 灵工连通测试-qiyou1984 qiyou1984@gmail.com",
      { intent: "email_compose", collaboration_id: id, knowledge_id: "kb_mail_kol" },
    );
    expect(data.draft).toBeFalsy();
    const card = ((data.messages as Json[]) || []).find((row) => row.kind === "task_result_card" || row.kind === "supplement_card") as Json;
    expect(card).toBeTruthy();
    const payload = JSON.stringify(card.payload);
    expect(payload).toContain("发件邮箱");
    expect(payload).toContain("qiyou1984@gmail.com");
    expect(payload).not.toContain("还需要补充：邮件会话");
    const row = getConn().prepare("SELECT email FROM collaborations WHERE id=?").get(id) as { email: string };
    expect(row.email).toBe("");
  });

  it("lets 校验发送原文 supply To on an already empty draft and bind it", async () => {
    const id = insertQiyou("");
    const session = await request("POST", "/api/sessions", { title: "empty-to" });
    const draft = persistDraft(String(session.body.id), {
      skill: "stage_mail",
      template_id: "stage_mail.followup",
      from: BRAND_MAILBOXES.LT,
      to: "",
      subject: "Collaboration Opportunity with LiTime",
      body: "Hi,\n\nWe would love to explore a product collaboration.\n\nBest,\nLiTime Creator Desk\n",
      official_stage: "INITIAL_CONTACT",
      collaboration_id: id,
    });
    expect(String(draft.to_addr)).toBe("");
    const sent = await confirmAndSendDraft(request, `/api/drafts/${draft.id}/send`, {
      to_addr: "qiyou1984@gmail.com",
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const row = getConn().prepare("SELECT email FROM collaborations WHERE id=?").get(id) as { email: string };
    expect(row.email).toBe("qiyou1984@gmail.com");
  });

  it("binds an empty collaboration email on PEP send instead of treating it as a mismatch", () => {
    const id = insertQiyou("");
    enforceSend({
      from_addr: BRAND_MAILBOXES.LT,
      to_addr: "qiyou1984@gmail.com",
      subject: "Collaboration Opportunity with LiTime",
      body_en: "Hi,\n\nWe would love to explore a product collaboration.\n",
      skill: "stage_mail",
      template_id: "stage_mail.followup",
      official_stage: "INITIAL_CONTACT",
      collaboration_id: id,
    } as Row, PERSONAS.sriphy);
    const row = getConn().prepare("SELECT email FROM collaborations WHERE id=?").get(id) as { email: string };
    expect(row.email).toBe("qiyou1984@gmail.com");
  });
});
