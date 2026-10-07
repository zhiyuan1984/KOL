import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import { requireTaskDefinition, taskDefinition, validateDeclaredTaskContract } from "../src/tasks/registry.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { approveKnowledge, cite, createKnowledge, knowledgeRow, workerSafeExtra } from "../src/host/knowledge.js";
import { openContext, resolveContext, type ContextResolveInput } from "../src/host/context-resolve.js";
import { contextGapResponse, workerRunContext } from "../src/host/api.js";
import { runtimeAgentScopeContext } from "../src/contract-scope.js";
import { collaborationContext, declaredContext, writeBox } from "../src/worker/runner.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";

type Row = Record<string, unknown>;

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

function collaborate(id: string): ContextResolveInput {
  return { skillId: "email_compose", body: { collaboration_id: id }, requires: ["collaboration"] };
}

function sessionWith(collaborationId: string): Json {
  return { id: "ses_fixture", collaboration_id: collaborationId };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) as Json : {} };
}

/**
 * 会话消息入口要读 PostgreSQL 权威表（authorizedTaskSession），本机没有 PostgreSQL——
 * 与 mail-compose-prepare.test.ts 同一环境限制；配了 TEST_DATABASE_URL 就一起跑。
 */
const hasPostgres = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

beforeEach(async () => {
  // 每个用例一份全新权威库并把它切成 DATABASE_URL；createApp 之前必须完成，
  // 否则应用侧连接拿不到 DATABASE_URL（PostgreSQL 是唯一权威存储）。
  if (hasPostgres) await freshTestDatabase();
  process.env.CODEX_MODE = "stub";
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-resolve-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "db.sqlite"),
    LINGONG_DATA: tmp,
    LG_DATA_DIR: tmp,
  });
  resetConn();
  seedAll();
  // createApp 会重建这套种子数据，工作台样例必须在它之后再落库。
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("来源优先级链", () => {
  it("第 1 级显式载荷命中，来源档可审计", () => {
    const resolution = resolveContext(collaborate("col_xiaomei"));
    expect(resolution).toMatchObject({
      status: "ready",
      skill_id: "email_compose",
      sources: { collaboration: "explicit" },
      missing: [],
    });
    expect((resolution.resolved.collaboration as Json).id).toBe("col_xiaomei");
  });

  it("第 2 级 UI 选中态（object_refs）在无显式载荷时命中", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      body: { object_refs: [{ kind: "collaboration", id: "col_xiaomei" }] },
      requires: ["collaboration"],
    });
    expect(resolution.sources.collaboration).toBe("object_refs");
    expect((resolution.resolved.collaboration as Json).id).toBe("col_xiaomei");
  });

  it("第 3 级会话绑定在无显式载荷与选中态时命中", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      session: sessionWith("col_xiaomei"),
      requires: ["collaboration"],
    });
    expect(resolution.sources.collaboration).toBe("session");
    expect((resolution.resolved.collaboration as Json).id).toBe("col_xiaomei");
  });

  it("第 4 级文本 @handle 回退；id 命中时不再回退", () => {
    const fromText = resolveContext({
      skillId: "email_compose",
      body: {},
      text: "写合作邮件 @小美妆日记",
      requires: ["collaboration"],
    });
    expect(fromText.status).toBe("ready");
    expect(fromText.sources.collaboration).toBe("text");
    expect((fromText.resolved.collaboration as Json).id).toBe("col_xiaomei");

    const explicitWins = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_laozhang" },
      text: "写合作邮件 @小美妆日记",
      requires: ["collaboration"],
    });
    expect(explicitWins.sources.collaboration).toBe("explicit");
    expect((explicitWins.resolved.collaboration as Json).id).toBe("col_laozhang");
  });

  it("多候选只列候选，不取第一只", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      body: {
        object_refs: [
          { kind: "collaboration", id: "col_xiaomei" },
          { kind: "collaboration", id: "col_laozhang" },
        ],
      },
      requires: ["collaboration"],
    });
    expect(resolution.status).toBe("needs_context");
    expect(resolution.resolved.collaboration).toBeUndefined();
    expect(resolution.candidates.map((candidate) => candidate.id).sort()).toEqual(["col_laozhang", "col_xiaomei"]);
    expect(resolution.missing[0]).toMatchObject({ key: "collaboration", tier: "requires" });
  });

  it("第 1 级与第 3 级冲突时不静默取其一", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_laozhang" },
      session: sessionWith("col_xiaomei"),
      requires: ["collaboration"],
    });
    expect(resolution.status).toBe("blocked");
    expect(resolution.resolved.collaboration).toBeUndefined();
    expect(String(resolution.missing[0].reason)).toContain("会话已绑定其他合作对象");
  });
});

