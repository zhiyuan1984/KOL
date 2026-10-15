import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BRAND_MAILBOXES, DEMO_USER, PERSONAS, type Persona } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { enforceSend } from "../src/host/pep.js";
import {
  archiveKnowledge,
  assertMailTemplateSnapshotApplicable,
  cite,
  createKnowledge,
  editKnowledge,
} from "../src/host/knowledge.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
import { publishKnowledgeEntry } from "./support/knowledge-publication-fixture.js";

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json; text: string };

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown): Promise<Reply> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await app.request(url, init);
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) as Json : {} };
}

/** 发布必须经过真实的独立审批；该夹具不会绕过数据库发布守卫。 */
async function approveCurrentVersion(id: string): Promise<void> {
  await publishKnowledgeEntry(id);
}

async function addPublishedTemplate(input: {
  id: string;
  title?: string;
  brand?: string;
  stages?: string[];
  subject?: string;
  body?: string;
  placeholders?: string[];
  cited?: boolean;
}): Promise<void> {
  await createKnowledge({
    id: input.id,
    title: input.title || input.id,
    body: "template source",
    kind: "mail_template",
    base_id: "kbase_legacy",
    skill_id: "email_compose",
    brand: input.brand || "LT",
    subject: input.subject || "Original subject for [红人]",
    body_en: input.body || "Original body for [红人].",
    placeholders: input.placeholders || ["[红人]"],
    stage_codes: input.stages || ["INITIAL_CONTACT"],
    status: "draft",
  });
  await approveCurrentVersion(input.id);
  if (input.cited !== false) await cite(input.id);
}

async function prepare(input: Json = {}): Promise<Reply> {
  return request("POST", "/api/actions/mail.prepare", {
    skill_id: "email_compose",
    collaboration_id: "col_xiaomei",
    ...input,
  });
}

async function newSession(): Promise<string> {
  const response = await request("POST", "/api/sessions", { title: "compose test" });
  expect(response.status, response.text).toBe(200);
  return String(response.body.id);
}

async function submitEditedDraft(input: {
  knowledgeId: string;
  knowledgeVersion: number;
  contextVersion?: string;
  subject?: string;
  body?: string;
  sourceDraftId?: string | null;
}): Promise<Reply> {
  const sid = await newSession();
  return request("POST", `/api/sessions/${sid}/messages`, {
    act: "ask",
    intent: "email_compose",
    collaboration_id: "col_xiaomei",
    knowledge_id: input.knowledgeId,
    text: "Please continue the selected email draft.",
    compose_input: {
      mode: "edited_draft",
      knowledge_version: input.knowledgeVersion,
      ...(input.contextVersion ? { context_version: input.contextVersion } : {}),
      subject: input.subject || "Edited by the employee",
      body: input.body || "This exact authored body must remain unchanged.",
      source_draft_id: input.sourceDraftId === undefined ? null : input.sourceDraftId,
    },
  });
}

