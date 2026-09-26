import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import {
  approveKnowledge,
  archiveKnowledge,
  assertMailTemplateSnapshotApplicable,
  cite,
  createKnowledge,
  editKnowledge,
  knowledgeRow,
} from "../src/host/knowledge.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";

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

function removeSeededMailTemplates(): void {
  const conn = getConn();
  const ids = (conn.prepare("SELECT id FROM knowledge WHERE kind='mail_template'").all() as Array<{ id: string }>)
    .map((row) => row.id);
  for (const id of ids) {
    conn.prepare("DELETE FROM knowledge_deprecations WHERE knowledge_id=?").run(id);
    conn.prepare("DELETE FROM knowledge_citations WHERE knowledge_id=?").run(id);
    conn.prepare("DELETE FROM knowledge_versions WHERE knowledge_id=?").run(id);
    conn.prepare("DELETE FROM knowledge WHERE id=?").run(id);
  }
}

// approveKnowledge 现在强制带 expected_version（kb 的乐观并发契约），
// 直接调用的测试助手按当前版本号审核即可。
function approveCurrentVersion(id: string): void {
  approveKnowledge(id, Number(knowledgeRow(id).current_version || 1));
}

function addPublishedTemplate(input: {
  id: string;
  title?: string;
  brand?: string;
  stages?: string[];
  subject?: string;
  body?: string;
  placeholders?: string[];
}): void {
  createKnowledge({
    id: input.id,
    title: input.title || input.id,
    body: "template source",
    kind: "mail_template",
    skill_id: "email_compose",
    brand: input.brand || "LT",
    subject: input.subject || "Original subject for [红人]",
    body_en: input.body || "Original body for [红人].",
    placeholders: input.placeholders || ["[红人]"],
    stage_codes: input.stages || ["INITIAL_CONTACT"],
    status: "draft",
  });
  approveCurrentVersion(input.id);
  cite(input.id);
}

