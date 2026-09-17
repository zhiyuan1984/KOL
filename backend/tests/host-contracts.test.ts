import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES } from "../src/config.js";
import { getConn, listAudit, resetConn, tx } from "../src/db.js";
import { seedAll, seedIfEmpty } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { workerCannotSend } from "../src/worker/common.js";
import { SKILL_CATALOG } from "../src/host/skills-catalog.js";
import { isStarryKolTask, setEmailMcpClientFactory } from "../src/starrykol/service.js";
import { toLegacyStarryStage } from "../src/stages.js";
import { isKolClawTask } from "../src/kolclaw/service.js";
import { profileFor } from "../src/profiles.js";
import { emailCardPayload, persistDraft } from "../src/host/api.js";
import { emailMcpResultCard } from "../src/starrykol/service.js";
import { classify } from "../src/host/intent.js";

type Json = Record<string, unknown>;

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

async function ask(
  prompt: string,
  intent?: string,
  collaborationId?: string,
  expectStatus = 200,
  extra: Json = {},
): Promise<[string, Json]> {
  const ses = await (await request("POST", "/api/sessions", { title: prompt.slice(0, 20) })).json();
  const payload: Json = { text: prompt, content: prompt, act: "ask", model_tier: "default", ...extra };
  if (intent) payload.intent = intent;
  if (collaborationId) payload.collaboration_id = collaborationId;
  const r = await request("POST", `/api/sessions/${ses.id}/messages`, payload);
  expect(r.status, await r.text()).toBe(expectStatus);
  return [String(ses.id), await r.json()];
}

