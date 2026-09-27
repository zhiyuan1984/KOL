import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { clearTaskRegistryCache, requireTaskDefinition, taskDefinitions } from "../src/tasks/registry.js";
import { skillTemplate } from "../src/tasks/skill-template.js";
import { resolveTaskIntent } from "../src/tasks/resolver.js";
import { setTaskClassifier } from "../src/tasks/recognize.js";
import { effectiveRuntimeSkillBody, effectiveSkillTemplate, saveSkillSop, writeSkillIntoBox } from "../src/host/skill-sop.js";
import { knowledge } from "../src/routers/knowledge.js";

type Json = Record<string, any>;
let tmp: string;
let app: Hono;
const skillId = "creator_library_query";
const initialEnv = { AUTH_MODE: process.env.AUTH_MODE, CODEX_MODE: process.env.CODEX_MODE,
  LINGONG_DB: process.env.LINGONG_DB, LINGONG_DATA: process.env.LINGONG_DATA };
async function request(method: string, url: string, body?: unknown) {
  const res = await app.request(url, { method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() as Json };
}
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-interaction-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "disabled";
  resetConn();
  clearTaskRegistryCache();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});
afterEach(() => {
  setTaskClassifier();
  resetConn();
  clearTaskRegistryCache();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(initialEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe("one Skill / one knowledge interaction template", () => {
  it("projects one stable template per employee skill without exposing executable source", async () => {
    const res = await request("GET", "/api/knowledge/skill-templates");
    expect(res.status).toBe(200);
    const templates = res.body as unknown as Json[];
    const definitions = taskDefinitions().filter((item) => item.employee_visible);
    expect(templates).toHaveLength(definitions.length);
    expect(new Set(templates.map((item) => item.skill_id)).size).toBe(templates.length);
    for (const template of templates) {
      expect(template.id).toBe(`skill-template:${template.skill_id}`);
      expect(template.version).toMatch(/^[a-f0-9]{64}$/);
      expect(template).toMatchObject({ kind: "skill_template", read_only: true, source: "skill" });
      expect(template).not.toHaveProperty("mcp");
      expect(template).not.toHaveProperty("path");
      expect(template).not.toHaveProperty("body");
    }
  });

  it("uses the exact same creator contract in knowledge and task definitions", async () => {
    const template = (await request("GET", `/api/knowledge/skill-templates/${skillId}`)).body;
    const definitions = (await request("GET", "/api/task-definitions")).body as unknown as Json[];
    expect(definitions.find((item) => item.id === skillId)?.ui_template).toEqual(template);
    expect(template.inputs).toEqual(requireTaskDefinition(skillId).input_schema);
    expect(template.steps).toHaveLength(3);
    expect(template.starter).toBe("达人库查询");
    expect(template.inputs.every((field: Json) => !field.required)).toBe(true);
    expect(template.description).not.toMatch(/Codex|MCP|Host/);
  });

  it("only puts required user fields into the starter, not optional inputs or purpose", () => {
    const definition = { ...requireTaskDefinition(skillId), required_inputs: ["handle", "limit"], input_schema: [
      { key: "handle", label: "达人", kind: "text" as const, required: true },
      { key: "keyword", label: "关键词", kind: "text" as const, required: false },
      { key: "limit", label: "数量", kind: "number" as const, required: true, default: 20 },
    ] };
    expect(skillTemplate(definition).starter).toBe("达人库查询\n达人：[达人]");
  });

  it("does not synthesize an unregistered procedure for legacy skills", () => {
    const template = skillTemplate({ ...requireTaskDefinition(skillId), interaction: undefined });
    expect(template.steps).toEqual([]);
    expect(template.description).toBe(requireTaskDefinition(skillId).description);
  });

  it("does not turn a skill template into an editable mail template", async () => {
    const res = await request("POST", "/api/admin/knowledge", {
      title: "冲突的模板", body: "替代执行说明", kind: "skill_template", skill_id: skillId,
    });
    expect(res.status).toBe(400);
    expect((await request("GET", `/api/knowledge/skill-templates/${skillId}`)).body.title).toBe("达人库查询");
  });

  it("rejects interaction/input drift while loading a published manifest", () => {
    const root = path.join(tmp, "bad-skills");
    fs.mkdirSync(path.join(root, skillId), { recursive: true });
    const source = fs.readFileSync(requireTaskDefinition(skillId).path, "utf8");
    const file = path.join(root, skillId, "SKILL.md");
    fs.writeFileSync(file, source.replace('required_inputs: []', 'required_inputs: ["keyword"]'));
    expect(() => taskDefinitions(root)).toThrow(/required_inputs must match/);
    fs.writeFileSync(file, source.replace(/^input_schema:.*\n/m, ""));
    expect(() => taskDefinitions(root)).toThrow(/interaction requires input_schema/);
    fs.writeFileSync(file, source.replace('"purpose":', '"invented_field":'));
    expect(() => taskDefinitions(root)).toThrow(/unsupported field/);
  });

  it("filters ungranted skills and rechecks detail access after a grant is revoked", async () => {
    process.env.AUTH_MODE = "enabled";
    const now = new Date().toISOString();
    getConn().prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run("template-user", "template-user", "Template user", "no-login", '["employee"]', '[]', "", 1, now, now);
    const user = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get("template-user") as Json);
    const scoped = (url: string) => withScopedUser(user, () => knowledge.request(url));
    expect(await (await scoped("/knowledge/skill-templates")).json()).toEqual([]);
    getConn().prepare("INSERT INTO user_skill_grants(user_id,skill_id,created_at) VALUES(?,?,?)").run(user.id, skillId, now);
    expect((await (await scoped("/knowledge/skill-templates")).json() as Json[]).map((item) => item.skill_id)).toEqual([skillId]);
    getConn().prepare("DELETE FROM user_skill_grants WHERE user_id=?").run(user.id);
    // Bare router uses Hono's default 500 response for thrown HttpFail; invoke
    // through a wrapper that preserves the status, as createApp normally does.
    const { Hono } = await import("hono");
    const deniedApp = new Hono();
    deniedApp.onError((error: any, c) => c.json({ error: error.message }, error.status || 500));
    deniedApp.route("/", knowledge);
    expect((await withScopedUser(user, () => deniedApp.request(`/knowledge/skill-templates/${skillId}`))).status).toBe(403);
  });
});

describe("template parameters are execution parameters", () => {
  it("treats required form placeholders as missing and accepts the actual value", () => {
    const id = "template_test_required";
    const root = path.join(tmp, "published-skills", id);
    const original = fs.readFileSync(requireTaskDefinition(skillId).path, "utf8");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "SKILL.md"), original.replace(`id: ${skillId}`, `id: ${id}`)
      .replace('required_inputs: []', 'required_inputs: ["keyword"]')
      .replace('"key":"keyword","label":"关键词","kind":"text","required":false',
        '"key":"keyword","label":"关键词","kind":"text","required":true'));
    const missing = resolveTaskIntent({ task_type: id, entities: { keyword: "[关键词]" }, input: { keyword: "[关键词]" } });
    expect(missing.missing_fields).toEqual(["keyword"]);
    expect(missing.entities.keyword).toBeUndefined();
    expect(resolveTaskIntent({ task_type: id, input: { keyword: "钓鱼" } }).needs_clarification).toBe(false);
  });

  it("does not run direction recognition again for an explicitly selected template", async () => {
    let classified = false;
    setTaskClassifier(async () => { classified = true; throw new Error("must not classify selected skill"); });
    const template = effectiveSkillTemplate(requireTaskDefinition(skillId));
    const result = await request("POST", "/api/tasks/from-text", { text: template.starter, intent: skillId,
      skill_template_version: template.version });
    expect(result.status).toBe(201);
    expect(classified).toBe(false);
    expect(result.body.task.skill_template).toEqual(template);
    expect(result.body.resolution.source).toBe("locked");
  });

  it("allows zero-input library queries and applies declared paging defaults", () => {
    const result = resolveTaskIntent({ task_type: skillId, text: "达人库查询" });
    expect(result.needs_clarification).toBe(false);
    expect(result.entities).toMatchObject({ page_no: 1, page_size: 20, pageNo: 1, pageSize: 20 });
    expect(result.entities.keyword).toBeUndefined();
  });

  it("maps form fields to tool entities and keeps user values ahead of extraction", () => {
    const result = resolveTaskIntent({ task_type: skillId, text: "达人库查询 关键词：旧条件",
      input: { keyword: "房车", page_no: 2, page_size: 10, stage_codes: "CONTACTED", risk_tag_codes: "OVERDUE" } });
    expect(result.entities).toMatchObject({ keyword: "房车", pageNo: 2, pageSize: 10, stageCodes: "CONTACTED", riskTagCodes: "OVERDUE" });
    expect(result.needs_clarification).toBe(false);
  });

  it("does not overwrite free text with empty fields or placeholders", () => {
    const result = resolveTaskIntent({ task_type: skillId, text: "达人库查询 关键词：露营", input: { keyword: "", page_no: "" } });
    expect(result.entities).toMatchObject({ keyword: "露营", pageNo: 1 });
    const placeholder = resolveTaskIntent({ task_type: skillId, text: "达人库查询", entities: { keyword: "[关键词]" } });
    expect(placeholder.entities.keyword).toBeUndefined();
  });

  it.each([0, 51, 1.5, "20"])("rejects invalid page size %s", (page_size) => {
    const result = resolveTaskIntent({ task_type: skillId, input: { page_size } });
    expect(result.needs_clarification).toBe(true);
    expect(result.invalid_fields?.page_size).toBeTruthy();
  });

  it("puts validated fields and a server-authored snapshot into task and run", async () => {
    const created = await request("POST", "/api/tasks", { task_type: skillId, text: "达人库查询",
      input: { keyword: "钓鱼", page_no: 2, _skill_template: { title: "伪造模板" } } });
    expect(created.status).toBe(201);
    expect(created.body.skill_template.title).toBe("达人库查询");
    expect(created.body.entities).toMatchObject({ keyword: "钓鱼", pageNo: 2 });
    const queued = await request("POST", `/api/tasks/${created.body.id}/run`, { input: { _skill_template: { title: "伪造运行" } } });
    expect(queued.status).toBe(202);
    expect(queued.body.pending_message.entities).toMatchObject({ keyword: "钓鱼", pageNo: 2 });
    expect(queued.body.task.skill_template).toEqual(created.body.skill_template);
    const restored = await request("GET", `/api/tasks/by-session/${queued.body.session_id}`);
    expect(restored.body.skill_template).toEqual(created.body.skill_template);
  });
});