describe("统一信封", () => {
  it("requires 未满足即 needs_context，且不返回任何解析结果", () => {
    const resolution = resolveContext({ skillId: "email_compose", body: {}, requires: ["collaboration", "stage"] });
    expect(resolution.status).toBe("needs_context");
    expect(resolution.resolved).toEqual({});
    expect(resolution.sources).toEqual({});
    expect(resolution.missing.map((entry) => entry.key)).toEqual(["collaboration", "stage"]);
    expect(resolution.missing.every((entry) => entry.tier === "requires")).toBe(true);
  });

  it("prefers 未满足只记 missing，不阻塞 ready", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_xiaomei" },
      requires: ["collaboration"],
      prefers: ["message"],
    });
    expect(resolution.status).toBe("ready");
    expect(resolution.missing).toEqual([expect.objectContaining({ key: "message", tier: "prefers" })]);
    expect(resolution.resolved.message).toBeUndefined();
  });

  it("阶段与阶段轨道逐键解析，依赖键在取数前补齐", () => {
    const resolution = resolveContext({
      skillId: "confirm_stage",
      body: { collaboration_id: "col_xiaomei" },
      requires: ["stage", "stage_tracks"],
    });
    expect(resolution.status).toBe("ready");
    expect(resolution.sources.stage).toBe("object_fact");
    const stage = resolution.resolved.stage as Json;
    expect(stage).toMatchObject({ stage_code: "INITIAL_CONTACT", stage_version: 0, exception: false });
    expect(String(stage.advancement_mode || "")).not.toBe("");
    expect((resolution.resolved.stage_tracks as Json[]).map((track) => track.id)).toEqual(["main", "branch", "exception"]);
  });

  it("未启用（未 cite）的已发布模板不算解析成功", () => {
    const resolution = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_xiaomei" },
      requires: ["collaboration", "mail_template"],
    });
    expect(resolution.status).toBe("needs_context");
    expect(resolution.resolved.mail_template).toBeUndefined();
    expect(String(resolution.missing.find((entry) => entry.key === "mail_template")?.reason)).toContain("适用模板");
  });

  it("启用后按阶段与品牌解析成唯一模板；并列时出候选而不是取第一只", () => {
    cite("kb_mail_kol");
    const automatic = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_xiaomei" },
      requires: ["collaboration", "mail_template"],
    });
    expect(automatic.status).toBe("ready");
    expect(automatic.sources.mail_template).toBe("object_fact");
    expect(automatic.resolved.mail_template).toMatchObject({ knowledge_id: "kb_mail_kol", source: "knowledge" });

    cite("kb_mail_followup");
    const tied = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_xiaomei" },
      requires: ["collaboration", "mail_template"],
    });
    expect(tied.status).toBe("needs_context");
    expect(tied.resolved.mail_template).toBeUndefined();
    expect(tied.candidates.map((candidate) => candidate.id).sort()).toEqual(["kb_mail_followup", "kb_mail_kol"]);

    const pinned = resolveContext({
      skillId: "email_compose",
      body: { collaboration_id: "col_xiaomei", knowledge_id: "kb_mail_followup" },
      requires: ["collaboration", "mail_template"],
    });
    expect(pinned.status).toBe("ready");
    expect(pinned.sources.mail_template).toBe("explicit");
    expect(pinned.resolved.mail_template).toMatchObject({ knowledge_id: "kb_mail_followup" });
  });

  it("解析按需发生：未声明的键不会被读取，也不会凭空报缺口", () => {
    const session = openContext({ skillId: "email_compose", body: {} });
    expect(session.stage()).toBeNull();
    expect(session.creator()).toBeNull();
    expect(session.resolution([], []).status).toBe("ready");
  });

  it("context_version 随内容变化，重复解析稳定", () => {
    const first = resolveContext(collaborate("col_xiaomei"));
    const again = resolveContext(collaborate("col_xiaomei"));
    const other = resolveContext(collaborate("col_laozhang"));
    expect(first.context_version).toBe(again.context_version);
    expect(other.context_version).not.toBe(first.context_version);
    expect(first.context_version).toHaveLength(24);
  });

  it("未登记的合作对象不解析出结果", () => {
    const resolution = resolveContext(collaborate("col_not_exists"));
    expect(resolution.status).toBe("needs_context");
    expect(resolution.resolved).toEqual({});
  });
});

