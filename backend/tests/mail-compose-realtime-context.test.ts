/**
 * 写合作邮件实时上下文：发件箱 / 收件人不依赖合作对象。
 *
 * 成功标准（2026-10-07 需求）：首页什么都不选点「写合作邮件」→
 * 发件箱取本人挂载的默认邮箱，收件人取最近真实往来的对方，每项标出来源，
 * 输入框不再出现 [发件邮箱]/[收件邮箱] 占位符。
 *
 * 运行环境：配了 TEST_DATABASE_URL 就走 PostgreSQL 真库（freshTestDatabase），
 * 否则走本机 SQLite（与 context-resolve.test.ts 同一模式）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
import {
  approveKnowledge,
  cite,
  createKnowledge,
  knowledgeRow,
} from "../src/host/knowledge.js";

type Json = Record<string, unknown>;

const hasPostgres = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

let tmp: string;
let app: Hono;

async function prepareNoCollab(input: Json = {}): Promise<{ status: number; text: string; body: Json }> {
  const response = await app.request("/api/actions/mail.prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill_id: "email_compose", ...input }),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? (JSON.parse(text) as Json) : {} };
}

function bindMailbox(email: string, brand: string, isDefault: boolean): void {
  const conn = getConn();
  const now = new Date().toISOString();
  conn.prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x",
    JSON.stringify(["employee", "admin"]), JSON.stringify([brand]), DEMO_USER.site, 1, now, now,
  );
  conn.prepare(
    `INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, status, updated_at)
     VALUES (?,?,?,'connected',?)`,
  ).run(DEMO_USER.id, email, isDefault ? 1 : 0, now);
  conn.prepare(
    `INSERT OR REPLACE INTO mailbox_owners (email, brand, owner_name, account_type, status)
     VALUES (?,?,?,?,'active')`,
  ).run(email, brand, DEMO_USER.name, "personal");
}

function clearBindings(): void {
  getConn().prepare("DELETE FROM user_starry_bindings WHERE user_id=?").run(DEMO_USER.id);
}

function insertThread(input: {
  id: string;
  mailbox: string;
  conversation_id: string;
  peer_email: string;
  last_at: string;
  collaboration_id?: string | null;
}): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT INTO kol_mail_threads (id, collaboration_id, conversation_id, subject, mailbox,
       last_at, created_at, updated_at, peer_email, match_state)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id, input.collaboration_id || null, input.conversation_id, "往来主题",
    input.mailbox, input.last_at, now, now, input.peer_email, input.collaboration_id ? "matched" : "unbound",
  );
}

function writePersonDigest(mailbox: string, peerEmail: string, text: string, mailCount: number): void {
  getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?,?)").run(
    `mail_person_digest:${mailbox}:${peerEmail}`,
    JSON.stringify({ text, source: "memory", mail_count: mailCount, fingerprint: "fp1" }),
  );
}

function insertCollab(input: { id: string; handle: string; email: string; brand?: string; stage?: string }): void {
  getConn().prepare(
    `INSERT INTO collaborations (id, handle, display_name, brand, email, mailbox_from, lifecycle_id, conversation_id, stage_code)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id, input.handle, input.handle, input.brand || "LT", input.email,
    "", "", "", input.stage || "INITIAL_CONTACT",
  );
}

function addPublishedTemplate(input: { id: string; brand?: string; stages?: string[] }): void {
  createKnowledge({
    id: input.id,
    title: input.id,
    body: "template source",
    kind: "mail_template",
    base_id: "kbase_legacy",
    skill_id: "email_compose",
    brand: input.brand || "LT",
    subject: "Subject for [红人]",
    body_en: "Body for [红人].",
    placeholders: ["[红人]"],
    stage_codes: input.stages || ["INITIAL_CONTACT"],
    status: "draft",
  });
  approveKnowledge(input.id, Number(knowledgeRow(input.id).current_version || 1));
  cite(input.id);
}

beforeEach(async () => {
  if (hasPostgres) await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-compose-rtctx-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "test.db"),
    LINGONG_DATA: tmp,
    LG_DATA_DIR: tmp,
  });
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
  clearBindings();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("无合作对象时的收发件准备", () => {
  it("a. 发件取挂载默认邮箱，收件取最近真实往来，均标出来源并带出摘要", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertThread({
      id: "th_old", mailbox: "m@litime.com", conversation_id: "conv_old",
      peer_email: "old@gmail.com", last_at: "2026-10-01T10:00:00.000Z",
    });
    insertThread({
      id: "th_new", mailbox: "m@litime.com", conversation_id: "conv_new",
      peer_email: "kol@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });
    writePersonDigest("m@litime.com", "kol@gmail.com", "对方问报价，未回", 3);

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    expect(response.body.status).toBe("needs_context");
    const editor = response.body.editor as Json;
    expect(String(editor.from)).toBe("m@litime.com");
    expect(editor.to).toEqual(["kol@gmail.com"]);
    // 输入框里不再是占位符：主题正文为空，但收发件已填
    expect(String(editor.subject || "")).toBe("");
    const sources = response.body.sources as Json;
    expect(String(sources.from || "")).toContain("挂载");
    expect(String(sources.to || "")).toContain("往来");
    expect(String(response.body.digest || "")).toBe("对方问报价，未回");
    expect(Number(response.body.mail_count)).toBe(3);
    expect(response.body.missing_fields).toContain("collaboration_id");
  });

  it("b. 最近往来已匹配到范围内唯一合作时，采用该合作并走正常模板流程", async () => {
    bindMailbox("m@litime.com", "LT", true);
    addPublishedTemplate({ id: "tpl_first_touch" });
    insertThread({
      id: "th_xiaomei", mailbox: "m@litime.com", conversation_id: "conv_xiaomei",
      peer_email: "xiaomei.beauty@example.com", last_at: "2026-10-06T10:00:00.000Z",
      collaboration_id: "col_xiaomei",
    });

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    expect(response.body.status).toBe("ready");
    expect((response.body.context as Json).collaboration_id).toBe("col_xiaomei");
    const editor = response.body.editor as Json;
    expect(editor.to).toEqual(["xiaomei.beauty@example.com"]);
    expect(response.body.template).toBeTruthy();
  });

  it("c. 通讯页带 mailbox + conversation_id 时收发件取所选", async () => {
    bindMailbox("a@litime.com", "LT", true);
    bindMailbox("b@litime.com", "LT", false);
    insertThread({
      id: "th_b", mailbox: "b@litime.com", conversation_id: "conv_b",
      peer_email: "peer@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });

    const response = await prepareNoCollab({ mailbox: "b@litime.com", conversation_id: "conv_b" });
    expect(response.status, response.text).toBe(200);
    const editor = response.body.editor as Json;
    expect(String(editor.from)).toBe("b@litime.com");
    expect(editor.to).toEqual(["peer@gmail.com"]);
    const sources = response.body.sources as Json;
    expect(String(sources.from || "")).toContain("选中");
  });

  it("d. 选中的会话不属于本人邮箱时拒绝", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertThread({
      id: "th_other", mailbox: "other@evil.com", conversation_id: "conv_other",
      peer_email: "peer@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });

    const response = await prepareNoCollab({ conversation_id: "conv_other" });
    expect(response.status).toBe(400);
    expect(String((response.body.detail as Json)?.code || response.body.code || "")).toMatch(/conversation|mailbox/);
  });

  it("e. 挂了多只且没有默认时发件留空并返回候选，不取第一只", async () => {
    bindMailbox("a@litime.com", "LT", false);
    bindMailbox("b@litime.com", "LT", false);

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    const editor = response.body.editor as Json;
    expect(String(editor.from || "")).toBe("");
    const candidates = (response.body.sender_candidates as Array<{ email: string }>) || [];
    expect(candidates.map((c) => c.email).sort()).toEqual(["a@litime.com", "b@litime.com"]);
  });

  it("f. 往来里只有 noreply 或本人时收件留空并如实说明缺口", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertThread({
      id: "th_nr", mailbox: "m@litime.com", conversation_id: "conv_nr",
      peer_email: "noreply@service.com", last_at: "2026-10-06T10:00:00.000Z",
    });
    insertThread({
      id: "th_self", mailbox: "m@litime.com", conversation_id: "conv_self",
      peer_email: "m@litime.com", last_at: "2026-10-05T10:00:00.000Z",
    });

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    const editor = response.body.editor as Json;
    expect(editor.to).toEqual([]);
    expect(String(response.body.message || "")).toContain("收件");
  });

  it("g. 口令里写明的收件地址优先于往来记忆", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertThread({
      id: "th_mem", mailbox: "m@litime.com", conversation_id: "conv_mem",
      peer_email: "memory@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });

    const response = await prepareNoCollab({ text: "写合作邮件 发件邮箱：m@litime.com 收件邮箱：boss@brand.com 主题：合作" });
    expect(response.status, response.text).toBe(200);
    const editor = response.body.editor as Json;
    expect(editor.to).toEqual(["boss@brand.com"]);
    expect(String((response.body.sources as Json).to || "")).toContain("口令");
  });

  it("h. 同一收件邮箱对应多个合作时不猜，采用 needs_context", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertCollab({ id: "col_a", handle: "kol_a", email: "twin@gmail.com" });
    insertCollab({ id: "col_b", handle: "kol_b", email: "twin@gmail.com" });
    insertThread({
      id: "th_twin", mailbox: "m@litime.com", conversation_id: "conv_twin",
      peer_email: "twin@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    // 收件人照样带出，但合作不猜：status 保持 needs_context 且无 collaboration_id
    expect(response.body.status).toBe("needs_context");
    const editor = response.body.editor as Json;
    expect(editor.to).toEqual(["twin@gmail.com"]);
    expect((response.body.context as Json).collaboration_id).toBeUndefined();
    expect(response.body.missing_fields).toContain("collaboration_id");
  });

  it("i. 口令里写明的收件地址是本人/系统地址时留空并说明", async () => {
    bindMailbox("m@litime.com", "LT", true);

    const selfResp = await prepareNoCollab({ text: "写合作邮件 收件邮箱：m@litime.com 主题：合作" });
    expect(selfResp.status).toBe(400);

    const sysResp = await prepareNoCollab({ text: "写合作邮件 收件邮箱：noreply@litime.com 主题：合作" });
    expect(sysResp.status).toBe(400);
  });

  it("j. 有合作但无适用模板时 needs_template 仍带回 editor/sources/候选", async () => {
    bindMailbox("m@litime.com", "LT", true);
    insertCollab({ id: "col_solo", handle: "solo", email: "solo@gmail.com" });
    // 不发布任何模板
    insertThread({
      id: "th_solo", mailbox: "m@litime.com", conversation_id: "conv_solo",
      peer_email: "solo@gmail.com", last_at: "2026-10-06T10:00:00.000Z",
    });

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    // 唯一合作被采用
    expect((response.body.context as Json).collaboration_id).toBe("col_solo");
    expect(response.body.status).toBe("needs_template");
    const editor = response.body.editor as Json;
    expect(String(editor.from)).toBe("m@litime.com");
    expect(editor.to).toEqual(["solo@gmail.com"]);
    expect(response.body.sources).toBeTruthy();
  });

  it("k. 绑定的个人企业邮箱（非品牌邮箱、无 mailbox_owners 登记）直接作为发件箱", async () => {
    // 复现生产问题：用户绑定 larry.zhao@amperetime.com（非品牌邮箱），
    // 发件箱不应因品牌核对失败而留空。绑定即授权。
    const conn = getConn();
    const now = new Date().toISOString();
    conn.prepare(
      `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x",
      JSON.stringify(["employee", "admin"]), JSON.stringify(["LT"]), DEMO_USER.site, 1, now, now,
    );
    // 只绑个人邮箱，不写 mailbox_owners（模拟真实绑定：非品牌域名无品牌登记）
    conn.prepare(
      `INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, status, updated_at)
       VALUES (?,?,1,'connected',?)`,
    ).run(DEMO_USER.id, "larry.zhao@amperetime.com", now);

    const response = await prepareNoCollab();
    expect(response.status, response.text).toBe(200);
    const editor = response.body.editor as Json;
    expect(String(editor.from)).toBe("larry.zhao@amperetime.com");
    expect(String((response.body.sources as Json).from || "")).toContain("挂载");
  });
});