async function prepare(input: Json = {}): Promise<Reply> {
  return request("POST", "/api/email-compose/prepare", {
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-compose-prepare-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.LG_DATA_DIR = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
  removeSeededMailTemplates();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("POST /api/email-compose/prepare", () => {
  it("is read-only and returns exactly one authoritative published template", async () => {
    addPublishedTemplate({ id: "mail_one" });
    const conn = getConn();
    const before = {
      drafts: Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n),
      messages: Number((conn.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n),
      workItems: Number((conn.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n),
      runs: Number((conn.prepare("SELECT COUNT(*) AS n FROM task_runs").get() as { n: number }).n),
      stage: String((conn.prepare("SELECT stage_code FROM collaborations WHERE id=?").get("col_xiaomei") as { stage_code: string }).stage_code),
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
      drafts: Number((conn.prepare("SELECT COUNT(*) AS n FROM drafts").get() as { n: number }).n),
      messages: Number((conn.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n),
      workItems: Number((conn.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n),
      runs: Number((conn.prepare("SELECT COUNT(*) AS n FROM task_runs").get() as { n: number }).n),
      stage: String((conn.prepare("SELECT stage_code FROM collaborations WHERE id=?").get("col_xiaomei") as { stage_code: string }).stage_code),
    };
    expect(after).toEqual(before);
  });

  it("uses the session-bound collaboration and rejects a conflicting request scope", async () => {
    addPublishedTemplate({ id: "mail_one" });
    const sid = await newSession();
    getConn().prepare("UPDATE sessions SET collaboration_id=? WHERE id=?").run("col_xiaomei", sid);

    const response = await request("POST", "/api/email-compose/prepare", {
      skill_id: "email_compose",
      session_id: sid,
      collaboration_id: "col_laozhang",
    });
    expect(response.status).toBe(409);
    expect(detailCode(response)).toBe("collaboration_conflict");
  });

  it("requires a single scoped collaboration rather than guessing across object refs", async () => {
    addPublishedTemplate({ id: "mail_one" });
    const response = await request("POST", "/api/email-compose/prepare", {
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
    addPublishedTemplate({ id: "mail_a", title: "A" });
    addPublishedTemplate({ id: "mail_b", title: "B" });

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
    addPublishedTemplate({
      id: "mail_snapshot",
      subject: "Published subject",
      body: "Published body for [红人].",
    });
    editKnowledge("mail_snapshot", {
      subject: "UNPUBLISHED NEW SUBJECT",
      body_en: "UNPUBLISHED NEW BODY must never leak.",
    });

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

    const pinned = assertMailTemplateSnapshotApplicable({
      knowledgeId: "mail_snapshot",
      version: 1,
      skillId: "email_compose",
      stageCode: "INITIAL_CONTACT",
      brand: "LT",
    });
    expect(pinned.version).toBe(1);
    expect(pinned.body_en).toBe("Published body for [红人].");
  });

  it("does not offer disabled, archived, hidden, or uncited templates", async () => {
    const scenarios: Array<{ id: string; disable: () => void; code: string }> = [
      {
        id: "mail_disabled",
        disable: () => getConn().prepare("UPDATE knowledge SET in_market=0 WHERE id=?").run("mail_disabled"),
        code: "knowledge_disabled",
      },
      {
        id: "mail_archived",
        disable: () => { archiveKnowledge("mail_archived"); },
        code: "knowledge_unapproved",
      },
      {
        id: "mail_hidden",
        disable: () => getConn().prepare(
          "INSERT INTO knowledge_deprecations (user_id,knowledge_id,reason,reason_note,deprecated_at) VALUES (?,?,?,?,?)",
        ).run(DEMO_USER.id, "mail_hidden", "outdated", "hidden in test", new Date().toISOString()),
        code: "knowledge_deprecated",
      },
      {
        id: "mail_uncited",
        disable: () => getConn().prepare("DELETE FROM knowledge_citations WHERE user_id=? AND knowledge_id=?")
          .run(DEMO_USER.id, "mail_uncited"),
        code: "knowledge_uncited",
      },
    ];

    for (const scenario of scenarios) {
      removeSeededMailTemplates();
      addPublishedTemplate({ id: scenario.id });
      scenario.disable();
      const response = await prepare({ knowledge_id: scenario.id });
      expect(response.status, `${scenario.id}: ${response.text}`).toBe(403);
      expect(detailCode(response)).toBe(scenario.code);
    }
  });

  it("rejects a pinned compose draft when authoritative stage or brand applicability has been revoked", async () => {
    addPublishedTemplate({ id: "mail_scoped" });
    const prepared = await prepare({ knowledge_id: "mail_scoped" });
    const contextVersion = String(prepared.body.context_version);
    expect(prepared.body.status).toBe("ready");

    getConn().prepare("UPDATE collaborations SET stage_code='QUOTE_PENDING' WHERE id='col_xiaomei'").run();
    const staleStage = await submitEditedDraft({
      knowledgeId: "mail_scoped",
      knowledgeVersion: 1,
      contextVersion,
    });
    expect(staleStage.status, staleStage.text).toBe(403);
    expect(detailCode(staleStage)).toBe("knowledge_stage");

    getConn().prepare("UPDATE collaborations SET stage_code='INITIAL_CONTACT', brand='RO' WHERE id='col_xiaomei'").run();
    const staleBrand = await submitEditedDraft({
      knowledgeId: "mail_scoped",
      knowledgeVersion: 1,
      contextVersion,
    });
    expect(staleBrand.status, staleBrand.text).toBe(403);
    expect(detailCode(staleBrand)).toBe("knowledge_brand");
  });

  it("rejects an unpublished/stale template version rather than accepting a current draft revision", async () => {
    addPublishedTemplate({ id: "mail_version" });
    editKnowledge("mail_version", { body_en: "Revision two is not yet published." });
    const response = await submitEditedDraft({ knowledgeId: "mail_version", knowledgeVersion: 2 });
    expect(response.status, response.text).toBe(403);
    expect(detailCode(response)).toBe("knowledge_publish_pending");
  });

  it("preserves employee-authored subject/body through the stub harness without sending", async () => {
    addPublishedTemplate({ id: "mail_authored" });
    editKnowledge("mail_authored", { body_en: "A later unpublished edit." });
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
    const stored = getConn().prepare("SELECT subject,body_en,status,extra FROM drafts WHERE id=?")
      .get(String(draft.id)) as { subject: string; body_en: string; status: string; extra: string };
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
    addPublishedTemplate({ id: "mail_incomplete", body: "Hello [红人], the budget is [金额USD].", placeholders: ["[红人]", "[金额USD]"] });
    const response = await prepare();
    expect(response.body.status).toBe("needs_fields");
    expect((response.body.editor as Json).body).toContain("[金额USD]");
    expect(response.body.missing_fields).toContain("[金额USD]");
  });

  it("rejects a stale address context before starting the worker", async () => {
    addPublishedTemplate({ id: "mail_context" });
    const prepared = await prepare();
    getConn().prepare("UPDATE collaborations SET email='changed@example.com' WHERE id='col_xiaomei'").run();
    const reply = await submitEditedDraft({ knowledgeId: "mail_context", knowledgeVersion: 1, contextVersion: String(prepared.body.context_version) });
    expect(reply.status).toBe(409);
    expect(detailCode(reply)).toBe("compose_context_stale");
  });

  it("pins an already prepared published version when a newer one is approved", async () => {
    addPublishedTemplate({ id: "mail_pinned" });
    const prepared = await prepare();
    editKnowledge("mail_pinned", { body_en: "The newly published version must not silently replace this draft." });
    approveCurrentVersion("mail_pinned");
    const response = await submitEditedDraft({ knowledgeId: "mail_pinned", knowledgeVersion: 1, contextVersion: String(prepared.body.context_version) });
    expect(response.status, response.text).toBe(200);
    expect((response.body.draft as Json).extra).toMatchObject({ knowledge_version: 1 });
    expect((response.body.draft as Json).body_en).toBe("This exact authored body must remain unchanged.");
  });

  it("never accepts a nonexistent source draft as revision authority", async () => {
    addPublishedTemplate({ id: "mail_source" });
    const reply = await submitEditedDraft({ knowledgeId: "mail_source", knowledgeVersion: 1, sourceDraftId: "does-not-exist" });
    expect(reply.status).toBe(404);
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM starry_sends").get()).toMatchObject({ n: 0 });
  });

  it("keeps the legacy knowledge picker on the approved snapshot too", async () => {
    addPublishedTemplate({ id: "mail_picker_snapshot", body: "Approved picker body." });
    editKnowledge("mail_picker_snapshot", { body_en: "UNPUBLISHED picker body must not appear." });
    const rows = await request("GET", "/api/knowledge/composer");
    expect(JSON.stringify(rows.body)).toContain("Approved picker body.");
    expect(JSON.stringify(rows.body)).not.toContain("UNPUBLISHED picker body");
  });

  it("blocks placeholder sender addresses in real mode before any network call", async () => {
    const previous = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "appserver";
    try {
      const { assertMailGatewayReady } = await import("../src/host/mail-send-confirmation.js");
      expect(() => assertMailGatewayReady({ from_addr: "kol.lt@litime.example" })).toThrow("示例地址不能用于真实外发");
      expect(() => assertMailGatewayReady({ from_addr: "sender@brand.com", cc: "reviewer@brand.com" })).toThrow("抄送契约");
      expect(() => assertMailGatewayReady({ from_addr: "sender@brand.com", to_addr: "one@brand.com,two@brand.com" })).toThrow("单个收件人");
    } finally {
      if (previous === undefined) delete process.env.CODEX_MODE;
      else process.env.CODEX_MODE = previous;
    }
  });
});