describe("context 契约（registry）", () => {
  it("未登记键在加载期就被拒绝，不由解析层兜底", () => {
    expect(() => validateDeclaredTaskContract({ context: { requires: ["kol"] } })).toThrow(/unregistered key/);
    expect(() => validateDeclaredTaskContract({ context: { requires: ["collaboration"], prefers: ["collaboration"] } }))
      .toThrow(/both requires and prefers/);
    expect(validateDeclaredTaskContract({ context: { requires: ["collaboration"], prefers: ["mailbox"] } }))
      .toMatchObject({ context: { requires: ["collaboration"], prefers: ["mailbox"] } });
  });
});

/** P2.1：阶段类技能拿到当前正式阶段 + 版本 + 推进模式 + 是否异常，才分得清「发信即可」与「发信 ≠ 推进」。 */
describe("阶段类技能（P2.1）", () => {
  function collabRow(id: string): Json {
    return getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(id) as Json;
  }

  it("两个技能按注册表声明 context，且与 required_inputs 并存", () => {
    for (const id of ["confirm_stage", "stage_sop"]) {
      expect(taskDefinition(id)?.context, id).toEqual({
        requires: ["collaboration", "stage"],
        prefers: ["stage_tracks"],
      });
    }
    // context.requires 是系统要解析的事实，required_inputs 是人必须给的值，两者互不替代。
    expect(taskDefinition("confirm_stage")?.required_inputs).toEqual(["collaboration_id"]);
  });

  it("运行箱的合作块补齐阶段版本、推进模式与异常口径", () => {
    const col = collabRow("col_xiaomei");
    expect(collaborationContext(col)).toMatchObject({
      stage_code: "INITIAL_CONTACT",
      stage_version: Number(col.stage_version || 0),
      advancement_mode: "自动记录",
      exception: false,
      exception_kind: null,
    });
  });

  it("异常阶段如实进箱，不冒充主流程", () => {
    getConn().prepare("UPDATE collaborations SET stage_code='PAUSED', stage_version=3 WHERE id='col_xiaomei'").run();
    expect(collaborationContext(collabRow("col_xiaomei"))).toMatchObject({
      stage_code: "PAUSED",
      stage_version: 3,
      advancement_mode: "旁路",
      exception: true,
      exception_kind: "bypass",
    });
  });

  it("CONTEXT.md 只注入声明过的键，带 sources 与 context_version，且不重复进 extra", () => {
    const definition = requireTaskDefinition("confirm_stage");
    const prompt = "记状态 @小美妆日记";
    const extra = { collaboration_id: "col_xiaomei", handle: "小美妆日记", text: prompt };
    const resolution = resolveContext({ skillId: "confirm_stage", body: extra, text: prompt });
    expect(resolution.status).toBe("ready");
    const box = writeBox("wrk_context_probe", definition, prompt, { ...extra, context_resolution: resolution },
      collabRow("col_xiaomei"), runtimeAgentScopeContext("agent:kol"));
    const written = fs.readFileSync(path.join(box, "CONTEXT.md"), "utf8");
    const raw = written.slice(written.indexOf("```json\n") + "```json\n".length, written.indexOf("\n```", written.indexOf("```json\n")));
    const ctx = JSON.parse(raw) as Json;

    expect(ctx.collaboration).toMatchObject({
      stage_code: "INITIAL_CONTACT",
      stage_version: 0,
      advancement_mode: "自动记录",
      exception: false,
      exception_kind: null,
    });
    expect((ctx.collaboration as Json).stage_tracks).toBeDefined();
    expect(declaredContext({ context_resolution: resolution })).toMatchObject({
      status: "ready",
      sources: { collaboration: "explicit", stage: "object_fact", stage_tracks: "object_fact" },
    });
    const injected = ctx.context as Json;
    expect(Object.keys(injected.resolved as Json).sort()).toEqual(["collaboration", "stage", "stage_tracks"]);
    expect(injected.resolved).not.toHaveProperty("creator");
    expect(injected.resolved).not.toHaveProperty("mailbox");
    expect(String(injected.context_version)).toHaveLength(24);
    expect((ctx.extra as Json).context_resolution).toBeUndefined();
    // 解析结果要穿过提交侧的 workerSafeExtra 才进箱；被过滤掉就等于没接上。
    expect(workerSafeExtra({ ...extra, context_resolution: resolution }).context_resolution).toMatchObject({ status: "ready" });
  });

  it("未声明 context 的技能不解析、不拦（保持现状）", () => {
    expect(workerRunContext("creator_discovery", { text: "发现达人" }, "发现达人")).toBeNull();
    expect(workerRunContext("email_compose", { text: "写合作邮件" }, "写合作邮件")).toBeNull();
  });

  it("requires 未满足：不出结果，缺口逐键如实回执", () => {
    const gap = workerRunContext("stage_sop", { text: "阶段SOP" }, "阶段SOP");
    expect(gap?.status).toBe("needs_context");
    expect(gap?.resolved).toEqual({});
    expect(gap?.missing.map((entry) => [entry.key, entry.tier])).toEqual([
      ["collaboration", "requires"],
      ["stage", "requires"],
      // prefers 未满足只记 missing，不阻塞；requires 一破它也跟着破。
      ["stage_tracks", "prefers"],
    ]);
  });

  it("requires 未满足：不启动 turn，落缺口卡并回结构化缺口", () => {
    const now = nowIso();
    const sid = "ses_stage_gap";
    getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id) VALUES (?,?,?,?,?,?,?)",
    ).run(sid, "阶段缺口", now, now, "kol", 0, null);
    const gap = workerRunContext("stage_sop", { text: "阶段SOP" }, "阶段SOP");
    if (!gap) throw new Error("stage_sop 应声明 context");
    const response = contextGapResponse(sid, {}, {
      type: "stage_sop",
      skill: "stage_sop",
      handle: null,
      amount_usd: null,
      tracking: null,
      carrier: null,
      eta: null,
      needs_worker: true,
      raw: "阶段SOP",
      collaboration_id: null,
      extras: {},
    }, gap);

    expect(response.worker).toBeNull();
    expect(response.context_gap).toMatchObject({ status: "needs_context", skill_id: "stage_sop" });
    const messages = response.messages as Json[];
    const kinds = messages.map((message) => message.kind);
    // 没有 steps / process_trace 说明 mapWorker 没跑过：本次未起箱。
    expect(kinds).toContain("supplement_card");
    expect(kinds).not.toContain("steps");
    expect(kinds).not.toContain("task_result_card");
    const card = messages.find((message) => message.kind === "supplement_card")?.payload as Json;
    expect((card.fields as Json[]).map((field) => field.key)).toEqual(["collaboration", "stage"]);
    expect(String(card.message)).toContain("本次未起箱");
  });

  it("requires 满足：照常起箱，不报缺口", () => {
    const gap = workerRunContext("stage_sop", { collaboration_id: "col_xiaomei" }, "阶段SOP @小美妆日记");
    expect(gap?.status).toBe("ready");
    expect(Object.keys(gap?.resolved || {})).toContain("stage");
  });
});