function detailCode(response: Reply): string {
  const detail = response.body.detail;
  return detail && typeof detail === "object" ? String((detail as Json).code || "") : "";
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-compose-prepare-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.LG_DATA_DIR = tmp;
  process.env.CODEX_MODE = "stub";
  (await resetConn());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
  (await seedWorkbenchFixtures());
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/actions/mail.prepare", () => {
  it("is read-only and returns exactly one authoritative published template", async () => {
    (await addPublishedTemplate({ id: "mail_one" }));
    const conn = getConn();
    const before = {
      drafts: Number(((await conn.query("SELECT COUNT(*) AS n FROM drafts",[])).rows[0] as { n: number }).n),
      messages: Number(((await conn.query("SELECT COUNT(*) AS n FROM messages",[])).rows[0] as { n: number }).n),
      workItems: Number(((await conn.query("SELECT COUNT(*) AS n FROM tickets",[])).rows[0] as { n: number }).n),
      runs: Number(((await conn.query("SELECT COUNT(*) AS n FROM task_runs",[])).rows[0] as { n: number }).n),
      stage: String(((await conn.query("SELECT stage_code FROM collaborations WHERE id=$1",["col_xiaomei"])).rows[0] as { stage_code: string }).stage_code),
    };

    const response = await prepare();
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      status: "ready",
      skill_id: "email_compose",
      context: {
        collaboration_id: "col_xiaomei",
        stage_code: "INITIAL_CONTACT",
        stage_source: "collaboration",
        brand: "LT",
      },
      template: { knowledge_id: "mail_one", published_version: 1, source: "knowledge" },
      candidates: [],
    });
    expect(((response.body.editor as Json).to as string[])).toEqual(["xiaomei.beauty@example.com"]);
    expect(String(response.body.context_version || "")).not.toBe("");

    const after = {
      drafts: Number(((await conn.query("SELECT COUNT(*) AS n FROM drafts",[])).rows[0] as { n: number }).n),
      messages: Number(((await conn.query("SELECT COUNT(*) AS n FROM messages",[])).rows[0] as { n: number }).n),
      workItems: Number(((await conn.query("SELECT COUNT(*) AS n FROM tickets",[])).rows[0] as { n: number }).n),
      runs: Number(((await conn.query("SELECT COUNT(*) AS n FROM task_runs",[])).rows[0] as { n: number }).n),
      stage: String(((await conn.query("SELECT stage_code FROM collaborations WHERE id=$1",["col_xiaomei"])).rows[0] as { stage_code: string }).stage_code),
    };
    expect(after).toEqual(before);
  });

  it("uses the session-bound collaboration and rejects a conflicting request scope", async () => {
    (await addPublishedTemplate({ id: "mail_one" }));
    const sid = await newSession();
    (await getConn().query("UPDATE sessions SET collaboration_id=$1 WHERE id=$2",["col_xiaomei",sid]));

    const response = await request("POST", "/api/actions/mail.prepare", {
      skill_id: "email_compose",
      session_id: sid,
      collaboration_id: "col_laozhang",
    });
    expect(response.status).toBe(409);
    expect(detailCode(response)).toBe("collaboration_conflict");
  });

  it("requires a single scoped collaboration rather than guessing across object refs", async () => {
    (await addPublishedTemplate({ id: "mail_one" }));
    const response = await request("POST", "/api/actions/mail.prepare", {
      skill_id: "email_compose",
      object_refs: [
        { kind: "collaboration", id: "col_xiaomei" },
        { kind: "collaboration", id: "col_laozhang" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "needs_context",
      missing_fields: ["collaboration_id"],
    });
  });

  it("returns all tied applicable candidates rather than selecting an arbitrary template", async () => {
    (await addPublishedTemplate({ id: "mail_a", title: "A" }));
    (await addPublishedTemplate({ id: "mail_b", title: "B" }));

    const response = await prepare();
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("needs_template");
    expect((response.body.candidates as Json[]).map((candidate) => candidate.knowledge_id).sort())
      .toEqual(["mail_a", "mail_b"]);
    expect(String(response.body.context_version || "")).not.toBe("");
  });

  it("returns needs_template when no enabled applicable template exists", async () => {
    const response = await prepare();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "needs_template",
      context: { collaboration_id: "col_xiaomei", stage_code: "INITIAL_CONTACT", brand: "LT" },
      candidates: [],
    });
  });

  it("uses only the published snapshot and keeps an unpublished edit out of editor prefill", async () => {
    (await addPublishedTemplate({
      id: "mail_snapshot",
      subject: "Published subject",
      body: "Published body for [红人].",
    }));
    (await editKnowledge("mail_snapshot", {
      subject: "UNPUBLISHED NEW SUBJECT",
      body_en: "UNPUBLISHED NEW BODY must never leak.",
    }));

    const response = await prepare({ knowledge_id: "mail_snapshot" });
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      status: "ready",
      template: { knowledge_id: "mail_snapshot", published_version: 1 },
    });
    const editor = response.body.editor as Json;
    expect(editor.subject).toBe("Published subject");
    expect(editor.body).toBe("Published body for 小美妆日记.");
    expect(JSON.stringify(response.body)).not.toContain("UNPUBLISHED NEW");

    const pinned = (await assertMailTemplateSnapshotApplicable({
      knowledgeId: "mail_snapshot",
      version: 1,
      skillId: "email_compose",
      stageCode: "INITIAL_CONTACT",
      brand: "LT",
    }));
    expect(pinned.version).toBe(1);
    expect(pinned.body_en).toBe("Published body for [红人].");
  });

  it("does not offer disabled, archived, hidden, or uncited templates", async () => {
    const scenarios: Array<{ id: string; cited?: boolean; disable?: () => Promise<void>; code: string }> = [
      {
        id: "mail_disabled",
        disable: async () => { await getConn().query("UPDATE knowledge SET in_market=0 WHERE id=$1",["mail_disabled"]); },
        code: "knowledge_disabled",
      },
      {
        id: "mail_archived",
        disable: async () => { (await archiveKnowledge("mail_archived")); },
        code: "knowledge_unapproved",
      },
      {
        id: "mail_hidden",
        disable: async () => { await getConn().query("INSERT INTO knowledge_deprecations (user_id,knowledge_id,reason,reason_note,deprecated_at) VALUES ($1,$2,$3,$4,$5)",[DEMO_USER.id,"mail_hidden","outdated","hidden in test",new Date().toISOString()]); },
        code: "knowledge_deprecated",
      },
      {
        id: "mail_uncited",
        cited: false,
        code: "knowledge_uncited",
      },
    ];

  for (const scenario of scenarios) {
    await addPublishedTemplate({ id: scenario.id, cited: scenario.cited });
    if (scenario.disable) await scenario.disable();
      const response = await prepare({ knowledge_id: scenario.id });
      expect(response.status, `${scenario.id}: ${response.text}`).toBe(403);
      expect(detailCode(response)).toBe(scenario.code);
    }
  });

  it("rejects a pinned compose draft when authoritative stage or brand applicability has been revoked", async () => {
    (await addPublishedTemplate({ id: "mail_scoped" }));
    const prepared = await prepare({ knowledge_id: "mail_scoped" });
    const contextVersion = String(prepared.body.context_version);
    expect(prepared.body.status).toBe("ready");

    (await getConn().query("UPDATE collaborations SET stage_code='QUOTE_PENDING' WHERE id='col_xiaomei'",[]));
    const staleStage = await submitEditedDraft({
      knowledgeId: "mail_scoped",
      knowledgeVersion: 1,
      contextVersion,
    });
    expect(staleStage.status, staleStage.text).toBe(403);
    expect(detailCode(staleStage)).toBe("knowledge_stage");

    (await getConn().query("UPDATE collaborations SET stage_code='INITIAL_CONTACT', brand='RO' WHERE id='col_xiaomei'",[]));
    const staleBrand = await submitEditedDraft({
      knowledgeId: "mail_scoped",
      knowledgeVersion: 1,
      contextVersion,
    });
    expect(staleBrand.status, staleBrand.text).toBe(403);
    expect(detailCode(staleBrand)).toBe("knowledge_brand");
  });

  it("rejects an unpublished/stale template version rather than accepting a current draft revision", async () => {
    (await addPublishedTemplate({ id: "mail_version" }));
    (await editKnowledge("mail_version", { body_en: "Revision two is not yet published." }));
    const response = await submitEditedDraft({ knowledgeId: "mail_version", knowledgeVersion: 2 });
    expect(response.status, response.text).toBe(403);
    expect(detailCode(response)).toBe("knowledge_publish_pending");
  });

  it("preserves employee-authored subject/body through the stub harness without sending", async () => {
    (await addPublishedTemplate({ id: "mail_authored" }));
    (await editKnowledge("mail_authored", { body_en: "A later unpublished edit." }));
    const prepared = await prepare({ knowledge_id: "mail_authored" });
    expect(prepared.body.status).toBe("ready");

    const response = await submitEditedDraft({
      knowledgeId: "mail_authored",
      knowledgeVersion: 1,
      contextVersion: String(prepared.body.context_version),
      subject: "Employee's final subject",
      body: "Employee's exact final body. Do not regenerate it.",
      sourceDraftId: null,
    });
    expect(response.status, response.text).toBe(200);
    const draft = response.body.draft as Json;
    expect(draft).toMatchObject({
      subject: "Employee's final subject",
      body_en: "Employee's exact final body. Do not regenerate it.",
    });
    const stored = (await getConn().query("SELECT subject,body_en,status,extra FROM drafts WHERE id=$1",[String(draft.id)])).rows[0] as { subject: string; body_en: string; status: string; extra: string };
    expect(stored.subject).toBe("Employee's final subject");
    expect(stored.body_en).toBe("Employee's exact final body. Do not regenerate it.");
    expect(stored.status).not.toBe("sent");
    expect(JSON.parse(stored.extra)).toMatchObject({
      knowledge_id: "mail_authored",
      knowledge_version: 1,
      source_draft_id: null,
    });
  });

  it("propagates compose_input intact through task from-text creation and queued run input", async () => {
    const composeInput = {
      mode: "edited_draft",
      knowledge_version: 1,
      context_version: "context-token-from-prepare",
      subject: "Task authored subject",
      body: "Task authored body must reach the harness.",
      source_draft_id: "draft_task_revision_1",
    };
    const created = await request("POST", "/api/tasks/from-text", {
      task_type: "email_compose",
      collaboration_id: "col_xiaomei",
      knowledge_id: "mail_task_input",
      compose_input: composeInput,
      text: "写合作邮件 发件箱 kol.lt@litime.example 收件人 xiaomei.beauty@example.com 主题 Task authored subject",
    });
    expect(created.status, created.text).toBe(201);
    const task = created.body.task as Json;
    expect((task.input as Json).compose_input).toEqual(composeInput);
    expect((task.input as Json).knowledge_id).toBe("mail_task_input");

    const queued = await request("POST", `/api/tasks/${task.id}/run`, { compose_input: composeInput });
    expect(queued.status, queued.text).toBe(202);
    expect(((queued.body.pending as Json).compose_input)).toEqual(composeInput);
    expect(JSON.parse(String((queued.body.run as Json).input)).compose_input).toEqual(composeInput);
  });
});