function draftOn(sid: string, extra: Json = {}) {
  return persistDraft(sid, {
    skill: "email_compose",
    template_id: "stage_mail.followup",
    from: BRAND_MAILBOXES.LT,
    to: "xiaomei.beauty@example.com",
    subject: "Following up — LiTime collab kit",
    body: "Hi,\n\nJust a follow-up.\n",
    body_zh_internal: "跟进内部译稿",
    keep_stage: true,
    official_stage: "INITIAL_CONTACT",
    collaboration_id: "col_xiaomei",
    ...extra,
  });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-"));
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
  setEmailMcpClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("host contracts", () => {
  it("PATCH draft subject and body refresh the email card and compose result", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const draft = draftOn(sid, { subject: "发货通知", body: "old interest body" });
    const card = emailCardPayload(draft);
    const result = emailMcpResultCard("email_compose", {
      mailboxEmail: draft.from_addr,
      from: draft.from_addr,
      to: draft.to_addr,
      subject: draft.subject,
      body: draft.body_en,
    });
    const now = new Date().toISOString();
    getConn().prepare(
      "INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)",
    ).run("msg_draft_1", sid, "assistant", "email_card", JSON.stringify(card), now);
    getConn().prepare(
      "INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)",
    ).run("msg_result_1", sid, "assistant", "task_result_card", JSON.stringify({
      ...result,
      skill: "email_compose",
      starrykol_data: {
        mailboxEmail: draft.from_addr,
        to: draft.to_addr,
        subject: draft.subject,
        body: draft.body_en,
      },
    }), now);
    const patched = await request("PATCH", `/api/drafts/${draft.id}`, {
      subject: "Re: KOL合作",
      body_en: "Hi, thrilled to hear about your interest.",
    });
    expect(patched.status, await patched.text()).toBe(200);
    const ses = await (await request("GET", `/api/sessions/${sid}`)).json();
    const msgs = (ses.messages as Json[]) || [];
    const email = msgs.find((row) => row.kind === "email_card")?.payload as Json;
    const compose = msgs.find((row) => row.kind === "task_result_card" && row.id === "msg_result_1")?.payload as Json;
    expect(email).toMatchObject({ subject: "Re: KOL合作", body: "Hi, thrilled to hear about your interest." });
    expect(JSON.stringify(compose)).toContain("Re: KOL合作");
    expect(JSON.stringify(compose)).toContain("thrilled to hear about your interest");
    expect(JSON.stringify(compose)).not.toContain("发货通知");
  });

  it("send does not call stage", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const draft = draftOn(sid);
    const sent = await request("POST", `/api/drafts/${draft.id}/send`, {});
    expect(sent.status, await sent.text()).toBe(200);
    const sj = await sent.json();
    expect(sj.stage_changed).toBe(false);
    expect(sj.official_stage).toBe("INITIAL_CONTACT");
    const types = ((await (await request("GET", "/api/audit")).json()) as unknown as Json[]).map(
      (e) => e.event_type,
    );
    const sendIdx = types.indexOf("starry.send");
    expect(types.slice(sendIdx)).not.toContain("starry.stage");
  });

  it("confirm stage does not send", async () => {
    const [sid, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    expect((data.worker as Json)?.skill).toBe("confirm_stage");
    expect(data.draft ?? null).toBeNull();
    const kinds = ((data.messages as Json[]) || []).map((m) => m.kind);
    expect(kinds).not.toContain("email_card");
    expect(kinds).toContain("confirm_stage_card");
    const card = (data.messages as Json[]).find((m) => m.kind === "confirm_stage_card")!;
    const target = ((card.payload as Json).targets as Json[])[0].code;
    const before = ((await (await request("GET", "/api/audit")).json()) as unknown as Json[]).filter(
      (e) => e.event_type === "starry.send",
    );
    const r = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: target,
      collaboration_id: "col_xiaomei",
      expected_version: (card.payload as Json).expected_version,
      reason: "已口头确认有兴趣",
    });
    expect(r.status, await r.text()).toBe(200);
    expect((await r.json()).sent).toBe(false);
    const after = ((await (await request("GET", "/api/audit")).json()) as unknown as Json[]).filter(
      (e) => e.event_type === "starry.send",
    );
    expect(after.length).toBe(before.length);
  });

  it("confirm-stage writes official stage and remote changeLifecycleStage", async () => {
    getConn().prepare("UPDATE collaborations SET kol_uid=?, last_lifecycle_id=? WHERE id=?").run(
      "KOLXIAOMEI",
      "16",
      "col_xiaomei",
    );
    const [sid, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const card = (data.messages as Json[]).find((m) => m.kind === "confirm_stage_card")!;
    const target = ((card.payload as Json).targets as Json[])[0].code;
    const r = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: target,
      collaboration_id: "col_xiaomei",
      expected_version: (card.payload as Json).expected_version,
      reason: "已口头确认有兴趣",
    });
    expect(r.status, await r.text()).toBe(200);
    const body = await r.json();
    expect(body.stage_changed).toBe(true);
    expect(body.mcp_sync).toMatchObject({
      tool: "changeLifecycleStage",
      updated: true,
      cooperationStageCode: toLegacyStarryStage(String(target)),
    });
    const col = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_xiaomei'").get() as Json;
    expect(col.stage_code).toBe(target);
    const stored = getConn().prepare(
      "SELECT payload FROM messages WHERE session_id=? AND kind='confirm_stage_card'",
    ).all(sid) as { payload: string }[];
    expect(stored.some((row) => Boolean((JSON.parse(row.payload) as Json).resolved))).toBe(true);
  });

  it("human skip keeps kind/reason locally and walks Starry with adjacent native hops", async () => {
    getConn().prepare("UPDATE collaborations SET kol_uid=?, last_lifecycle_id=? WHERE id=?").run(
      "KOLXIAOMEI",
      "320",
      "col_xiaomei",
    );
    const [sid, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const recorded: { name: string; args: Json }[] = [];
    setEmailMcpClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        recorded.push({ name, args });
        const body = JSON.parse(String(args.requestJson || "{}")) as Json;
        return { data: { updated: true, ...body } };
      },
      async close() { /* noop */ },
    }));
    const card = (data.messages as Json[]).find((m) => m.kind === "confirm_stage_card")!;
    const r = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "NEGOTIATING",
      collaboration_id: "col_xiaomei",
      expected_version: (card.payload as Json).expected_version,
      reason: "报价已口头同意，直接商务谈判",
    });
    expect(r.status, await r.text()).toBe(200);
    const body = await r.json();
    expect(body.stage_changed).toBe(true);
    expect(body.stage_code).toBe("NEGOTIATING");
    expect(body.skip_kind).toBe("skip");
    expect(body.skip_reason).toBe("报价已口头同意，直接商务谈判");
    expect(body.skipped_stages).toEqual(["INTERESTED", "EVALUATING", "QUOTE_PENDING"]);
    expect(body.remote_stage_code).toBe("BUSINESS_NEGOTIATION");
    expect(body.mcp_sync).toMatchObject({
      tool: "changeLifecycleStage",
      updated: true,
      cooperationStageCode: "BUSINESS_NEGOTIATION",
    });
    expect((body.mcp_sync as Json).walk).toMatchObject({ kind: "walk" });
    const writes = recorded.filter((row) => row.name === "changeLifecycleStage");
    expect(writes).toHaveLength(4);
    expect(writes.map((row) => JSON.parse(String(row.args.requestJson)).toStageCode)).toEqual([
      "INTEREST_CONFIRMED",
      "COOPERATION_EVALUATION",
      "QUOTE_PENDING",
      "BUSINESS_NEGOTIATION",
    ]);
    expect(writes.every((row) => {
      const keys = Object.keys(row.args).sort();
      const payload = JSON.parse(String(row.args.requestJson)) as Json;
      return keys[0] === "lifecycleId"
        && keys[1] === "requestJson"
        && keys.length === 2
        && row.args.lifecycleId === 320
        && Object.keys(payload).sort().join(",") === "reason,toStageCode";
    })).toBe(true);
    expect(JSON.stringify(writes.map((row) => row.args))).not.toMatch(/cooperationStageCode|targetStageCode|"stageCode"|skip/i);
    const hopAudits = listAudit("host.confirm_stage.mcp") as Json[];
    expect(hopAudits.filter((row) => (row.payload as Json).native).map((row) => (row.payload as Json).native)).toEqual([
      "INTEREST_CONFIRMED",
      "COOPERATION_EVALUATION",
      "QUOTE_PENDING",
      "BUSINESS_NEGOTIATION",
    ]);
    const col = getConn().prepare(
      "SELECT stage_code, last_skip_kind, last_skip_reason, last_skipped_stages FROM collaborations WHERE id='col_xiaomei'",
    ).get() as Json;
    expect(col.stage_code).toBe("NEGOTIATING");
    expect(col.last_skip_kind).toBe("skip");
    expect(col.last_skip_reason).toBe("报价已口头同意，直接商务谈判");
    expect(JSON.parse(String(col.last_skipped_stages))).toEqual(["INTERESTED", "EVALUATING", "QUOTE_PENDING"]);
    const stored = getConn().prepare(
      "SELECT payload FROM messages WHERE session_id=? AND kind='confirm_stage_card'",
    ).all(sid) as { payload: string }[];
    expect(stored.some((row) => {
      const payload = JSON.parse(row.payload) as Json;
      return payload.resolved
        && payload.skip_kind === "skip"
        && payload.skip_reason === "报价已口头同意，直接商务谈判";
    })).toBe(true);
    const audits = listAudit("host.confirm_stage") as Json[];
    expect(audits.some((row) => {
      const payload = row.payload as Json;
      return payload.to_stage === "NEGOTIATING"
        && payload.skip_kind === "skip"
        && payload.skip_reason === "报价已口头同意，直接商务谈判"
        && payload.remote_stage_code === "BUSINESS_NEGOTIATION";
    })).toBe(true);
    setEmailMcpClientFactory();
  });

  it("reject-stage closes the card without writing stage or starting a worker", async () => {
    const [sid, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const beforeWorkers = ((await (await request("GET", "/api/workers")).json()) as unknown as Json[]).length;
    const r = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      rejected: true,
      reason: "证据不足，先不改",
      collaboration_id: "col_xiaomei",
    });
    expect(r.status, await r.text()).toBe(200);
    const body = await r.json();
    expect(body.rejected).toBe(true);
    expect(body.stage_changed).toBe(false);
    const col = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_xiaomei'").get() as Json;
    expect(col.stage_code).toBe("INITIAL_CONTACT");
    const afterWorkers = ((await (await request("GET", "/api/workers")).json()) as unknown as Json[]).length;
    expect(afterWorkers).toBe(beforeWorkers);
    const stored = getConn().prepare(
      "SELECT payload FROM messages WHERE session_id=? AND kind='confirm_stage_card'",
    ).all(sid) as { payload: string }[];
    expect(stored.some((row) => Boolean((JSON.parse(row.payload) as Json).rejected))).toBe(true);
  });

  it("记状态 runs the proposal skill but does not create a draft or write stage", async () => {
    const [sid, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const workers = (await (await request("GET", "/api/workers")).json()) as unknown as Json[];
    expect(workers.some((w) => w.session_id === sid && w.skill === "confirm_stage")).toBe(true);
    expect((data.worker as Json)?.skill).toBe("confirm_stage");
    expect(data.draft ?? null).toBeNull();
    expect((data.messages as Json[]).map((m) => m.kind)).not.toContain("email_card");
    const col = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_xiaomei'").get() as Json;
    expect(col.stage_code).toBe("INITIAL_CONTACT");
  });

  it("confirm illegal edge 400", async () => {
    const r = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "PUBLISHED",
      expected_version: 0,
    });
    expect(r.status).toBe(400);
  });

  it("confirm version conflict 409", async () => {
    const r = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "INTERESTED",
      expected_version: 99,
    });
    expect(r.status).toBe(409);
  });

  it("terminal states have no outgoing transitions", async () => {
    tx((c) => {
      c.prepare("UPDATE collaborations SET stage_code='COMPLETED' WHERE id='col_trip'").run();
    });
    const r = await request("POST", "/api/collaborations/col_trip/confirm-stage", {
      stage_code: "INITIAL_CONTACT",
      expected_version: 0,
    });
    expect(r.status).toBe(400);
  });

  it("every formal stage change appends an evidence-rich immutable transition", async () => {
    const changed = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "INTERESTED",
      expected_version: 0,
      reason: "达人明确回复愿意合作",
      reason_code: "REPLY_EVIDENCE",
      evidence: { message_id: "mail_123", quote: "Interested" },
      recommender: "Opportunity",
      approver: "sriphy",
      occurred_at: "2026-08-31T16:00:00.000Z",
    });
    expect(changed.status, await changed.text()).toBe(200);
    const result = await changed.json();
    expect(result.stage_code).toBe("INTERESTED");
    expect(result.new_version).toBe(1);
    expect(result.transition_id).toMatch(/^trn_/);

    const rows = (await (
      await request("GET", "/api/stage-transitions?collaboration_id=col_xiaomei")
    ).json()) as unknown as Json[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      collaboration_id: "col_xiaomei",
      from_stage: "INITIAL_CONTACT",
      to_stage: "INTERESTED",
      reason_code: "REPLY_EVIDENCE",
      evidence: { message_id: "mail_123", quote: "Interested" },
      recommender: "Opportunity",
      approver: "sriphy",
      occurred_at: "2026-08-31T16:00:00.000Z",
      data_version_before: 0,
      data_version_after: 1,
      capability_profile: "Opportunity",
      advancement_mode: "AI 建议 + 人确认",
    });
    expect(() =>
      getConn().prepare("UPDATE stage_transitions SET reason_code = 'MUTATED' WHERE id = ?").run(rows[0].id),
    ).toThrow(/immutable/);
    expect(() =>
      getConn().prepare("DELETE FROM stage_transitions WHERE id = ?").run(rows[0].id),
    ).toThrow(/immutable/);
  });

  it("gated content review queues work approval and writes after agree", async () => {
    const queued = await request("POST", "/api/collaborations/col_mum/confirm-stage", {
      stage_code: "CONTENT_REVIEW",
      expected_version: 0,
      reason: "大纲已齐，提交内容审核",
    });
    expect(queued.status, await queued.text()).toBe(200);
    const body = await queued.json();
    expect(body.waiting_approval).toBe(true);
    expect(body.stage_changed).toBeFalsy();
    expect(body.approval_id).toBeTruthy();
    expect(body.kind).toBe("content");
    expect(body.stage_code).toBe("CONTENT_PLANNING");
    const held = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_mum'").get() as Json;
    expect(held.stage_code).toBe("CONTENT_PLANNING");
    const decided = await request("POST", `/api/approvals/${body.approval_id}/decide`, {
      decision: "approve",
      expected_version: 0,
      idempotency_key: `host-content-${body.approval_id}`,
    });
    expect(decided.status, await decided.text()).toBe(200);
    const after = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_mum'").get() as Json;
    expect(after.stage_code).toBe("CONTENT_REVIEW");
  });

  it("plan-pending stage confirm queues approval and writes after agree", async () => {
    tx((c) => {
      c.prepare("UPDATE collaborations SET stage_code='NEGOTIATING', stage_version=0 WHERE id='col_laozhang'").run();
    });
    const queued = await request("POST", "/api/collaborations/col_laozhang/confirm-stage", {
      stage_code: "PLAN_PENDING",
      expected_version: 0,
    });
    expect(queued.status, await queued.text()).toBe(200);
    const body = await queued.json();
    expect(body.waiting_approval).toBe(true);
    expect(body.stage_code).toBe("NEGOTIATING");
    expect(body.kind).toBe("stage");
    const held = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_laozhang'").get() as Json;
    expect(held.stage_code).toBe("NEGOTIATING");
    const decided = await request("POST", `/api/approvals/${body.approval_id}/decide`, {
      decision: "approve",
      expected_version: 0,
      idempotency_key: `host-stage-${body.approval_id}`,
    });
    expect(decided.status, await decided.text()).toBe(200);
    const after = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_laozhang'").get() as Json;
    expect(after.stage_code).toBe("PLAN_PENDING");
  });

  it("POST /api/approvals initiates expense only and leaves confirm_stage unchanged", async () => {
    const stageBefore = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_laozhang'").get() as Json;
    const created = await request("POST", "/api/approvals", {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
      requester_name: "黎玉燕",
    });
    expect(created.status, await created.text()).toBe(200);
    const row = await created.json();
    expect(row.kind).toBe("expense");
    expect(row.payload).toMatchObject({ rule_id: "FIN-EXP-001" });

    const rejected = await request("POST", "/api/approvals", {
      kind: "stage",
      amount: 1,
      currency: "CNY",
      requester_name: "黎玉燕",
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).detail).toMatchObject({ code: "unsupported_kind" });

    const stageAfter = getConn().prepare("SELECT stage_code FROM collaborations WHERE id='col_laozhang'").get() as Json;
    expect(stageAfter.stage_code).toBe(stageBefore.stage_code);
    const audits = listAudit("expense.approval.created") as { payload: { approval_id?: string } }[];
    expect(audits.some((event) => event.payload.approval_id === row.id)).toBe(true);
  });

  it("allows an evidence-backed jump and still blocks unfinished priors", async () => {
    tx((c) => {
      c.prepare("UPDATE collaborations SET stage_code='INITIAL_CONTACT', stage_version=0 WHERE id='col_xiaomei'").run();
    });
    const jumped = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "EVALUATING",
      expected_version: 0,
      reason: "回信已确认兴趣并进入评估",
      evidence: { completed: ["INTERESTED"] },
    });
    expect(jumped.status, await jumped.text()).toBe(200);
    expect((await jumped.json()).stage_code).toBe("EVALUATING");
    tx((c) => {
      c.prepare("UPDATE collaborations SET stage_code='INITIAL_CONTACT', stage_version=0 WHERE id='col_xiaomei'").run();
    });
    const blocked = await request("POST", "/api/collaborations/col_xiaomei/confirm-stage", {
      stage_code: "PUBLISHED",
      expected_version: 0,
      evidence: { completed: ["PUBLISHED"] },
    });
    expect(blocked.status).toBe(400);
  });

  it("worker cannot send", async () => {
    const stub = fs.readFileSync(path.join(import.meta.dirname, "../src/worker/stub.ts"), "utf8");
    const runner = fs.readFileSync(path.join(import.meta.dirname, "../src/worker/runner.ts"), "utf8");
    const codex = fs.readFileSync(path.join(import.meta.dirname, "../src/worker/codex.ts"), "utf8");
    for (const src of [stub, runner, codex]) {
      expect(src).not.toContain("starry.sendConversation");
      expect(src).not.toMatch(/sendDraft\(/);
    }
    const [, data] = await ask("搜索 YouTube 露营达人", "creator_discovery");
    expect((data.worker as Json).id).toBeTruthy();
    const clog = ((data.worker as Json).contract_log as Json[]) || [];
    expect(clog.length).toBeGreaterThan(0);
    expect(() => workerCannotSend()).toThrowError(/worker cannot send/);
  });

  it("host messages do not call runStub", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "../src/host/api.ts"), "utf8");
    expect(src).not.toContain("runStub");
    expect(src).toContain("runWorker");
  });

  it("production worker only stubs in CODEX_MODE=stub", () => {
    const runner = fs.readFileSync(path.join(import.meta.dirname, "../src/worker/runner.ts"), "utf8");
    expect(runner).toMatch(/codexMode\(\) === "stub"/);
    expect(runner).not.toMatch(/isEmailMcpTask\(skill\) && skill !== "email_compose"/);
    expect(runner).toContain("deriveChildThread");
    expect(runner).not.toContain("starry.sendConversation");
  });

  it("from options authorized only", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const draft = draftOn(sid);
    const card = (await import("../src/host/api.js")).emailCardPayload(draft);
    const opts = (card.allowed_from_mailboxes as Json[]) || [];
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.authorized)).toBe(true);
    const emails = new Set(opts.map((o) => o.email));
    for (const e of emails) expect(Object.values(BRAND_MAILBOXES)).toContain(e);
  });

  it("send exam permission template persistent", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const did = draftOn(sid).id;
    await request("POST", "/api/me/persona", { persona: "exam_blocked" });
    const r = await request("POST", `/api/drafts/${did}/send`, {});
    expect(r.status).toBe(403);
    const d1 = (await r.json()).detail as Json;
    expect(d1.status).toBe("blocked_exam");
    expect(d1.toast_success).toBe(false);
    const ses = await (await request("GET", `/api/sessions/${sid}`)).json();
    expect((ses.messages as Json[]).some((m) => m.kind === "error_card")).toBe(true);

    await request("POST", "/api/me/persona", { persona: "permission_blocked" });
    const r2 = await request("POST", `/api/drafts/${did}/send`, {});
    expect(r2.status).toBe(403);
    expect(((await r2.json()).detail as Json).status).toBe("blocked_permission");

    await request("POST", "/api/me/persona", { persona: "sriphy" });
    await request("PATCH", `/api/drafts/${did}`, { template_id: "wrong.template" });
    const r3 = await request("POST", `/api/drafts/${did}/send`, {});
    expect(r3.status).toBe(400);
    expect(((await r3.json()).detail as Json).status).toBe("blocked_template");
  });

  it("employee persona cannot open admin mode", async () => {
    await request("POST", "/api/me/persona", { persona: "employee" });
    const me = await (await request("GET", "/api/me")).json();
    expect(me.handle).toBe("lingong");
    expect(me.role).toBe("employee");
    expect(me.available_modes).toEqual(["employee"]);
    expect(me.roles).toEqual(["employee"]);
    await request("POST", "/api/me/persona", { persona: "sriphy" });
    const admin = await (await request("GET", "/api/me")).json();
    expect(admin.available_modes).toEqual(["employee", "admin"]);
  });

  it("restart restores the normal operator after an exam-block demo", async () => {
    await request("POST", "/api/me/persona", { persona: "exam_blocked" });
    expect(((await (await request("GET", "/api/me")).json()) as Json).exam_passed).toBe(false);
    seedIfEmpty();
    const me = await (await request("GET", "/api/me")).json();
    expect((me as Json).exam_passed).toBe(true);
    expect(me.handle).toBe("sriphy");
  });

  it("one-click translation returns the model-produced internal Chinese draft", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const did = String(draftOn(sid).id);
    const translated = await request("POST", `/api/drafts/${did}/translate`);
    expect(translated.status).toBe(200);
    const body = await translated.json();
    const english = String(draftOn(sid).body_en || "");
    expect(String(body.zh)).toMatch(/[\u4e00-\u9fff]/);
    expect(String(body.zh)).not.toBe(english);
    expect(String(body.zh)).not.toContain(`【内部中文译稿 · 不会进入 SMTP】\n${english}`.trim());
    expect(body.internal_only).toBe(true);
  });

  it("maps a Starry operator mailbox onto the authorized From dropdown and still translates", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const draft = persistDraft(sid, {
      skill: "email_compose",
      from: "larry.zhao@amperetime.com",
      to: "xiaomei.beauty@example.com",
      subject: "Collaboration Opportunity with LiTime",
      body: "Hi,\n\nWe would love to collaborate.\n",
      official_stage: "INITIAL_CONTACT",
      collaboration_id: "col_xiaomei",
      brand: "RO",
    });
    expect(String(draft.from_addr)).toBe("larry.zhao@amperetime.com");
    expect(String(draft.body_zh_internal)).toMatch(/[\u4e00-\u9fff]/);
    const card = emailCardPayload(draft);
    const opts = (card.allowed_from_mailboxes as Json[]) || [];
    expect(card.from).toBe("larry.zhao@amperetime.com");
    expect(card.send_from).toBe(BRAND_MAILBOXES.RO);
    expect(opts.some((row) => row.email === card.send_from)).toBe(true);
    const translated = await request("POST", `/api/drafts/${draft.id}/translate`);
    expect(translated.status).toBe(200);
    const zh = String((await translated.json()).zh);
    expect(zh).toMatch(/[\u4e00-\u9fff]/);
    expect(zh).not.toContain("We would love to collaborate");
    const sent = await request("POST", `/api/drafts/${draft.id}/send`, {
      from_addr: "larry.zhao@amperetime.com",
      to_addr: "xiaomei.beauty@example.com",
    });
    expect(sent.status, await sent.text()).toBe(200);
    expect((await sent.json()).status).toBe("sent");
  });

  it("generates an internal Chinese draft when the cache is empty", async () => {
    const [sid] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    const draft = persistDraft(sid, {
      skill: "email_compose",
      template_id: "stage_mail.followup",
      from: BRAND_MAILBOXES.LT,
      to: "xiaomei.beauty@example.com",
      subject: "Following up — LiTime collab kit",
      body: "Hi,\n\nJust a follow-up.\n",
      body_zh_internal: " ",
      official_stage: "INITIAL_CONTACT",
      collaboration_id: "col_xiaomei",
    });
    getConn().prepare("UPDATE drafts SET body_zh_internal='' WHERE id=?").run(String(draft.id));
    const translated = await request("POST", `/api/drafts/${draft.id}/translate`);
    expect(translated.status).toBe(200);
    const body = await translated.json();
    expect(String(body.zh)).toMatch(/[\u4e00-\u9fff]/);
    expect(String(body.zh)).not.toContain("Just a follow-up");
    expect(String((getConn().prepare("SELECT body_zh_internal FROM drafts WHERE id=?").get(String(draft.id)) as { body_zh_internal: string }).body_zh_internal)).toMatch(/[\u4e00-\u9fff]/);
  });

  it("go rejected on messages", async () => {
    const ses = await (await request("POST", "/api/sessions", { title: "x" })).json();
    const r = await request("POST", `/api/sessions/${ses.id}/messages`, { text: "打开建联流水线", act: "go" });
    expect(r.status).toBe(400);
  });

  it("yellow sys msg has no confirm", async () => {
    const [, data] = await ask("记状态 @小美妆日记", "confirm_stage", "col_xiaomei");
    for (const y of (data.messages as Json[]).filter((m) => m.kind === "sys_msg")) {
      expect((y.payload as Json).has_confirm).toBe(false);
    }
  });

  it("home exposes every catalog task as ask and Skill-backed", async () => {
    const home = await (await request("GET", "/api/home")).json();
    const recs = home.recs as Json[];
    expect(recs).toHaveLength(SKILL_CATALOG.length);
    expect(new Set(recs.map((rec) => rec.intent))).toEqual(new Set(SKILL_CATALOG.map((skill) => skill.id)));
    expect(recs.every((rec) => rec.act === "ask" && rec.intent === rec.id)).toBe(true);
    expect(recs.every((rec) => rec.category && rec.group && rec.profile)).toBe(true);
    expect(recs.some((rec) => rec.act === "go")).toBe(false);
    for (const rec of recs) {
      const intent = classify(String(rec.prompt), String(rec.intent));
      expect(intent.skill, String(rec.id)).toBe(rec.id);
      expect(intent.needs_worker, String(rec.id)).toBe(true);
    }
  });

  it("home board loads the Starry library, not demo seed KOLs", async () => {
    const board = await (await request("GET", "/api/home/board")).json() as Json;
    const kols = board.kols as Json[];
    const tasks = board.tasks as Json[];
    const tabs = board.tabs as Json[];
    const library = board.library as Json;
    expect(tabs).toHaveLength(17);
    expect(library).toMatchObject({ ok: true, source: "starry", tool: "listAllKolProfiles" });
    expect(kols.length).toBe(Number(library.count));
    expect(kols.some((row) => row.handle === "小美妆日记")).toBe(false);
    const starryKol = kols.find((row) => row.handle === "户外电源达人") as Json;
    expect(starryKol).toBeTruthy();
    expect(String(starryKol.kol_name)).toBe("户外电源达人");
    expect(String(starryKol.kol_uid || starryKol.kolUid)).toBe("KOLTEST001");
    expect(String(starryKol.current_stage)).toContain("初步接触");
    expect(String(starryKol.suggested_stage)).toBe("已回复-有兴趣");
    expect(String(starryKol.collab_summary)).toMatch(/LT|陈组长/);
    expect(tabs[0]).toMatchObject({ code: "all", count: kols.length });
    expect(tasks.length).toBeGreaterThanOrEqual(6);
    const workbench = board.workbench as Json;
    expect(workbench).toBeTruthy();
    expect((workbench.summary as Json).open).toBeGreaterThanOrEqual(2);
    expect((workbench.insights as Json[]).every((row) => row.source === "ai" && !row.promoted_at)).toBe(true);
  });

  it("every catalog skill has a file and explicit profile", () => {
    for (const skill of SKILL_CATALOG) {
      const skillPath = path.join(import.meta.dirname, `../skills/${skill.id}/SKILL.md`);
      expect(fs.existsSync(skillPath), skill.id).toBe(true);
      expect(profileFor(skill.id).id, skill.id).toBe(skill.profile);
      const md = fs.readFileSync(skillPath, "utf8");
      expect(md, skill.id).toContain("## 禁止事项");
      expect(md, skill.id).toContain("## 是否发信");
      expect(md, skill.id).toContain("## 是否改阶段");
    }
  });

  it("every home task runs a worker, shows process/real operations, and produces a right-side artifact", async () => {
    const home = await (await request("GET", "/api/home")).json();
    const recs = home.recs as Json[];
    const beforePipeline = await (await request("GET", "/api/pipeline")).json();
    const beforeRows = Object.values(beforePipeline.groups as Record<string, Json[]>).flat();
    const beforeStages = new Map(
      beforeRows.map((row) => [String(row.id), String(row.stage_code)]),
    );
    const artifactKinds = new Set([
      "task_result_card",
      "email_card",
      "confirm_stage_card",
      "inbound_card",
      "supplement_card",
      "steps",
    ]);
    for (const rec of recs) {
      const [, data] = await ask(String(rec.prompt), String(rec.intent));
      const messages = data.messages as Json[];
      if (rec.id === "confirm_stage") {
        expect((data.worker as Json)?.skill, String(rec.id)).toBe("confirm_stage");
        expect(messages.some((message) => ["confirm_stage_card", "supplement_card"].includes(String(message.kind))), `${rec.id}: artifact`).toBe(true);
        continue;
      }
      if (rec.id === "deal_memory" || rec.id === "stage_sop" || String(rec.id).startsWith("sop_")) {
        expect((data.worker as Json)?.skill, String(rec.id)).toBe(rec.id);
        expect(messages.some((message) => message.kind === "task_result_card"), `${rec.id}: artifact`).toBe(true);
        continue;
      }
      if (isKolClawTask(String(rec.id)) || isStarryKolTask(String(rec.id))) {
        const prefix = isStarryKolTask(String(rec.id)) ? "starrykol." : "kolclaw.";
        expect((data.worker as Json)?.skill, String(rec.id)).toBe(rec.id);
        const card = messages.find((message) => message.kind === "task_result_card");
        expect(card?.payload, `${rec.id}: host mcp result`).toMatchObject({
          type: "task_result",
          skill: rec.id,
          persistent: true,
        });
        const operation = messages.find((message) => message.kind === "operation_trace");
        if (operation) {
          expect((operation.payload as Json)?.title, `${rec.id}: operation title`).toBe("远程MCP调用");
          const operationItems = (operation.payload as Json).items as Json[];
          expect(operationItems.every((item) => String(item.name || "").startsWith(prefix)),
            `${rec.id}: only ${prefix} operations`).toBe(true);
        }
        continue;
      }
      expect((data.worker as Json)?.skill, String(rec.id)).toBe(rec.id);
      expect(messages.some((message) => message.kind === "process_trace"), `${rec.id}: process`).toBe(true);
      const operation = messages.find((message) => message.kind === "operation_trace");
      if (operation) {
        expect((operation.payload as Json)?.title, `${rec.id}: operation title`).toBe("远程MCP调用");
        expect(Array.isArray((operation.payload as Json)?.items), `${rec.id}: operation items`).toBe(true);
        const operationItems = (operation.payload as Json).items as Json[];
        expect(operationItems.some((item) => String(item.name || "").startsWith("phase:")),
          `${rec.id}: no simulated phase operations`).toBe(false);
      }
      expect(messages.some((message) => artifactKinds.has(String(message.kind))), `${rec.id}: artifact`).toBe(true);
    }
    const after = await (await request("GET", "/api/pipeline")).json();
    const afterRows = Object.values(after.groups as Record<string, Json[]>).flat();
    for (const row of afterRows) {
      expect(String(row.stage_code), `task catalog changed ${row.id}`).toBe(beforeStages.get(String(row.id)));
    }
    const sends = (await (await request("GET", "/api/audit?event_type=starry.send")).json()) as unknown as Json[];
    expect(sends).toHaveLength(0);
  });

  it("风险扫描 uses Starry KOL MCP through a worker turn", async () => {
    for (const prompt of ["风险扫描", "扫描在途风险", "超时/风险扫描", "扫描", "T8"]) {
      const [, data] = await ask(prompt);
      expect((data.intent as Json).type, prompt).toBe("risk_scan");
      expect((data.intent as Json).skill, prompt).toBe("risk_scan");
      expect((data.worker as Json)?.skill, prompt).toBe("risk_scan");
      const card = (data.messages as Json[]).find((message) => message.kind === "task_result_card");
      expect(card?.payload, prompt).toMatchObject({
        type: "task_result",
        skill: "risk_scan",
        title: "超时/风险扫描",
      });
      expect(JSON.stringify((card?.payload as Json).sections), prompt).toContain("风险汇总");
      expect(JSON.stringify((card?.payload as Json).sections), prompt).toContain("T8 失联与延期");
      const operation = (data.messages as Json[]).find((message) => message.kind === "operation_trace");
      const items = ((operation?.payload as Json)?.items || []) as Json[];
      expect(items.map((item) => item.name), prompt).toEqual([
        "starrykol.pageRiskConversations",
        "starrykol.summarizeRiskConversations",
      ]);
    }
    const cron = await request("POST", "/api/cron/risk-scan");
    expect(cron.status, await cron.text()).toBe(200);
    const cronBody = await cron.json() as Json;
    expect(cronBody.run_id).toBeTruthy();
    expect(cronBody.session_id).toBeUndefined();
    expect(cronBody.worker).toBeUndefined();
  });

  it("market hides ops skills", async () => {
    const market = (await (await request("GET", "/api/skills/market")).json()) as unknown as Json[];
    const ids = new Set(market.map((s) => s.id));
    const titles = market.map((s) => s.title).join(" ");
    expect(ids.has("inbound_extract")).toBe(false);
    expect(titles).not.toContain("经营复盘");
    expect(titles).not.toContain("数据清洗");
    expect(titles).not.toContain("周报");
  });

  it("admin connectors p0 only", async () => {
    const admin = await (await request("GET", "/api/admin")).json();
    const labels = (admin.connectors as Json[]).map((c) => c.label);
    expect(labels).toEqual(["企业邮箱", "企业微信"]);
    expect(admin.hidden_connectors).toContain("飞书多维表");
    expect(admin.hidden_connectors).toContain("本地文件夹");
    expect((admin.sop as Json).operator_can_edit).toBe(false);
    expect((admin.sop as Json).owner).toBe("admin");
  });

  it("sessions hide platform examples", async () => {
    const rows = (await (await request("GET", "/api/sessions")).json()) as unknown as Json[];
    const titles = rows.map((s) => s.title);
    expect(titles).not.toContain("加班申请");
    expect(titles).not.toContain("华北渠道");
  });

  it("skills api uses Chinese labels", async () => {
    const skills = (await (await request("GET", "/api/skills")).json()) as unknown as Json[];
    const compose = skills.find((s) => s.id === "email_compose");
    expect(compose?.title).toBe("写合作邮件");
    expect(compose?.label).toBe("写合作邮件");
    expect(compose?.funnel).toBe("biz");
    expect(compose?.sop_editable).toBe(false);
    expect(compose).not.toHaveProperty("body");
    expect(skills.find((s) => s.id === "creator_discovery")?.title).toBe("达人发现");
    expect(JSON.stringify(skills)).not.toContain("starry.get_collaboration");
    expect(JSON.stringify(skills)).not.toContain("mcp:");
    expect(skills.find((s) => s.id === "risk_scan")?.funnel).toBe("exception");
  });

  it("skills sop is edited on the skills api and copied into the box", async () => {
    const denied = await request("PUT", "/api/skills/creator_discovery/sop", { summary: "x", body: "# y\n" });
    expect(denied.status).toBe(403);
    const bad = await request("POST", "/api/login", { username: "test", password: "123456789" });
    expect(bad.status).toBe(401);
    const auth = await request("POST", "/api/login", { username: "鄢棽", password: "123456789" });
    expect(auth.status, await auth.text()).toBe(200);
    const put = await request("PUT", "/api/skills/creator_discovery/sop", {
      summary: "测试改过的达人发现摘要",
      body: "# 达人发现\n\nOPERATOR_SOP_MARK crawl_plan only.\n",
    });
    expect(put.status, await put.text()).toBe(200);
    const pj = await put.json();
    expect(pj.edited).toBe(true);
    expect(pj.summary).toBe("测试改过的达人发现摘要");
    const skills = (await (await request("GET", "/api/skills")).json()) as unknown as Json[];
    const discovery = skills.find((s) => s.id === "creator_discovery");
    expect(discovery?.summary).toBe("测试改过的达人发现摘要");
    expect(discovery?.edited).toBe(true);
    expect(discovery).not.toHaveProperty("body");
    const one = await request("GET", "/api/skills/creator_discovery");
    expect(one.status).toBe(200);
    expect((await one.json()).body).toContain("OPERATOR_SOP_MARK");
    const missing = await request("PUT", "/api/skills/no_such_skill/sop", { summary: "x", body: "y" });
    expect(missing.status).toBe(404);
    const [sid, data] = await ask("搜索 YouTube 露营达人", "creator_discovery");
    expect((data.worker as Json)?.id).toBeTruthy();
    const workers = (await (await request("GET", "/api/workers")).json()) as unknown as Json[];
    const w = workers.find((row) => row.session_id === sid);
    expect(w?.box_path).toBeTruthy();
    const md = fs.readFileSync(path.join(String(w!.box_path), "SKILL.md"), "utf8");
    expect(md).toContain("OPERATOR_SOP_MARK");
    const del = await request("DELETE", "/api/skills/creator_discovery/sop");
    expect(del.status).toBe(200);
    expect((await del.json()).edited).toBe(false);
  });

  it("pm assigns skills and ungranted skills cannot start", async () => {
    const auth = await request("POST", "/api/login", { username: "鄢棽", password: "123456789" });
    expect(auth.status, await auth.text()).toBe(200);
    const listed = await request("GET", "/api/admin/skills");
    expect(listed.status).toBe(200);
    const pack = await listed.json();
    expect(((pack.directory as Json).orgs as Json[]).some((o) => o.id === "org_litime")).toBe(true);
    const put = await request("PUT", "/api/admin/skills/creator_discovery/grants", { org: [], team: [], user: [] });
    expect(put.status, await put.text()).toBe(200);
    const mine = (await (await request("GET", "/api/skills")).json()) as unknown as Json[];
    expect(mine.find((s) => s.id === "creator_discovery")).toBeFalsy();
    const ses = await (await request("POST", "/api/sessions", { title: "no-discovery" })).json();
    const r = await request("POST", `/api/sessions/${ses.id}/messages`, { text: "搜索 YouTube 露营达人", act: "ask", intent: "creator_discovery" });
    expect(r.status).toBe(400);
  });

  it("profiles api exposes capability domains on one Codex harness", async () => {
    const profiles = (await (await request("GET", "/api/profiles")).json()) as unknown as Json[];
    expect(profiles).toHaveLength(6);
    expect(profiles.map((profile) => profile.name)).toContain("Settlement-Growth");
    expect(profiles.every((profile) => profile.harness === "codex-app-server")).toBe(true);
  });

  it("attachments persist on disk and into CONTEXT.md", async () => {
    const form = new FormData();
    form.append("file", new File(["weekend van test notes"], "brief.txt", { type: "text/plain" }));
    const up = await app.request("/api/attachments", { method: "POST", body: form });
    expect(up.status).toBe(200);
    const att = (await up.json()) as { id: string; name: string; path: string; size: number; type: string };
    expect(att.name).toBe("brief.txt");
    expect(att.id).toMatch(/^att_/);
    expect(att.size).toBeGreaterThan(0);
    expect(fs.existsSync(att.path)).toBe(true);
    const recent = (await (await request("GET", "/api/files/recent")).json()) as unknown as Json[];
    expect(recent[0]).toMatchObject({ id: att.id, name: "brief.txt", available: true });
    const projects = (await (await request("GET", "/api/projects")).json()) as unknown as Json[];
    expect(projects.some((project) => project.id === "col_xiaomei" && project.label === "小美妆日记")).toBe(true);
    const [sid, data] = await ask("搜索 YouTube 露营达人", "creator_discovery", undefined, 200, {
      attachments: [{ name: att.name, path: att.path }],
    });
    expect((data.intent as Json).extras).toMatchObject({
      attachments: [{ name: "brief.txt", path: att.path }],
    });
    const workers = (await (await request("GET", "/api/workers")).json()) as unknown as Json[];
    const w = workers.find((row) => row.session_id === sid);
    expect(w?.box_path).toBeTruthy();
    const ctx = fs.readFileSync(path.join(String(w!.box_path), "CONTEXT.md"), "utf8");
    expect(ctx).toContain("brief.txt");
    expect(ctx).toContain("weekend van test notes");
    expect(fs.existsSync(path.join(String(w!.box_path), "attachments", "brief.txt"))).toBe(true);
  });

  it("creator_profile is a catalog skill and does not send mail", async () => {
    const [, data] = await ask(
      "为 bili 创作者 cr_bili_NDI3NDk0ODcw（硬核拆解）创建创作者画像任务",
      "creator_profile",
    );
    expect((data.intent as Json).type).toBe("creator_profile");
    expect((data.intent as Json).extras).toMatchObject({ creator_id: "cr_bili_NDI3NDk0ODcw" });
    expect(data.draft ?? null).toBeNull();
    expect((data.messages as Json[]).map((m) => m.kind)).not.toContain("email_card");
    const types = ((await (await request("GET", "/api/audit")).json()) as unknown as Json[]).map((e) => e.event_type);
    expect(types).not.toContain("starry.send");
  });

  it("market lists creator_profile", async () => {
    const market = (await (await request("GET", "/api/skills/market")).json()) as unknown as Json[];
    expect(market.some((s) => s.id === "creator_profile")).toBe(true);
  });
});

void getConn;