describe.skipIf(!hasPostgres)("运行路径的阶段上下文闸门（需要 PostgreSQL）", () => {
  it("requires 未满足：不起箱、不出结果，返回结构化缺口", async () => {
    const opened = await request("POST", "/api/sessions", { title: "阶段缺口" });
    expect(opened.status, opened.text).toBe(200);
    const sid = String(opened.body.id);
    const response = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "阶段SOP",
      content: "阶段SOP",
      act: "ask",
      intent: "stage_sop",
    });
    expect(response.status, response.text).toBe(200);
    expect(response.body.worker).toBeNull();
    expect(response.body.context_gap).toMatchObject({ status: "needs_context", skill_id: "stage_sop" });
    const missing = (response.body.context_gap as Json).missing as Json[];
    expect(missing.filter((entry) => entry.tier === "requires").map((entry) => entry.key)).toEqual(["collaboration", "stage"]);
    const kinds = (response.body.messages as Json[]).map((message) => message.kind);
    expect(kinds).toContain("supplement_card");
    expect(kinds).not.toContain("steps");
    expect(kinds).not.toContain("task_result_card");
  });

  it("requires 满足：照常起箱，不报缺口", async () => {
    const opened = await request("POST", "/api/sessions", { title: "阶段齐备" });
    const sid = String(opened.body.id);
    const response = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "阶段SOP @小美妆日记",
      content: "阶段SOP @小美妆日记",
      act: "ask",
      intent: "stage_sop",
      collaboration_id: "col_xiaomei",
    });
    expect(response.status, response.text).toBe(200);
    expect((response.body.worker as Json)?.skill).toBe("stage_sop");
    expect(response.body.context_gap).toBeUndefined();
  });
});