describe("mail compose edge invariants", () => {
  it("shows the incomplete published template for editing rather than hiding the body", async () => {
    (await addPublishedTemplate({ id: "mail_incomplete", body: "Hello [红人], the budget is [金额USD].", placeholders: ["[红人]", "[金额USD]"] }));
    const response = await prepare();
    expect(response.body.status).toBe("needs_fields");
    expect((response.body.editor as Json).body).toContain("[金额USD]");
    expect(response.body.missing_fields).toContain("[金额USD]");
  });

  it("rejects a stale address context before starting the worker", async () => {
    (await addPublishedTemplate({ id: "mail_context" }));
    const prepared = await prepare();
    (await getConn().query("UPDATE collaborations SET email='changed@example.com' WHERE id='col_xiaomei'",[]));
    const reply = await submitEditedDraft({ knowledgeId: "mail_context", knowledgeVersion: 1, contextVersion: String(prepared.body.context_version) });
    expect(reply.status).toBe(409);
    expect(detailCode(reply)).toBe("compose_context_stale");
  });

  it("pins an already prepared published version when a newer one is approved", async () => {
    (await addPublishedTemplate({ id: "mail_pinned" }));
    const prepared = await prepare();
    (await editKnowledge("mail_pinned", { body_en: "The newly published version must not silently replace this draft." }));
    (await approveCurrentVersion("mail_pinned"));
    const response = await submitEditedDraft({ knowledgeId: "mail_pinned", knowledgeVersion: 1, contextVersion: String(prepared.body.context_version) });
    expect(response.status, response.text).toBe(200);
    expect((response.body.draft as Json).extra).toMatchObject({ knowledge_version: 1 });
    expect((response.body.draft as Json).body_en).toBe("This exact authored body must remain unchanged.");
  });

  it("never accepts a nonexistent source draft as revision authority", async () => {
    (await addPublishedTemplate({ id: "mail_source" }));
    const reply = await submitEditedDraft({ knowledgeId: "mail_source", knowledgeVersion: 1, sourceDraftId: "does-not-exist" });
    expect(reply.status).toBe(404);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM starry_sends",[])).rows[0] as { n: unknown }).n)).toBe(0);
  });

  it("keeps the legacy knowledge picker on the approved snapshot too", async () => {
    (await addPublishedTemplate({ id: "mail_picker_snapshot", body: "Approved picker body." }));
    (await editKnowledge("mail_picker_snapshot", { body_en: "UNPUBLISHED picker body must not appear." }));
    const rows = await request("GET", "/api/knowledge/composer");
    expect(JSON.stringify(rows.body)).toContain("Approved picker body.");
    expect(JSON.stringify(rows.body)).not.toContain("UNPUBLISHED picker body");
  });

  it("blocks placeholder sender addresses in real mode before any network call", async () => {
    const previous = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "appserver";
    try {
      const { assertMailGatewayReady } = await import("../src/host/mail-send-confirmation.js");
      await expect((async () => (assertMailGatewayReady({ from_addr: "kol.lt@litime.example" })))()).rejects.toThrow("示例地址不能用于真实外发");
      await expect((async () => (assertMailGatewayReady({ from_addr: "sender@brand.com", cc: "reviewer@brand.com" })))()).rejects.toThrow("抄送契约");
      await expect((async () => (assertMailGatewayReady({ from_addr: "sender@brand.com", to_addr: "one@brand.com,two@brand.com" })))()).rejects.toThrow("单个收件人");
    } finally {
      if (previous === undefined) delete process.env.CODEX_MODE;
      else process.env.CODEX_MODE = previous;
    }
  });
});

