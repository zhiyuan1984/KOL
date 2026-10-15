import { asyncEvery } from "../src/async-collections.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { eightPhaseWalkItems, sopPhaseByStage, SOP_PHASES } from "../src/sops.js";
import { approvalKindForStage, FACT_AUTO_MODES, MAIN_STAGES } from "../src/stages.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
let app: Hono;
let mailSeq = 0;

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

async function insertWalkCollab(): Promise<Awaited<void>> {
  (await getConn().query("INSERT INTO collaborations\n     (id, handle, display_name, brand, platform, followers, email, mailbox_from,\n      lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue,\n      stage_version, recipient_name, phone, address_line, country, postal, sku, qty, locked)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,display_name=EXCLUDED.display_name,brand=EXCLUDED.brand,platform=EXCLUDED.platform,followers=EXCLUDED.followers,email=EXCLUDED.email,mailbox_from=EXCLUDED.mailbox_from,lifecycle_id=EXCLUDED.lifecycle_id,conversation_id=EXCLUDED.conversation_id,stage_code=EXCLUDED.stage_code,days_in_stage=EXCLUDED.days_in_stage,notes=EXCLUDED.notes,overdue=EXCLUDED.overdue,stage_version=EXCLUDED.stage_version,recipient_name=EXCLUDED.recipient_name,phone=EXCLUDED.phone,address_line=EXCLUDED.address_line,country=EXCLUDED.country,postal=EXCLUDED.postal,sku=EXCLUDED.sku,qty=EXCLUDED.qty,locked=EXCLUDED.locked",["col_walk","八段主流程","八段主流程","LT","YouTube","8万","walk@litime.example",BRAND_MAILBOXES.LT,"lc_walk","conv_walk","INITIAL_CONTACT",1,"",0,0,"","","","美国","","LT-MINI-12","1",0]));
}

async function stageOf(): Promise<Awaited<string>> {
  const row = (await getConn().query("SELECT stage_code, stage_version FROM collaborations WHERE id=$1",["col_walk"])).rows[0] as {
    stage_code: string;
    stage_version: number;
  };
  return row.stage_code;
}

async function versionOf(): Promise<Awaited<number>> {
  const row = (await getConn().query("SELECT stage_version FROM collaborations WHERE id=$1",["col_walk"])).rows[0] as {
    stage_version: number;
  };
  return Number(row.stage_version || 0);
}

async function confirmOfficial(sid: string, target: string, reason: string): Promise<Json> {
  const res = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
    stage_code: target,
    collaboration_id: "col_walk",
    expected_version: (await versionOf()),
    reason,
    reason_code: "HUMAN_CONFIRMED",
  });
  expect(res.status, `${(await stageOf())} → ${target}: ${await res.text()}`).toBe(200);
  return res.json();
}

async function hopHuman(sid: string, target: string): Promise<void> {
  const body = await confirmOfficial(sid, target, `人选定 ${target}`);
  expect(body.waiting_approval).toBeFalsy();
  expect((await stageOf())).toBe(target);
}

async function hopApproval(sid: string, target: string): Promise<void> {
  const before = (await stageOf());
  const body = await confirmOfficial(sid, target, `提交 ${target} 审批`);
  expect(body.waiting_approval).toBe(true);
  expect(body.approval_id).toBeTruthy();
  expect((await stageOf())).toBe(before);
  const decided = await request("POST", `/api/approvals/${body.approval_id}/decide`, {
    decision: "approve",
    expected_version: 0,
    idempotency_key: `walk-${body.approval_id}`,
  });
  expect(decided.status, await decided.text()).toBe(200);
  expect((await stageOf())).toBe(target);
}