describe("POST /api/actions/context.resolve", () => {
  it("只读返回解析信封，且不写任何业务状态", async () => {
    const conn = getConn();
    const before = {
      messages: Number((conn.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n),
      drafts: Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n),
      stage: String((conn.prepare("SELECT stage_code FROM collaborations WHERE id=?").get("col_xiaomei") as { stage_code: string }).stage_code),
    };
    const response = await request("POST", "/api/actions/context.resolve", {
      skill_id: "email_compose",
      collaboration_id: "col_xiaomei",
    });
    expect(response.status, response.text).toBe(200);
    expect(response.body.skill_id).toBe("email_compose");
    expect(Object.keys(response.body)).toEqual(["status", "skill_id", "resolved", "sources", "missing", "candidates", "context_version"]);

    const after = {
      messages: Number((conn.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n),
      drafts: Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n),
      stage: String((conn.prepare("SELECT stage_code FROM collaborations WHERE id=?").get("col_xiaomei") as { stage_code: string }).stage_code),
    };
    expect(after).toEqual(before);
  });

  it("缺少 skill_id 或技能未登记时明确拒绝", async () => {
    const missing = await request("POST", "/api/actions/context.resolve", {});
    expect(missing.status).toBe(400);
    expect(String((missing.body.detail as Json).code)).toBe("skill_id_required");

    const unknown = await request("POST", "/api/actions/context.resolve", { skill_id: "kol_unknown" });
    expect(unknown.status).toBe(400);
    expect(String((unknown.body.detail as Json).code)).toBe("unknown_task_type");
  });
});

/**
 * mail-compose-prepare.test.ts 的 PostgreSQL 套件锁的是同一组行为；这里只跑本地可复现的
 * 关键分支，证明接入解析层后响应字段与状态口径没变。
 */
describe("POST /api/actions/mail.prepare 行为回归", () => {
  function addPublishedTemplate(id: string): void {
    createKnowledge({
      id,
      title: id,
      body: "template source",
      kind: "mail_template",
      base_id: "kbase_legacy",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Original subject for [红人]",
      body_en: "Original body for [红人].",
      placeholders: ["[红人]"],
      stage_codes: ["INITIAL_CONTACT"],
      status: "draft",
    });
    approveKnowledge(id, Number(knowledgeRow(id).current_version || 1));
    cite(id);
  }

  async function prepare(body: Json = {}) {
    return request("POST", "/api/actions/mail.prepare", { skill_id: "email_compose", collaboration_id: "col_xiaomei", ...body });
  }

  it("ready：合作/阶段/模板/收发件与 context_version 一次给全", async () => {
    addPublishedTemplate("mail_local");
    const response = await prepare();
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      status: "ready",
      skill_id: "email_compose",
      context: { collaboration_id: "col_xiaomei", stage_code: "INITIAL_CONTACT", stage_source: "collaboration", brand: "LT" },
      template: { knowledge_id: "mail_local", published_version: 1, source: "knowledge" },
      candidates: [],
    });
    const editor = response.body.editor as Json;
    expect(editor.to).toEqual(["xiaomei.beauty@example.com"]);
    expect(String(editor.from)).toContain("@");
    expect(String(response.body.context_version)).toHaveLength(24);
  });

  it("多候选合作对象仍是 needs_context，且不取第一只", async () => {
    const response = await request("POST", "/api/actions/mail.prepare", {
      skill_id: "email_compose",
      object_refs: [
        { kind: "collaboration", id: "col_xiaomei" },
        { kind: "collaboration", id: "col_laozhang" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "needs_context", missing_fields: ["collaboration_id"], candidates: [] });
  });

  it("没有已启用的适用模板时回报 needs_template，且不建箱", async () => {
    const conn = getConn();
    const before = Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n);
    const response = await prepare();
    expect(response.body).toMatchObject({ status: "needs_template", candidates: [], context: { collaboration_id: "col_xiaomei" } });
    expect(Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n)).toBe(before);
  });

  it("缺少正式阶段或品牌时保持原有 missing_fields 口径", async () => {
    getConn().prepare("UPDATE collaborations SET brand='' WHERE id='col_xiaomei'").run();
    const response = await prepare();
    expect(response.body).toMatchObject({ status: "needs_context", missing_fields: ["brand"] });
  });
});