describe("未指定发件箱时的默认发件箱", () => {
  const MOUNTED = "mailer.lt@litime.com";

  /** 员工自己挂载的 Starry 邮箱 + mailbox_owners 登记的品牌范围。 */
  async function bindMountedMailbox(email: string, brand: string): Promise<Awaited<void>> {
    const conn = getConn();
    const now = new Date().toISOString();
    (await conn.query("INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING",[DEMO_USER.id,DEMO_USER.handle,DEMO_USER.name,"x",JSON.stringify(["employee", "admin"]),JSON.stringify(["LT", "RO", "PQ"]),DEMO_USER.site,1,now,now]));
    (await conn.query("DELETE FROM user_starry_bindings WHERE user_id=$1",[DEMO_USER.id]));
    (await conn.query("INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, status, updated_at)\n       VALUES ($1,$2,1,'connected',$3)",[DEMO_USER.id,email,now]));
    await conn.query(
      `INSERT INTO mailbox_owners (email, brand, owner_name, account_type, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (email) DO UPDATE SET brand=EXCLUDED.brand, owner_name=EXCLUDED.owner_name,
         account_type=EXCLUDED.account_type, status=EXCLUDED.status`,
      [email, brand, DEMO_USER.name, "personal"],
    );
  }

  async function draftRow(from: string): Promise<Awaited<Record<string, unknown>>> {
    const col = (await getConn().query("SELECT email, stage_code FROM collaborations WHERE id='col_xiaomei'",[])).rows[0] as { email: string; stage_code: string };
    return {
      id: "dft_default_sender",
      session_id: "ses_default_sender",
      collaboration_id: "col_xiaomei",
      skill: "email_compose",
      from_addr: from,
      to_addr: col.email,
      cc: "",
      subject: "Following up on the collaboration kit",
      body_en: "Hi,\n\nWe would love to collaborate with you.\n",
      template_id: "email_compose.v1",
      official_stage: col.stage_code,
      status: "draft",
      extra: JSON.stringify({ brand: "LT" }),
    };
  }

  it("defaults the sender to the current user's mounted mailbox", async () => {
    (await addPublishedTemplate({ id: "mail_default_sender", brand: "LT" }));
    (await bindMountedMailbox(MOUNTED, "LT"));
    const response = await prepare();
    expect(response.status, response.text).toBe(200);
    expect(String((response.body.editor as Json).from)).toBe(MOUNTED);
    expect(((response.body.missing_fields as string[]) || [])).not.toContain("from");
  });

  it("keeps the brand mailbox fallback when the user has no mounted mailbox", async () => {
    (await addPublishedTemplate({ id: "mail_no_binding", brand: "LT" }));
    const response = await prepare();
    expect(response.status, response.text).toBe(200);
    expect(String((response.body.editor as Json).from)).toBe(BRAND_MAILBOXES.LT);
  });

  it("sends from the mounted mailbox once it is inside the brand scope", async () => {
    (await bindMountedMailbox(MOUNTED, "LT"));
    expect(async () => (enforceSend((await draftRow(MOUNTED)) as never, DEMO_USER))).not.toThrow();
  });

  it("still refuses an address that is neither a brand mailbox nor the user's own", async () => {
    (await expect((async () => (enforceSend((await draftRow("stranger@litime.com")) as never, DEMO_USER)))()).rejects.toThrow(/From 必须是品牌邮箱/));
  });

  it("refuses the mounted mailbox outside the user's brand scope", async () => {
    (await bindMountedMailbox(MOUNTED, "LT"));
    const restricted: Persona = { ...PERSONAS.permission_blocked };
    (await expect((async () => (enforceSend((await draftRow(MOUNTED)) as never, restricted)))()).rejects.toThrow(/From 必须是品牌邮箱/));
  });
});
