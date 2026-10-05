import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withScopedUser, type AppUser } from "../src/auth.js";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { availableAgentRoutes, withAgentRoutes, routeChoice } from "../src/tasks/agent-routing.js";
import { recognizeTaskIntent, setTaskClassifier } from "../src/tasks/recognize.js";
import { classifyIntentWithJev, intentSystemPrompt, intentOutputSchema, setJevIntentFetch, setIntentLlmFetch } from "../src/tasks/openai-intent.js";
import { createManagedAgent, updateManagedAgent } from "../src/runtime/managed-agents.js";
import { setAgentSkill } from "../src/runtime/store.js";
import { createAgentBinding, revokeAgentBinding, syncUserOrganization } from "../src/runtime/organization-tree.js";
import { employeeExperts, employeeExpert, summonEmployeeAgent } from "../src/runtime/employee-agents.js";
import { SkillExecution } from "../src/runtime/execution.js";
import * as documents from "../src/host/knowledge-documents.js";
import { clearTaskRegistryCache } from "../src/tasks/registry.js";
import { freshTestDatabase } from "./support/pg.js";
import * as runner from "../src/worker/runner.js";

let tmp: string;
let agentId: string;
let bindingId: string;
const skillId = "product_consult_fixture";
const user: AppUser = { id: "usr_product", username: "product-user", name: "产品用户", handle: "product-user",
  roles: ["employee"], role: "employee", brands: [], site: "org:lt_team", manager_user_id: null,
  active: true, exam_passed: true, exam_todo_count: 0, exam_module: "" };