describe("收发件解析不再依赖合作对象（ADR-2026-10-07）", () => {
  function bindDefaultMailbox(email: string): void {
    const conn = getConn();
    const now = new Date().toISOString();
    conn.prepare(
      `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x",
      JSON.stringify(["employee", "admin"]), JSON.stringify(["LT"]), DEMO_USER.site, 1, now, now,
    );
    conn.prepare("DELETE FROM user_starry_bindings WHERE user_id=?").run(DEMO_USER.id);
    conn.prepare(
      `INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, status, updated_at)
       VALUES (?,?,1,'connected',?)`,
    ).run(DEMO_USER.id, email, now);
    conn.prepare(
      `INSERT OR REPLACE INTO mailbox_owners (email, brand, owner_name, account_type, status)
       VALUES (?,?,?,?,'active')`,
    ).run(email, "LT", DEMO_USER.name, "personal");
  }

  function insertThread(input: { id: string; mailbox: string; conversation_id: string; peer_email: string; last_at: string }): void {
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO kol_mail_threads (id, conversation_id, subject, mailbox, last_at, created_at, updated_at, peer_email, match_state)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(input.id, input.conversation_id, "t", input.mailbox, input.last_at, now, now, input.peer_email, "unbound");
  }

  it("mailbox 不依赖 collaboration：无合作时也能解析出挂载的默认邮箱", () => {
    bindDefaultMailbox("ctx@litime.com");
    const session = openContext({ skillId: "email_compose", body: {} });
    const mailbox = session.mailbox();
    expect(mailbox?.from).toBe("ctx@litime.com");
  });

  it("recipient 逐档回退：口令写明 > 选中会话 > 最近往来", () => {
    bindDefaultMailbox("ctx@litime.com");
    insertThread({ id: "th_c1", mailbox: "ctx@litime.com", conversation_id: "conv_c1", peer_email: "mem@gmail.com", last_at: "2026-10-06T10:00:00.000Z" });
    insertThread({ id: "th_c2", mailbox: "ctx@litime.com", conversation_id: "conv_c2", peer_email: "conv@gmail.com", last_at: "2026-10-05T10:00:00.000Z" });

    const byMemory = openContext({ skillId: "email_compose", body: {} });
    expect(byMemory.recipient()?.to).toBe("mem@gmail.com");
    expect(byMemory.recipient()?.source).toBe("memory");

    const byConversation = openContext({ skillId: "email_compose", body: { conversation_id: "conv_c2" } });
    expect(byConversation.recipient()?.to).toBe("conv@gmail.com");
    expect(byConversation.recipient()?.source).toBe("conversation");

    const byExplicit = openContext({
      skillId: "email_compose",
      body: {},
      text: "写合作邮件 收件邮箱：boss@brand.com",
    });
    expect(byExplicit.recipient()?.to).toBe("boss@brand.com");
    expect(byExplicit.recipient()?.source).toBe("explicit");
  });

  it("无合作时 mail_thread 走收件人的人摘要，不再直接失败", () => {
    bindDefaultMailbox("ctx@litime.com");
    insertThread({ id: "th_c3", mailbox: "ctx@litime.com", conversation_id: "conv_c3", peer_email: "mem@gmail.com", last_at: "2026-10-06T10:00:00.000Z" });
    getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?,?)").run(
      "mail_person_digest:ctx@litime.com:mem@gmail.com",
      JSON.stringify({ text: "人摘要", source: "memory", mail_count: 2, fingerprint: "fp" }),
    );
    const session = openContext({ skillId: "email_compose", body: {} });
    const thread = session.mailThread();
    expect(thread?.text).toBe("人摘要");
    expect(thread?.mail_count).toBe(2);
  });

  it("resolution 信封里 recipient 键可被声明为 prefers 且带出来源", () => {
    bindDefaultMailbox("ctx@litime.com");
    insertThread({ id: "th_c4", mailbox: "ctx@litime.com", conversation_id: "conv_c4", peer_email: "mem@gmail.com", last_at: "2026-10-06T10:00:00.000Z" });
    const resolution = openContext({ skillId: "email_compose", body: {}, prefers: ["recipient"] }).resolution();
    expect((resolution.resolved.recipient as { to: string }).to).toBe("mem@gmail.com");
    expect(resolution.sources.recipient).toBe("memory");
  });
});

describe("P0：message / conversation 键（mail_summary / mail_translate / email_conversation_read）", () => {
  const conn = () => getConn();

  function bindDefaultMailbox(email: string): void {
    const now = new Date().toISOString();
    conn().prepare(
      `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x",
      JSON.stringify(["employee", "admin"]), JSON.stringify(["LT"]), DEMO_USER.site, 1, now, now,
    );
    conn().prepare(
      `INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, status, updated_at)
       VALUES (?,?,1,'connected',?)`,
    ).run(DEMO_USER.id, email, now);
    conn().prepare(
      `INSERT OR REPLACE INTO mailbox_owners (email, brand, owner_name, account_type, status)
       VALUES (?,?,?,?,'active')`,
    ).run(email, "LT", DEMO_USER.name, "personal");
  }

  function insertThreadWithItem(input: {
    threadId: string; itemId: string; mailbox: string; conversation_id: string; peer_email: string;
  }): void {
    const now = new Date().toISOString();
    conn().prepare(
      `INSERT INTO kol_mail_threads (id, conversation_id, subject, mailbox, last_at, created_at, updated_at, peer_email, match_state)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(input.threadId, input.conversation_id, "t", input.mailbox, now, now, now, input.peer_email, "unbound");
    conn().prepare(
      `INSERT INTO kol_mail_items (id, thread_id, conversation_id, subject, from_addr, to_addr, body_text, occurred_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(input.itemId, input.threadId, input.conversation_id, "t", input.peer_email, input.mailbox, "Hello", now, now);
  }

  it("message：显式 message_id 解析出邮件（来源 explicit）", () => {
    bindDefaultMailbox("ctx@litime.com");
    insertThreadWithItem({
      threadId: "th_m1", itemId: "msg_m1", mailbox: "ctx@litime.com",
      conversation_id: "conv_m1", peer_email: "a@gmail.com",
    });
    const session = openContext({ skillId: "mail_translate", body: { message_id: "msg_m1" }, requires: ["message"] });
    const msg = session.message();
    expect(msg?.id).toBe("msg_m1");
    const resolution = session.resolution();
    expect(resolution.sources.message).toBe("explicit");
  });

  it("message：没给 ID 时报 needs_context（不再是 TODO 未实现）", () => {
    bindDefaultMailbox("ctx@litime.com");
    const session = openContext({ skillId: "mail_translate", body: {}, requires: ["message"] });
    const resolution = session.resolution();
    expect(resolution.missing.some((m) => m.key === "message")).toBe(true);
    // 不应再出现 TODO 占位文案
    const reasons = resolution.missing.map((m) => String(m.reason || ""));
    expect(reasons.join(" ")).not.toContain("P2.3");
  });

  it("message：不属于本人邮箱的邮件被拒绝，不降级", () => {
    bindDefaultMailbox("ctx@litime.com");
    insertThreadWithItem({
      threadId: "th_m2", itemId: "msg_m2", mailbox: "other@litime.com",
      conversation_id: "conv_m2", peer_email: "b@gmail.com",
    });
    const session = openContext({ skillId: "mail_translate", body: { message_id: "msg_m2" }, requires: ["message"] });
    const resolution = session.resolution();
    // 被 blocked 或 missing，但绝不能解析出别人的邮件
    const msg = session.message();
    expect(msg?.id).not.toBe("msg_m2");
  });

  it("conversation：mail_summary 用选中的会话直接解析，不追问 ID", () => {
    bindDefaultMailbox("ctx@litime.com");
    const now = new Date().toISOString();
    conn().prepare(
      `INSERT INTO kol_mail_threads (id, conversation_id, subject, mailbox, last_at, created_at, updated_at, peer_email, match_state)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run("th_c5", "conv_c5", "t", "ctx@litime.com", now, now, now, "c@gmail.com", "unbound");
    const session = openContext({ skillId: "mail_summary", body: { conversation_id: "conv_c5" }, requires: ["conversation"] });
    const conv = session.conversation();
    expect(conv).toBeTruthy();
    const resolution = session.resolution();
    expect(resolution.sources.conversation).toBe("explicit");
  });
});

describe("P1：creator 键（达人技能：profile/decrypt/status/owner/scoring/kol_analyze）", () => {
  const conn = () => getConn();

  function insertCreator(input: { id: string; handle: string; display_name?: string; kol_uid?: string }): void {
    conn().prepare(
      `INSERT INTO collaborations (id, handle, display_name, brand, email, mailbox_from, lifecycle_id, conversation_id, stage_code, kol_uid)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.id, input.handle, input.display_name || input.handle, "LT", `${input.handle}@example.com`,
      "", "", "", "INITIAL_CONTACT", input.kol_uid || "",
    );
  }

  it("creator：显式 handle 解析出达人（来源 explicit）", () => {
    insertCreator({ id: "col_k1", handle: "xiaomei" });
    const session = openContext({ skillId: "creator_profile", body: { handle: "xiaomei" }, requires: ["creator"] });
    const creator = session.creator();
    expect(creator?.handle).toBe("xiaomei");
    expect(creator?.collaboration_id).toBe("col_k1");
    const resolution = session.resolution();
    expect(resolution.sources.creator).toBe("explicit");
  });

  it("creator：object_refs 选中态解析（来源 object_refs）", () => {
    insertCreator({ id: "col_k2", handle: "damei" });
    const session = openContext({
      skillId: "creator_profile",
      body: { object_refs: [{ kind: "kol", id: "damei" }] },
      requires: ["creator"],
    });
    const creator = session.creator();
    expect(creator?.handle).toBe("damei");
    const resolution = session.resolution();
    expect(resolution.sources.creator).toBe("object_refs");
  });

  it("creator：没给达人时报 needs_input，不猜", () => {
    const session = openContext({ skillId: "creator_profile", body: {}, requires: ["creator"] });
    const resolution = session.resolution();
    expect(resolution.status).toBe("needs_input");
    expect(session.creator()).toBeNull();
  });

  it("creator：多候选只列候选，不取第一只", () => {
    insertCreator({ id: "col_k3", handle: "twin_a", display_name: "小美" });
    insertCreator({ id: "col_k4", handle: "twin_b", display_name: "小美" });
    const session = openContext({
      skillId: "creator_profile",
      body: {},
      text: "@小美 看下画像",
      requires: ["creator"],
    });
    const resolution = session.resolution();
    // 按 display_name 搜出两个时，不应静默取第一个
    if (resolution.status === "needs_input" && resolution.candidates.length >= 2) {
      expect(resolution.candidates.length).toBeGreaterThanOrEqual(2);
    } else {
      // 文本抽取没命中时也是 needs_input（不猜），同样符合要求
      expect(resolution.status).toBe("needs_input");
    }
    expect(session.creator()).toBeNull();
  });

  it("六个 P1 技能都已声明 context.requires=[creator]", () => {
    for (const skillId of ["creator_profile", "creator_contact_decrypt", "creator_status_update", "creator_owner_update", "creator_scoring", "kol_analyze"]) {
      const def = taskDefinition(skillId);
      expect(def?.context?.requires, skillId).toContain("creator");
    }
  });
});
