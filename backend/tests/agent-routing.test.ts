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
import { employeeAgentPreferences, employeeAgentWorkspace, updateEmployeeAgentPreference, resumeEmployeeAgentSession } from "../src/agents/employee-workspace.js";
import { postgresQuery } from "../src/postgres/pool.js";
import { employeeAgentBrowse } from "../src/agents/employee-browse.js";

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
  // Apply this feature's exact production migration to the isolated fixture DB.
  await postgresQuery(fs.readFileSync(new URL("../migrations/038_employee_agent_preferences.sql", import.meta.url), "utf8"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-agent-route-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  await resetConn();
  await seedAll();
  const dir = path.join(tmp, "published-skills", skillId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nid: ${skillId}\ntitle: 产品咨询\ndescription: 查询产品规格和使用方法\ncategory: 产品\nprofile: commander\noutput: task_result\nmcp: ["knowledge.ask_documents"]\nrequired_inputs: []\npermissions: []\nactions: ["analyze"]\naliases: ["产品参数"]\nin_market: true\n---\n依据绑定知识库回答产品问题，给出来源。\n`);
  clearTaskRegistryCache();
  const now = new Date().toISOString();
  (await getConn().query("INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [user.id, user.username, user.name, "x", JSON.stringify(user.roles), "[]", user.site, 1, now, now]));
  const person = (await syncUserOrganization(user.id, user.site));
  const agent = (await createManagedAgent({ name: "产品专家", description: "负责产品规格、选型和使用咨询" }));
  agentId = agent.id;
  (await setAgentSkill(agentId, skillId, true, 0));
  (await getConn().query("INSERT INTO skill_lifecycle (skill_id,stage,updated_at) VALUES ($1,$2,$3)", [skillId, "published", now]));
  bindingId = (await createAgentBinding({ agent_id: agentId, target_type: "person", target_id: person,
    company_id: "company:amperetime", source: "test" })).id;
  (await updateManagedAgent(agentId, { status: "published", expected_version: 1 }));
});

afterEach(async () => {
  setTaskClassifier();
  setJevIntentFetch();
  setIntentLlmFetch();
  vi.restoreAllMocks();
  clearTaskRegistryCache();
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.LINGONG_DATA;
  delete process.env.OPENROUTER_API_KEY;
});

describe("employee Agent routing", () => {
  it("projects classification from visible published knowledge bound to a qualified skill, and removes revoked scope", async () => {
    const previousAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "enabled";
    try {
      const now = new Date().toISOString();
      await postgresQuery("INSERT INTO knowledge_bindings(id,skill_id,selector,enabled,created_at,updated_at) VALUES($1,$2,$3,1,$4,$4)",
        ["browse-fixture", skillId, JSON.stringify({ ids: ["kb_mail_followup", "kb_mail_nudge", "kb_quote"] }), now]);
      // Restrict an otherwise generic reference; the browse projection must respect the knowledge visibility kernel.
      await postgresQuery("INSERT INTO knowledge_grants(id,knowledge_id,scope,scope_id,granted_by,granted_at) VALUES($1,$2,$3,$4,$5,$6)",
        ["browse-hidden", "kb_quote", "user", "other-handle", user.id, now]);
      const brandedUser = { ...user, brands: ["LT"] };
      const browse = await withScopedUser(brandedUser, async () => (await employeeAgentBrowse()));
      const own = browse.rows.find(row => row.expert_id === agentId)!;
      expect(own.scopes).toEqual([expect.objectContaining({ brand: "LT", stage_codes: ["INITIAL_CONTACT", "INTERESTED"] })]);
      expect(own.scopes[0].base_id).toBeTruthy();
      expect(own.scopes[0].domain_id).toBeTruthy();
      expect(own.scopes[0].family_id).toBeTruthy();
      expect(browse.taxonomy.bases.some(base => base.id === own.scopes[0].base_id)).toBe(true);
      expect(own.updated_at).toBeTruthy();
      expect(own.published_by).toBeNull(); // No fabricated publisher for a legacy release without provenance.
      await postgresQuery("UPDATE knowledge_bindings SET enabled=0 WHERE id=$1", ["browse-fixture"]);
      expect((await withScopedUser(brandedUser, async () => (await employeeAgentBrowse()))).rows.find(row => row.expert_id === agentId)?.scopes).toEqual([]);
      (await asUser(async () => (await revokeAgentBinding(bindingId))));
      expect((await withScopedUser(brandedUser, async () => (await employeeAgentBrowse()))).rows.some(row => row.expert_id === agentId)).toBe(false);
    } finally {
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = previousAuthMode;
    }
  });

  it("persists favorites and recent views for the current account, independently", async () => {
    await asUser(async () => (await updateEmployeeAgentPreference(agentId, { favorite: true })));
    const viewed = await asUser(async () => (await updateEmployeeAgentPreference(agentId, { viewed: true })));
    expect(viewed).toMatchObject({ expert_id: agentId, favorite: true });
    expect(viewed.viewed_at).toBeTruthy();
    expect(await asUser(async () => (await employeeAgentPreferences()))).toEqual([viewed]);
    const unpinned = await asUser(async () => (await updateEmployeeAgentPreference(agentId, { favorite: false })));
    expect(unpinned).toMatchObject({ favorite: false, viewed_at: viewed.viewed_at });
    const other = { ...user, id: "usr_other", username: "other" };
    const now = new Date().toISOString();
    await postgresQuery("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [other.id, other.username, "另一位产品员工", "fixture", '["employee"]', "[]", other.site, 1, now, now]);
    const otherPerson = (await syncUserOrganization(other.id, other.site));
    (await createAgentBinding({ agent_id: agentId, target_type: "person", target_id: otherPerson, company_id: "company:amperetime", source: "test" }));
    expect(await withScopedUser(other, async () => (await employeeExperts()))).toContainEqual(expect.objectContaining({ id: agentId }));
    expect(await withScopedUser(other, async () => (await employeeAgentPreferences()))).toEqual([]);
    await expect(asUser(async () => (await updateEmployeeAgentPreference(agentId, { favorite: "true" })))).rejects.toThrow();
    await expect(asUser(async () => (await updateEmployeeAgentPreference(agentId, { viewed: false })))).rejects.toThrow();
  });

  it("rechecks publication and qualification for preferences, details and continuation", async () => {
    await asUser(async () => (await updateEmployeeAgentPreference(agentId, { favorite: true })));
    const session = (await asUser(async () => (await summonEmployeeAgent(agentId))));
    (await asUser(async () => (await revokeAgentBinding(bindingId))));
    expect(await asUser(async () => (await employeeAgentPreferences()))).toEqual([]);
    await expect(asUser(async () => (await employeeAgentWorkspace(agentId)))).rejects.toThrow();
    await expect(asUser(async () => (await updateEmployeeAgentPreference(agentId, { viewed: true })))).rejects.toThrow();
    await expect(asUser(async () => (await resumeEmployeeAgentSession(agentId, String(session.session_id))))).rejects.toThrow();
  });

  it("projects published skills and resumes only an active owned session of this Agent", async () => {
    const session = (await asUser(async () => (await summonEmployeeAgent(agentId))));
    const countBefore = await postgresQuery<{ count: string }>("SELECT COUNT(*) AS count FROM sessions");
    const workspace = await asUser(async () => (await employeeAgentWorkspace(agentId)));
    expect(workspace.skills).toEqual([expect.objectContaining({ id: skillId, name: "产品咨询" })]);
    expect(workspace.knowledge).toEqual([{ skill_id: skillId, skill_name: "产品咨询", bases: [] }]);
    expect(workspace.recent_session?.id).toBe(session.session_id);
    expect(await asUser(async () => (await resumeEmployeeAgentSession(agentId, String(session.session_id)))))
      .toMatchObject({ session_id: session.session_id, expert_id: agentId });
    expect(await postgresQuery("SELECT COUNT(*) AS count FROM sessions")).toEqual(countBefore);
    await postgresQuery("UPDATE sessions SET owner_user_id=$1 WHERE id=$2", ["usr_other", session.session_id]);
    expect((await asUser(async () => (await employeeAgentWorkspace(agentId)))).recent_session).toBeNull();
    await expect(asUser(async () => (await resumeEmployeeAgentSession(agentId, String(session.session_id))))).rejects.toThrow();
    await postgresQuery("UPDATE sessions SET owner_user_id=$1,expert_id=$2 WHERE id=$3", [user.id, "agent:other", session.session_id]);
    await expect(asUser(async () => (await resumeEmployeeAgentSession(agentId, String(session.session_id))))).rejects.toThrow();
    await postgresQuery("UPDATE sessions SET expert_id=$1,archived_at=$2 WHERE id=$3", [agentId, new Date().toISOString(), session.session_id]);
    await expect(asUser(async () => (await resumeEmployeeAgentSession(agentId, String(session.session_id))))).rejects.toThrow();
    expect((await asUser(async () => (await employeeAgentWorkspace(agentId)))).recent_session).toBeNull();
  });

  it("does not invent missing inputs for a valid product question when the model asks for fields", async () => {
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId,
      confidence: 0.84, clarification_kind: "missing_fields", missing_fields: ["product_model"] }));
    const { tasks } = await import("../src/routers/tasks.js");
    const response = await asUser(async () => (await tasks.request("/tasks/from-text", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "有什么产品，产品的功能是？", source: "text" }) })));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ needs_clarification: false, clarification_kind: "none",
      resolution: { task_type: skillId, agent_id: agentId, missing_fields: [], needs_clarification: false },
      task: { status: "pending" } });
    const run = await asUser(async () => (await tasks.request(`/tasks/${body.task.id}/run`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: "{}" })));
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
      expect(await asUser(async () => (await recognizeTaskIntent({ text: "有什么产品？功能是什么？", agent_id: agentId }))))
        .toMatchObject({ agent_id: agentId, task_type: skillId, needs_clarification: false });
      setTaskClassifier(async () => ({ task_type: null, confidence: 0.2 }));
      const outside = await asUser(async () => (await recognizeTaskIntent({ text: "给 发货通知 运单号 承运商 ETA", agent_id: agentId })));
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
      const session = (await asUser(async () => (await summonEmployeeAgent(agentId))));
      const result = await asUser(async () => (await Promise.resolve((await runner.runWorker(String(session.session_id), skillId, "有什么产品？功能是什么？", { agent_id: agentId, derive_child: true })))));
      expect(result.status).toBe("done");
      expect(result.contract_log.some(entry => entry.method === "thread/start")).toBe(true);
      expect(result.contract_log.some(entry => entry.method === "thread/fork")).toBe(false);
    } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  });

  it("lists and summons a published managed Agent with a persisted entry binding", async () => (await asUser(async () => {
    expect((await employeeExperts())).toContainEqual(expect.objectContaining({ id: agentId, display_name: "产品专家", skill_ids: [skillId] }));
    const session = (await summonEmployeeAgent(agentId));
    expect((await getConn().query("SELECT expert_id,expert_version FROM sessions WHERE id=$1", [session.session_id])).rows[0])
      .toMatchObject({ expert_id: agentId, expert_version: "2" });
  })));

  it("does not expose an unbound Agent, and revocation removes an existing entry", async () => (await asUser(async () => {
    (await revokeAgentBinding(bindingId));
    expect((await availableAgentRoutes()).some(route => route.agent_id === agentId)).toBe(false);
    await expect((async () => (await employeeExpert(agentId)))()).rejects.toThrow();
    await expect((async () => (await summonEmployeeAgent(agentId)))()).rejects.toThrow();
  })));

  it("removes disabled Agents and unpublished skills from the candidate catalog", async () => (await asUser(async () => {
    (await updateManagedAgent(agentId, { status: "disabled", expected_version: 2 }));
    expect(await availableAgentRoutes(agentId)).toEqual([]);
    (await updateManagedAgent(agentId, { status: "published", expected_version: 3 }));
    (await getConn().query("UPDATE skill_lifecycle SET stage='draft' WHERE skill_id=$1", [skillId]));
    expect(await availableAgentRoutes(agentId)).toEqual([]);
  })));

  it("retains the model-selected Agent when the same skill also belongs to the default Agent", async () => {
    (await setAgentSkill("agent:kol", skillId, true, 0));
    const person = (await syncUserOrganization(user.id, user.site));
    (await createAgentBinding({ agent_id: "agent:kol", target_type: "person", target_id: person, company_id: "company:amperetime", source: "test" }));
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.99 }));
    const result = await asUser(async () => (await recognizeTaskIntent({ text: "该产品的规格是什么？" })));
    expect(result).toMatchObject({ agent_id: agentId, agent_name: "产品专家", task_type: skillId, clarification_kind: "none" });
    setTaskClassifier(async () => ({ task_type: skillId, confidence: 0.99 }));
    expect(await asUser(async () => (await recognizeTaskIntent({ text: "该产品的规格是什么？" }))))
      .toMatchObject({ task_type: null, clarification_kind: "direction" });
  });

  it("rejects an invented Agent/skill pair and restricts explicit entries to their assembled skills", async () => {
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: "agent_other", confidence: 0.99 }));
    expect(await asUser(async () => (await recognizeTaskIntent({ text: "产品参数" })))).toMatchObject({ task_type: null, clarification_kind: "direction" });
    setTaskClassifier(async () => ({ task_type: "email_compose", agent_id: agentId, confidence: 0.99 }));
    expect(await asUser(async () => (await recognizeTaskIntent({ text: "写邮件", agent_id: agentId })))).toMatchObject({ task_type: null, clarification_kind: "direction" });
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.4 }));
    expect(await asUser(async () => (await recognizeTaskIntent({ text: "随便问问" })))).toMatchObject({ task_type: null, clarification_kind: "direction" });
  });

  it("persists routing through task creation and passes the same identity to the Worker", async () => {
    const { createApp } = await import("../src/app.js");
    const app = (await createApp());
    setTaskClassifier(async () => ({ task_type: skillId, agent_id: agentId, confidence: 0.99 }));
    const request = async (url: string, body: unknown) => (await asUser(async () => (await app.request(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }))));
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
    const result = await request(`/api/sessions/${pending.session_id || ((await getConn().query("SELECT session_id FROM tickets WHERE id=$1", [task.id])).rows[0] as { session_id: string }).session_id}/messages`, pending);
    // Stub dispatch is synchronous: the deliberate Worker rejection must surface as failure.
    expect(result.status).toBe(500);
    await vi.waitFor(() => expect(worker).toHaveBeenCalled(), { timeout: 10000 });
    expect(worker.mock.calls[0][3]?.agent_id).toBe(agentId);
    await vi.waitFor(async () => expect((await getConn().query("SELECT status FROM task_runs WHERE id=$1", [pending.run_id])).rows[0]).toMatchObject({ status: "failed" }), { timeout: 10000 });
  });

  it("gives Luna/Codex only qualified pairs and Jev selects the same pair in one classification", async () => {
    process.env.OPENROUTER_API_KEY = "fixture-only";
    const routes = (await asUser(async () => (await availableAgentRoutes(agentId))));
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

  it("does not query unpublished document resources, and rejects a revoked running authorization", async () => {
    const now = new Date().toISOString();
    (await getConn().query("INSERT INTO knowledge_domains(id,code,name,level,parent_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", ["kfamily_test", "family_fixture", "产品业务族", "family", null, "active", now, now]));
    (await getConn().query("INSERT INTO knowledge_domains(id,code,name,level,parent_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", ["kdom_test", "domain_fixture", "产品资料", "domain", "kfamily_test", "active", now, now]));
    (await getConn().query("INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,owner_user_id,status,settings,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", ["kb_product", "kb_product", "产品知识库", "kdom_test", "unstructured", "", user.id, "active", "{}", 1, now, now]));
    (await getConn().query("INSERT INTO knowledge_bindings (id,skill_id,selector,enabled,note,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", ["kb_bind_product", skillId, JSON.stringify({ base_ids: ["kb_product"] }), 1, "test", now, now]));
    const query = vi.spyOn(documents, "queryDocuments").mockResolvedValue({ answer: "资料答案", citations: [{ document_id: "doc_product", page: 2 }] });
    const execution = new SkillExecution({ agentId, skillId, userId: user.id, runId: "route-doc-test" });
    try {
      const catalog = await execution.discover();
      const tool = catalog.tools.find(tool => tool.remoteName === "knowledge.ask_documents")!;
      await expect(execution.invoke(String(tool.exposed.name), { query: "产品参数" })).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
      query.mockClear();
      (await revokeAgentBinding(bindingId));
      await expect(execution.invoke(String(tool.exposed.name), { query: "再次查询" })).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    } finally { execution.close(); }
  });
});