async function hopFact(sid: string, target: string, mail: { subject: string; body: string }): Promise<void> {
  mailSeq += 1;
  const ingested = await request("POST", "/api/collaborations/col_walk/ingest-mail", {
    ...mail,
    from: "walk@litime.example",
    session_id: sid,
    provider_message_id: `walk_${target}_${mailSeq}`,
  });
  expect(ingested.status, await ingested.text()).toBe(200);
  const body = await ingested.json();
  expect((body.advanced as Json | null)?.advanced, JSON.stringify(body.advanced)).toBe(true);
  expect((await stageOf())).toBe(target);
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-eight-phase-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  (await resetConn());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
  (await seedWorkbenchFixtures());
  (await insertWalkCollab());
  mailSeq = 0;
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("eight-phase main flow", () => {
  it("documents Skill / L3 / approval / fact hops per display phase", () => {
    const walk = eightPhaseWalkItems();
    expect(walk).toHaveLength(10);
    expect(walk[0]).toContain("建联");
    expect(walk[7]).toContain("结算");
    expect(walk.some((item) => item.includes("由人选定具体正式阶段"))).toBe(true);
    expect(walk.some((item) => item.includes("发送邮件不会修改阶段"))).toBe(true);
    expect(walk.some((item) => item.includes("须审批"))).toBe(true);
    expect(approvalKindForStage("PLAN_PENDING")).toBe("stage");
    expect(approvalKindForStage("CONTRACTING")).toBe("stage");
    expect(approvalKindForStage("CONTENT_REVIEW")).toBe("content");
    expect(approvalKindForStage("PUBLISH_PENDING")).toBe("content");
    expect(approvalKindForStage("SETTLING")).toBe("settlement");
    expect(approvalKindForStage("INTERESTED")).toBeNull();
    expect(approvalKindForStage("SHIPPED")).toBeNull();
    expect(FACT_AUTO_MODES.has("物流事实自动")).toBe(true);
    expect(FACT_AUTO_MODES.has("必须审批")).toBe(false);
  });

  it("walks eight display phases via Skill, L3, approval hold, and fact ingest", async () => {
    const opened = await request("POST", "/api/collaborations/col_walk/session", {});
    expect(opened.status, await opened.text()).toBe(200);
    const sid = String((await opened.json()).id);

    const sop = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "阶段SOP @八段主流程",
      content: "阶段SOP @八段主流程",
      act: "ask",
      intent: "stage_sop",
      collaboration_id: "col_walk",
    });
    expect(sop.status, await sop.text()).toBe(200);
    const sopBody = await sop.json();
    const sopText = JSON.stringify(sopBody);
    expect(sopText).toContain("八段怎么走");
    expect(sopText).toContain("发送邮件不会修改阶段");
    expect((await stageOf())).toBe("INITIAL_CONTACT");

    const refuse = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "下一阶段",
      collaboration_id: "col_walk",
      expected_version: 0,
      reason: "口令下一阶段",
    });
    expect(refuse.status).toBe(400);
    expect(await refuse.text()).toContain("必须指定具体目标阶段");
    expect((await stageOf())).toBe("INITIAL_CONTACT");

    const interest = await request("POST", "/api/collaborations/col_walk/ingest-mail", {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate. Tell me more.",
      from: "walk@litime.example",
      session_id: sid,
      provider_message_id: "walk_interest_1",
    });
    expect(interest.status, await interest.text()).toBe(200);
    const interestBody = await interest.json();
    expect((interestBody.judgment as Json).suggested_stage).toBe("INTERESTED");
    expect((interestBody.judgment as Json).auto_propose).toBe(true);
    expect(interestBody.advanced).toBeNull();
    expect((await stageOf())).toBe("INITIAL_CONTACT");
    const msgs = (await (await request("GET", `/api/sessions/${sid}`)).json()) as Json;
    const kinds = ((msgs.messages as Json[]) || []).map((row) => row.kind);
    expect(kinds).toContain("confirm_stage_card");

    const seen = new Set<string>();
    const light = async () => {
      const phase = sopPhaseByStage((await stageOf()));
      if (phase) seen.add(phase.id);
    };
    (await light());

    await hopHuman(sid, "INTERESTED");
    (await light());

    const compose = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写合作邮件 @八段主流程",
      content: "写合作邮件 @八段主流程",
      act: "ask",
      intent: "email_compose",
      collaboration_id: "col_walk",
    });
    expect(compose.status, await compose.text()).toBe(200);
    expect((await stageOf())).toBe("INTERESTED");

    await hopHuman(sid, "EVALUATING");
    (await light());
    await hopHuman(sid, "QUOTE_PENDING");
    (await light());
    await hopHuman(sid, "NEGOTIATING");
    (await light());
    await hopApproval(sid, "PLAN_PENDING");
    (await light());
    await hopApproval(sid, "CONTRACTING");
    (await light());
    await hopHuman(sid, "SAMPLE_PENDING");
    (await light());
    await hopFact(sid, "SHIPPED", {
      subject: "Your LiTime Product Has Shipped",
      body: "The sample shipped via UPS. Tracking number 1Z999AA10123456784.",
    });
    (await light());
    await hopFact(sid, "TESTING", {
      subject: "Sample received",
      body: "The kit arrived yesterday and I have started testing the installation.",
    });
    (await light());
    await hopHuman(sid, "CONTENT_PLANNING");
    (await light());
    await hopApproval(sid, "CONTENT_REVIEW");
    (await light());
    await hopApproval(sid, "PUBLISH_PENDING");
    (await light());
    await hopFact(sid, "PUBLISHED", {
      subject: "Video is live",
      body: "The review is now live on YouTube https://youtube.com/watch?v=walk8phase",
    });
    (await light());
    await hopApproval(sid, "SETTLING");
    (await light());
    await hopHuman(sid, "COMPLETED");

    expect([...seen]).toEqual(SOP_PHASES.map((phase) => phase.id));
    expect((await stageOf())).toBe("COMPLETED");
    expect((await asyncEvery(MAIN_STAGES,async (stage) => (
      stage.code === "INITIAL_CONTACT" || (await versionOf()) >= 1
    )))).toBe(true);

    const terminal = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "INTERESTED",
      collaboration_id: "col_walk",
      expected_version: (await versionOf()),
      reason: "终态不可回主流程",
    });
    expect(terminal.status).toBe(400);
  });

  it("does not move the official stage when a walk mail is sent", async () => {
    const opened = await request("POST", "/api/collaborations/col_walk/session", {});
    const sid = String((await opened.json()).id);
    await hopHuman(sid, "INTERESTED");
    const ask = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写合作邮件 @八段主流程",
      content: "写合作邮件 @八段主流程",
      act: "ask",
      intent: "email_compose",
      collaboration_id: "col_walk",
    });
    expect(ask.status, await ask.text()).toBe(200);
    expect((await stageOf())).toBe("INTERESTED");
  });
});