const asUser = <T>(action: () => T): T => withScopedUser(user, action);

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-agent-route-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const dir = path.join(tmp, "published-skills", skillId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nid: ${skillId}\ntitle: 产品咨询\ndescription: 查询产品规格和使用方法\ncategory: 产品\nprofile: commander\noutput: task_result\nmcp: ["knowledge.ask_documents"]\nrequired_inputs: []\npermissions: []\nactions: ["analyze"]\naliases: ["产品参数"]\nin_market: true\n---\n依据绑定知识库回答产品问题，给出来源。\n`);
  clearTaskRegistryCache();
  const now = new Date().toISOString();
  getConn().prepare("INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(user.id, user.username, user.name, "x", JSON.stringify(user.roles), "[]", user.site, 1, now, now);
  const person = syncUserOrganization(user.id, user.site);
  const agent = createManagedAgent({ name: "产品专家", description: "负责产品规格、选型和使用咨询" });
  agentId = agent.id;
  setAgentSkill(agentId, skillId, true, 0);
  getConn().prepare("INSERT INTO skill_lifecycle (skill_id,stage,updated_at) VALUES (?,?,?)").run(skillId, "published", now);
  bindingId = createAgentBinding({ agent_id: agentId, target_type: "person", target_id: person,
    company_id: "company:amperetime", source: "test" }).id;
  updateManagedAgent(agentId, { status: "published", expected_version: 1 });
});

afterEach(() => {
  setTaskClassifier();
  setJevIntentFetch();
  setIntentLlmFetch();
  vi.restoreAllMocks();
  clearTaskRegistryCache();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.LINGONG_DATA;
  delete process.env.OPENROUTER_API_KEY;
});

describe("employee Agent routing", () => {
  it("does not invent missing inputs for a valid product question when the model asks for fields", async () => {
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId,
      confidence: 0.84, clarification_kind: "missing_fields", missing_fields: ["product_model"] }));
    const { tasks } = await import("../src/routers/tasks.js");
    const response = await asUser(() => tasks.request("/tasks/from-text", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "有什么产品，产品的功能是？", source: "text" }) }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ needs_clarification: false, clarification_kind: "none",
      resolution: { task_type: skillId, agent_id: agentId, missing_fields: [], needs_clarification: false },
      task: { status: "pending" } });
    const run = await asUser(() => tasks.request(`/tasks/${body.task.id}/run`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(run.status).toBe(202);
    expect(await run.json()).toMatchObject({ pending_message: { agent_id: agentId, intent: skillId } });
  });

  it("interprets short questions in the selected Agent context and escalates uncertain Jev to Luna", async () => {
    const saved = Object.fromEntries(["INTENT_LLM_MODE", "OPENROUTER_API_KEY", "OPENAI_API_KEY"].map(key => [key, process.env[key]]));
    Object.assign(process.env, { INTENT_LLM_MODE: "real", OPENROUTER_API_KEY: "fixture", OPENAI_API_KEY: "fixture" });
    setJevIntentFetch(async (_url, init) => {
      expect(String(init?.body)).toContain("selected_agent");
      expect(String(init?.body)).toContain("产品专家");
      return new Response(JSON.stringify({ model: "jev-1.13", answers: { task_type: { type: "choice", choice: "clarification", confidence: 0.24 } } }), { headers: { "Content-Type": "application/json" } });
    });
    setIntentLlmFetch(async (_url, init) => {
      expect(String(init?.body)).toContain("Conversation Agent is already selected");
      return new Response(JSON.stringify({ output_text: JSON.stringify({ agent_id: agentId, task_type: skillId, confidence: 1, entities: {}, missing_fields: [], clarification_kind: "none" }) }));
    });
    try {
      expect(await asUser(() => recognizeTaskIntent({ text: "有什么产品？功能是什么？", agent_id: agentId })))
        .toMatchObject({ agent_id: agentId, task_type: skillId, needs_clarification: false });
      setTaskClassifier(async () => ({ task_type: null, confidence: 0.2 }));
      const outside = await asUser(() => recognizeTaskIntent({ text: "给 发货通知 运单号 承运商 ETA", agent_id: agentId }));
      expect(outside.task_type).toBeNull();
      expect(outside.alternatives.map(route => route.task_type)).toEqual([skillId]);
      expect(outside.next_action).toContain("当前智能体");
    } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  });

  it("starts the first turn of a fresh Commander thread without forking an absent rollout", async () => {
    const keys = ["CODEX_MODE", "CODEX_BIN", "FAKE_CODEX_MODE", "FAKE_CODEX_REJECT_EMPTY_FORK"];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { CODEX_MODE: "real", CODEX_BIN: path.resolve("tests/fixtures/fake-codex.mjs"), FAKE_CODEX_MODE: "task-result-success", FAKE_CODEX_REJECT_EMPTY_FORK: "1" });
    try {
      const session = asUser(() => summonEmployeeAgent(agentId));
      const result = await asUser(() => Promise.resolve(runner.runWorker(String(session.session_id), skillId, "有什么产品？功能是什么？", { agent_id: agentId, derive_child: true })));
      expect(result.status).toBe("done");
      expect(result.contract_log.some(entry => entry.method === "thread/start")).toBe(true);
      expect(result.contract_log.some(entry => entry.method === "thread/fork")).toBe(false);
    } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  });

  it("lists and summons a published managed Agent with a persisted entry binding", () => asUser(() => {
    expect(employeeExperts()).toContainEqual(expect.objectContaining({ id: agentId, display_name: "产品专家", skill_ids: [skillId] }));
    const session = summonEmployeeAgent(agentId);
    expect(getConn().prepare("SELECT expert_id,expert_version FROM sessions WHERE id=?").get(session.session_id))
      .toMatchObject({ expert_id: agentId, expert_version: "2" });
  }));

  it("does not expose an unbound Agent, and revocation removes an existing entry", () => asUser(() => {
    revokeAgentBinding(bindingId);
    expect(availableAgentRoutes().some(route => route.agent_id === agentId)).toBe(false);
    expect(() => employeeExpert(agentId)).toThrow();
    expect(() => summonEmployeeAgent(agentId)).toThrow();
  }));

  it("removes disabled Agents and unpublished skills from the candidate catalog", () => asUser(() => {
    updateManagedAgent(agentId, { status: "disabled", expected_version: 2 });
    expect(availableAgentRoutes(agentId)).toEqual([]);
    updateManagedAgent(agentId, { status: "published", expected_version: 3 });
    getConn().prepare("UPDATE skill_lifecycle SET stage='draft' WHERE skill_id=?").run(skillId);
    expect(availableAgentRoutes(agentId)).toEqual([]);
  }));

  it("retains the model-selected Agent when the same skill also belongs to the default Agent", async () => {
    setAgentSkill("agent:kol", skillId, true, 0);
    const person = syncUserOrganization(user.id, user.site);
    createAgentBinding({ agent_id: "agent:kol", target_type: "person", target_id: person, company_id: "company:amperetime", source: "test" });
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.99 }));
    const result = await asUser(() => recognizeTaskIntent({ text: "该产品的规格是什么？" }));
    expect(result).toMatchObject({ agent_id: agentId, agent_name: "产品专家", task_type: skillId, clarification_kind: "none" });
    setTaskClassifier(async () => ({ task_type: skillId, confidence: 0.99 }));
    expect(await asUser(() => recognizeTaskIntent({ text: "该产品的规格是什么？" })))
      .toMatchObject({ task_type: null, clarification_kind: "direction" });
  });

  it("rejects an invented Agent/skill pair and restricts explicit entries to their assembled skills", async () => {
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: "agent_other", confidence: 0.99 }));
    expect(await asUser(() => recognizeTaskIntent({ text: "产品参数" }))).toMatchObject({ task_type: null, clarification_kind: "direction" });
    setTaskClassifier(async () => ({ task_type: "email_compose", agent_id: agentId, confidence: 0.99 }));
    expect(await asUser(() => recognizeTaskIntent({ text: "写邮件", agent_id: agentId }))).toMatchObject({ task_type: null, clarification_kind: "direction" });
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.4 }));
    expect(await asUser(() => recognizeTaskIntent({ text: "随便问问" }))).toMatchObject({ task_type: null, clarification_kind: "direction" });
  });

  it("persists routing through task creation and passes the same identity to the Worker", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.99 }));
    const request = (url: string, body: unknown) => asUser(() => app.request(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    const created = await request("/api/tasks/from-text", { text: "该产品的规格是什么？" });
    expect(created.status).toBe(201);
    const task = (await created.json()).task;
    expect(task.input.agent_id).toBe(agentId);
    const queued = await request(`/api/tasks/${task.id}/run`, {});
    expect(queued.status).toBe(202);
    const pending = (await queued.json()).pending_message;
    expect(pending.agent_id).toBe(agentId);
    // The persisted run, rather than a browser echo, must supply the chosen Agent.
    delete pending.agent_id;
    const worker = vi.spyOn(runner, "runWorker").mockRejectedValue(new Error("测试仅核验 Worker 输入，停止模拟执行"));
    const result = await request(`/api/sessions/${pending.session_id || (getConn().prepare("SELECT session_id FROM tickets WHERE id=?").get(task.id) as { session_id: string }).session_id}/messages`, pending);
    // Stub dispatch is synchronous: the deliberate Worker rejection must surface as failure.
    expect(result.status).toBe(500);
    await vi.waitFor(() => expect(worker).toHaveBeenCalled(), { timeout: 10000 });
    expect(worker.mock.calls[0][3]?.agent_id).toBe(agentId);
    await vi.waitFor(() => expect(getConn().prepare("SELECT status FROM task_runs WHERE id=?").get(pending.run_id)).toMatchObject({ status: "failed" }), { timeout: 10000 });
  });

  it("gives Luna/Codex only qualified pairs and Jev selects the same pair in one classification", async () => {
    process.env.OPENROUTER_API_KEY = "fixture-only";
    const routes = asUser(() => availableAgentRoutes(agentId));
    await withAgentRoutes(routes, async () => {
      expect(intentSystemPrompt()).toContain(`agent_id=${agentId}`);
      expect(intentSystemPrompt()).not.toContain("- email_compose:");
      expect((intentOutputSchema([skillId]).properties as Record<string, unknown>).agent_id).toEqual({ type: "string", enum: ["", agentId] });
      setJevIntentFetch(async (_url, init) => {
        expect(String(init?.body)).toContain("产品专家");
        return new Response(JSON.stringify({ model: "jev-1.13", answers: { task_type: { type: "choice", choice: routeChoice(routes[0]), confidence: 0.99,
          probabilities: { [routeChoice(routes[0])]: 0.99 } } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0 } }), { status: 200 });
      });
      expect(await classifyIntentWithJev("产品参数" )).toMatchObject({ agent_id: agentId, task_type: skillId });
    });
  });

  it("invokes the document tool with the chosen Agent identity and rejects a revoked running authorization", async () => {
    const now = new Date().toISOString();
    getConn().prepare("INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,owner_user_id,status,settings,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("kb_product", "kb_product", "产品知识库", "kdom_test", "unstructured", "", user.id, "active", "{}", 1, now, now);
    getConn().prepare("INSERT INTO knowledge_bindings (id,skill_id,selector,enabled,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("kb_bind_product", skillId, JSON.stringify({ base_ids: ["kb_product"] }), 1, "test", now, now);
    const query = vi.spyOn(documents, "queryDocuments").mockResolvedValue({ answer: "资料答案", citations: [{ document_id: "doc_product", page: 2 }] });
    const execution = new SkillExecution({ agentId, skillId, userId: user.id, runId: "route-doc-test" });
    try {
      const catalog = await execution.discover();
      const tool = catalog.tools.find(tool => tool.remoteName === "knowledge.ask_documents")!;
      const result = await execution.invoke(String(tool.exposed.name), { query: "产品参数" });
      expect(query).toHaveBeenCalledWith({ query: "产品参数", base_id: "kb_product" }, user.id, expect.any(Function));
      expect(JSON.stringify(result)).toContain(`agent_id=${agentId}`);
      query.mockClear();
      revokeAgentBinding(bindingId);
      await expect(execution.invoke(String(tool.exposed.name), { query: "再次查询" })).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    } finally { execution.close(); }
  });
});