describe("template and runtime version binding", () => {
  it("rejects a stale selected template before creating a task", async () => {
    const res = await request("POST", "/api/tasks", { task_type: skillId, input: { skill_template_version: "old" } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("skill_template_version_conflict");
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM work_items WHERE task_type=?").get(skillId)).toMatchObject({ n: 0 });
  });

  it("retains the task snapshot after SOP changes and blocks execution of a different pair", async () => {
    const created = await request("POST", "/api/tasks", { task_type: skillId });
    saveSkillSop(skillId, { body: "# SOP revision\n请返回授权范围的结果。" });
    const updated = effectiveSkillTemplate(requireTaskDefinition(skillId));
    expect(updated.version).not.toBe(created.body.skill_template.version);
    const detail = await request("GET", `/api/tasks/${created.body.id}`);
    expect(detail.body.skill_template).toEqual(created.body.skill_template);
    const run = await request("POST", `/api/tasks/${created.body.id}/run`, {});
    expect(run.status).toBe(409);
  });

  it("checks again between queueing and the first session message", async () => {
    const created = await request("POST", "/api/tasks", { task_type: skillId });
    const queued = await request("POST", `/api/tasks/${created.body.id}/run`, {});
    saveSkillSop(skillId, { body: "# New revision\n请检查输入。" });
    const res = await request("POST", `/api/sessions/${queued.body.session_id}/messages`, queued.body.pending_message);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("skill_template_version_conflict");
    expect(getConn().prepare("SELECT status FROM work_items WHERE id=?").get(created.body.id)).toMatchObject({ status: "needs_clarification" });
  });

  it("mounts the shared schema and boundaries for Codex even with an SOP overlay", () => {
    saveSkillSop(skillId, { body: "# Local note\n提供来源。" });
    const body = effectiveRuntimeSkillBody(skillId);
    expect(body).toContain('"required_inputs":[]');
    expect(body).toContain('"key":"keyword"');
    expect(body).toContain('"side_effects":"none"');
    expect(body).toContain("Runtime connector tools");
    const box = path.join(tmp, "box");
    fs.mkdirSync(box);
    expect(fs.readFileSync(writeSkillIntoBox(box, skillId), "utf8")).toBe(body);
  });
});
