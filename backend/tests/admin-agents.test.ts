import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { canUseAgent, listAgentBindings, listOrganizationPeople } from "../src/runtime/organization-tree.js";
import { runtimeAgentCandidates, runtimeAgentForSkill } from "../src/runtime/execution.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let app: Hono;
let adminCookie = "";

type Json = Record<string, unknown>;

async function call(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const response = await app.request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { response, json: (text ? JSON.parse(text) : {}) as Json };
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function insertUser(id: string, name: string, opts: { site?: string; active?: number } = {}): void {
  const now = new Date().toISOString();
  getConn().prepare(
    "INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(id, id, name, "x", JSON.stringify(["employee"]), "[]", opts.site || null, opts.active ?? 1, now, now);
}

function insertBase(id: string, kind: string): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT INTO knowledge_bases (id,code,name,domain_id,kind,description,owner_user_id,status,settings,external_ref,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id, `测试库 ${id}`, "kdom_test", kind, "", "admin", "active", "{}", null, 1, now, now);
}

async function createAgent(name: string): Promise<Json> {
  const created = await call("POST", "/api/admin/agents", { name });
  expect(created.response.status).toBe(201);
  return created.json;
}

async function enableSkill(agentId: string, skillId = "creator_discovery"): Promise<void> {
  const enabled = await call("PUT", `/api/admin/agents/${agentId}/skills/${skillId}`, { enabled: true, expected_version: 0 });
  expect(enabled.response.status).toBe(200);
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-admin-agents-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "enabled";
  resetConn();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const initial = await call("GET", "/api/auth/status", undefined, "");
  expect(initial.json).toMatchObject({ setup_required: true, authenticated: false });
  const setup = await call("POST", "/api/auth/setup", {
    username: "admin",
    name: "Admin",
    password: "admin-password",
    brands: ["LT", "RO", "PQ"],
  }, "");
  expect(setup.response.status).toBe(201);
  adminCookie = setup.response.headers.get("set-cookie")?.split(";")[0] || "";
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "CODEX_MODE"]) delete process.env[key];
});

describe("managed Agent lifecycle", () => {
  it("创建校验拒绝空名与超长，成功即草稿", async () => {
    expect((await call("POST", "/api/admin/agents", { name: "   " })).response.status).toBe(400);
    expect((await call("POST", "/api/admin/agents", { name: "x".repeat(81) })).response.status).toBe(400);

    const agent = await createAgent("KOL 试点 Agent");
    expect(agent).toMatchObject({ status: "draft", version: 1, name: "KOL 试点 Agent" });
    expect(String(agent.id)).toMatch(/^agent_/);
  });

  it("PATCH 版本冲突返回 409，版本匹配才写入", async () => {
    const agent = await createAgent("版本 Agent");
    const agentId = String(agent.id);
    const stale = await call("PATCH", `/api/admin/agents/${agentId}`, { name: "改名", expected_version: 99 });
    expect(stale.response.status).toBe(409);
    const updated = await call("PATCH", `/api/admin/agents/${agentId}`, { name: "改名", expected_version: 1 });
    expect(updated.response.status).toBe(200);
    expect(updated.json).toMatchObject({ name: "改名", version: 2 });
  });
});

describe("publish gate", () => {
  it("发布前必须有已启用技能与绑定；发布后 canUseAgent 通过", async () => {
    const agent = await createAgent("发布 Agent");
    const agentId = String(agent.id);

    const noSkill = await call("PATCH", `/api/admin/agents/${agentId}`, { status: "published", expected_version: 1 });
    expect(noSkill.response.status).toBe(409);
    expect(noSkill.json.detail).toBe("发布前请先装配至少一项技能");

    await enableSkill(agentId);
    const noBinding = await call("PATCH", `/api/admin/agents/${agentId}`, { status: "published", expected_version: 1 });
    expect(noBinding.response.status).toBe(409);
    expect(noBinding.json.detail).toBe("发布前请先绑定组织或人员");

    const bound = await call("POST", `/api/admin/agents/${agentId}/bindings`, {
      target_type: "organization_unit", target_id: "org:lt_team",
    });
    expect(bound.response.status).toBe(200);
    const published = await call("PATCH", `/api/admin/agents/${agentId}`, { status: "published", expected_version: 1 });
    expect(published.response.status).toBe(200);
    expect(published.json.status).toBe("published");

    insertUser("usr_pub", "叶观旺");
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_pub", "person:ye_guanwang");
    expect(canUseAgent("usr_pub", agentId)).toBe(true);
    getConn().prepare("UPDATE users SET active = 0 WHERE id = ?").run("usr_pub");
    expect(canUseAgent("usr_pub", agentId)).toBe(false);
  });

  it("技能装配要求 enabled 与 expected_version", async () => {
    const agent = await createAgent("装配校验 Agent");
    const agentId = String(agent.id);
    const missingEnabled = await call("PUT", `/api/admin/agents/${agentId}/skills/creator_discovery`, { expected_version: 0 });
    expect(missingEnabled.response.status).toBe(400);
    expect(missingEnabled.json.detail).toBe("enabled 与 expected_version 必填");
    const missingVersion = await call("PUT", `/api/admin/agents/${agentId}/skills/creator_discovery`, { enabled: true });
    expect(missingVersion.response.status).toBe(400);
  });
});

describe("knowledge binding", () => {
  it("未装配技能/非结构化库/库不存在被拒；绑定与解绑闭环", async () => {
    const agent = await createAgent("知识库 Agent");
    const agentId = String(agent.id);
    await enableSkill(agentId);
    insertBase("kbase_struct", "structured");
    insertBase("kbase_unstruct", "unstructured");

    const notAssembled = await call("POST", `/api/admin/agents/${agentId}/knowledge`, {
      skill_id: "email_compose", base_id: "kbase_struct",
    });
    expect(notAssembled.response.status).toBe(409);
    expect(notAssembled.json.detail).toBe("先将该技能装配到 Agent");

    const wrongKind = await call("POST", `/api/admin/agents/${agentId}/knowledge`, {
      skill_id: "creator_discovery", base_id: "kbase_unstruct",
    });
    expect(wrongKind.response.status).toBe(409);

    const missing = await call("POST", `/api/admin/agents/${agentId}/knowledge`, {
      skill_id: "creator_discovery", base_id: "kbase_missing",
    });
    expect(missing.response.status).toBe(404);

    const bound = await call("POST", `/api/admin/agents/${agentId}/knowledge`, {
      skill_id: "creator_discovery", base_id: "kbase_struct",
    });
    expect(bound.response.status).toBe(201);
    const binding = rows<{ id: string; skill_id: string }>(bound.json.knowledge).find((row) => row.skill_id === "creator_discovery");
    expect(binding?.id).toBeTruthy();

    const removed = await call("DELETE", `/api/admin/agents/${agentId}/knowledge/${binding?.id}`);
    expect(removed.response.status).toBe(200);
    expect(rows<{ id: string }>(removed.json.knowledge).some((row) => row.id === binding?.id)).toBe(false);
    expect((await call("DELETE", `/api/admin/agents/${agentId}/knowledge/${binding?.id}`)).response.status).toBe(404);
  });
});

describe("binding coverage and levels", () => {
  it("一级/二级/三级组织单元与人员均可绑定，重复幂等、撤销可复活", async () => {
    const agent = await createAgent("绑定 Agent");
    const agentId = String(agent.id);
    const bind = (body: Json) => call("POST", `/api/admin/agents/${agentId}/bindings`, body);
    const coverageOf = (json: Json) => json.coverage as { person_refs: string[]; user_ids: string[] };

    const level3 = await bind({ target_type: "organization_unit", target_id: "org:lt_team" });
    expect(level3.response.status).toBe(200);
    expect(coverageOf(level3.json).person_refs).toContain("person:ye_guanwang");

    const level2 = await bind({ target_type: "organization_unit", target_id: "org:promotion_department" });
    expect(level2.response.status).toBe(200);
    expect(coverageOf(level2.json).person_refs).toContain("person:zhong_jiankui");

    const level1 = await bind({ target_type: "organization_unit", target_id: "org:brand_user_growth_center" });
    expect(level1.response.status).toBe(200);
    expect(coverageOf(level1.json).person_refs).toContain("person:zhang_huiling");

    const invalid = await bind({ target_type: "organization_unit", target_id: "org:not_exists" });
    expect(invalid.response.status).toBe(400);
    expect(invalid.json.detail).toBe("请选择有效的组织单元");

    insertUser("usr_sync", "鄢棽", { site: "org:lt_team" });
    const person = await bind({ target_type: "person", user_id: "usr_sync" });
    expect(person.response.status).toBe(200);
    expect(listOrganizationPeople().find((row) => row.user_id === "usr_sync")?.person_ref).toBe("person:user:usr_sync");
    expect(coverageOf(person.json).user_ids).toContain("usr_sync");

    const before = listAgentBindings(agentId).length;
    const duplicate = await bind({ target_type: "organization_unit", target_id: "org:lt_team" });
    expect(duplicate.response.status).toBe(200);
    expect(listAgentBindings(agentId)).toHaveLength(before);

    const binding = listAgentBindings(agentId).find((row) => row.target_id === "org:lt_team");
    expect(binding).toBeTruthy();
    const revoked = await call("DELETE", `/api/admin/agents/${agentId}/bindings/${binding?.id}`);
    expect(revoked.response.status).toBe(200);
    expect(listAgentBindings(agentId).some((row) => row.id === binding?.id)).toBe(false);

    const revived = await bind({ target_type: "organization_unit", target_id: "org:lt_team" });
    expect(revived.response.status).toBe(200);
    const reborn = listAgentBindings(agentId).find((row) => row.target_id === "org:lt_team");
    expect(reborn?.id).toBe(binding?.id);
    expect(Number(reborn?.binding_version)).toBeGreaterThan(Number(binding?.binding_version));
  });
});

describe("binding change preview", () => {
  it("add 预览给出直接覆盖与负责人继承，且不落库", async () => {
    const agent = await createAgent("预览 Agent");
    const agentId = String(agent.id);
    const preview = await call("POST", `/api/admin/agents/${agentId}/bindings/preview`, {
      target_type: "organization_unit", target_id: "org:lt_team",
    });
    expect(preview.response.status).toBe(200);
    expect((preview.json.before as { person_refs: string[] }).person_refs).toEqual([]);
    const added = rows<{ person_ref: string; via: string }>(preview.json.added);
    const viaByRef = new Map(added.map((row) => [row.person_ref, row.via]));
    expect(viaByRef.get("person:ye_guanwang")).toBe("unit_head");
    expect(viaByRef.get("person:gu_jiarui")).toBe("unit_member");
    expect(viaByRef.get("person:zhong_jiankui")).toBe("ancestor_head");
    expect((preview.json.after as { person_refs: string[] }).person_refs).toEqual(added.map((row) => row.person_ref));
    expect(Number(preview.json.org_version)).toBeGreaterThan(0);
    expect(listAgentBindings(agentId)).toHaveLength(0);
  });

  it("remove 预览给出 removed，且不落库", async () => {
    const agent = await createAgent("撤销预览 Agent");
    const agentId = String(agent.id);
    const bound = await call("POST", `/api/admin/agents/${agentId}/bindings`, {
      target_type: "organization_unit", target_id: "org:lt_team",
    });
    expect(bound.response.status).toBe(200);
    const binding = listAgentBindings(agentId)[0];

    const preview = await call("POST", `/api/admin/agents/${agentId}/bindings/${binding.id}/revoke-preview`);
    expect(preview.response.status).toBe(200);
    const removed = rows<{ person_ref: string; via: string }>(preview.json.removed);
    const removedByRef = new Map(removed.map((row) => [row.person_ref, row.via]));
    expect(removedByRef.get("person:ye_guanwang")).toBe("unit_head");
    expect(removedByRef.get("person:gu_jiarui")).toBe("unit_member");
    expect((preview.json.before as { person_refs: string[] }).person_refs.length).toBe(removed.length);
    expect((preview.json.after as { person_refs: string[] }).person_refs).toEqual([]);
    expect(listAgentBindings(agentId)).toHaveLength(1);
  });

  it("人员预览按 users.site 模拟组织关系，不写 users/site", async () => {
    const agent = await createAgent("人员预览 Agent");
    const agentId = String(agent.id);
    listOrganizationPeople(); // 先触发一次性组织回填，再取基线
    insertUser("usr_preview", "顾嘉瑞", { site: "org:lt_team" });
    const peopleBefore = listOrganizationPeople().length;
    const membershipsBefore = Number(
      (getConn().prepare("SELECT COUNT(*) AS c FROM organization_memberships").get() as { c: number }).c,
    );

    const preview = await call("POST", `/api/admin/agents/${agentId}/bindings/preview`, {
      target_type: "person", user_id: "usr_preview",
    });
    expect(preview.response.status).toBe(200);
    const added = rows<{ person_ref: string; via: string; display_name: string | null }>(preview.json.added);
    const byRef = new Map(added.map((row) => [row.person_ref, row]));
    expect(byRef.get("person:user:usr_preview")).toMatchObject({ via: "binding_target", display_name: "顾嘉瑞" });
    expect(byRef.get("person:ye_guanwang")?.via).toBe("unit_head");

    expect(listOrganizationPeople()).toHaveLength(peopleBefore);
    expect(Number(
      (getConn().prepare("SELECT COUNT(*) AS c FROM organization_memberships").get() as { c: number }).c,
    )).toBe(membershipsBefore);
    expect(listAgentBindings(agentId)).toHaveLength(0);
  });
});

describe("employee Agent sources", () => {
  it("GET /admin/users/:uid/agents 返回 via 来源", async () => {
    const agent = await createAgent("来源 Agent");
    const agentId = String(agent.id);
    await call("POST", `/api/admin/agents/${agentId}/bindings`, { target_type: "organization_unit", target_id: "org:lt_team" });
    await call("POST", `/api/admin/agents/${agentId}/bindings`, { target_type: "person", target_id: "person:yan_chen" });
    const accounts: Array<[string, string, string]> = [
      ["usr_head", "叶观旺", "person:ye_guanwang"],
      ["usr_member", "顾嘉瑞", "person:gu_jiarui"],
      ["usr_ancestor", "钟建奎", "person:zhong_jiankui"],
      ["usr_direct", "鄢棽", "person:yan_chen"],
    ];
    for (const [uid, name, ref] of accounts) {
      insertUser(uid, name);
      getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run(uid, ref);
    }
    const viaOf = async (uid: string): Promise<string | undefined> => {
      const listed = await call("GET", `/api/admin/users/${uid}/agents`);
      expect(listed.response.status).toBe(200);
      return rows<{ id: string; via: string }>(listed.json.agents).find((row) => row.id === agentId)?.via;
    };
    expect(await viaOf("usr_head")).toBe("unit_head");
    expect(await viaOf("usr_member")).toBe("unit_member");
    expect(await viaOf("usr_ancestor")).toBe("ancestor_head");
    expect(await viaOf("usr_direct")).toBe("binding_target");
  });

  it("同一 Agent 绑定研究院与数字智能中心：下级成员继承，两条来源都返回", async () => {
    const agent = await createAgent("线索智能体");
    const agentId = String(agent.id);
    const bulk = await call("POST", `/api/admin/agents/${agentId}/bindings/bulk-preview`, { targets: [
      { target_type: "organization_unit", target_id: "org:research_institute" },
      { target_type: "organization_unit", target_id: "org:digital_intelligence_center" },
    ] });
    expect(bulk.response.status).toBe(200);
    const saved = await call("POST", `/api/admin/agents/${agentId}/bindings/bulk`, {
      targets: [
        { target_type: "organization_unit", target_id: "org:research_institute" },
        { target_type: "organization_unit", target_id: "org:digital_intelligence_center" },
      ],
      org_version: bulk.json.org_version,
    });
    expect(saved.response.status, JSON.stringify(saved.json)).toBe(200);
    expect(rows<{ target_id: string }>((saved.json.agent as Json).bindings).map((row) => row.target_id).sort()).toEqual([
      "org:digital_intelligence_center",
      "org:research_institute",
    ]);
    insertUser("usr_yan", "鄢棽");
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_yan", "person:yan_chen");
    const listed = await call("GET", "/api/admin/users/usr_yan/agents");
    const row = rows<{ id: string; sources: Array<{ via: string; binding_target_id: string }> }>(listed.json.agents).find((entry) => entry.id === agentId);
    expect(row?.sources.map((source) => source.binding_target_id).sort()).toEqual([
      "org:digital_intelligence_center",
      "org:research_institute",
    ]);
  });

  it("同一技能装在两个可用智能体上：员工发起时要求选择，并列出候选", async () => {
    const ids: string[] = [];
    for (const name of ["线索智能体", "研究助理"]) {
      const agent = await createAgent(name);
      const agentId = String(agent.id);
      await enableSkill(agentId, "creator_library_all");
      await call("POST", `/api/admin/agents/${agentId}/bindings`, { target_type: "organization_unit", target_id: "org:research_institute" });
      const published = await call("PATCH", `/api/admin/agents/${agentId}`, { status: "published", expected_version: 1 });
      expect(published.response.status, JSON.stringify(published.json)).toBe(200);
      ids.push(agentId);
    }
    insertUser("usr_choice", "鄢棽");
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_choice", "person:yan_chen");
    expect(runtimeAgentCandidates("creator_library_all", "usr_choice")).toEqual(expect.arrayContaining(ids));
    let detail: Json = {};
    try { runtimeAgentForSkill("creator_library_all", "usr_choice", { employeeChoice: true }); }
    catch (error) { detail = (error as { detail?: Json }).detail || {}; }
    expect(detail.code).toBe("runtime_agent_ambiguous");
    expect(rows<{ id: string }>(detail.candidates).map((row) => row.id)).toEqual(expect.arrayContaining(ids));
  });

  it("编辑员工时原样回传旧 site 或只改姓名，不结束权威成员关系", async () => {
    insertUser("usr_yan", "鄢棽", { site: "深圳站" });
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_yan", "person:yan_chen");
    const activeUnits = () => (getConn().prepare(
      "SELECT org_unit_id FROM organization_memberships WHERE person_ref='person:yan_chen' AND status='active'",
    ).all() as Array<{ org_unit_id: string }>).map((row) => row.org_unit_id);
    const before = activeUnits();
    expect(before.length).toBeGreaterThan(0);

    const resent = await call("PATCH", "/api/admin/users/usr_yan", { name: "鄢棽", site: "深圳站" });
    expect(resent.response.status, JSON.stringify(resent.json)).toBe(200);
    expect(activeUnits()).toEqual(before);
    expect(resent.json.org_unit_ids).toEqual(before);

    getConn().prepare("UPDATE users SET site=NULL WHERE id='usr_yan'").run();
    const renamed = await call("PATCH", "/api/admin/users/usr_yan", { name: "鄢棽", site: "" });
    expect(renamed.response.status).toBe(200);
    expect(activeUnits()).toEqual(before);
  });
});

describe("agent audit slice", () => {
  it("只返回该 Agent 的 admin.agent.* 事件并按 limit 截断", async () => {
    const agent = await createAgent("审计 Agent");
    const other = await createAgent("其他 Agent");
    const agentId = String(agent.id);
    await enableSkill(agentId);

    const audit = await call("GET", `/api/admin/agents/${agentId}/audit?limit=10`);
    expect(audit.response.status).toBe(200);
    const items = rows<{ event_type: string; payload: Json }>(audit.json.items);
    expect(items.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(["admin.agent.create", "admin.agent.skill"]),
    );
    expect(items.every((row) => row.payload.agent_id === agentId)).toBe(true);

    const otherAudit = await call("GET", `/api/admin/agents/${String(other.id)}/audit`);
    const otherItems = rows<{ payload: Json }>(otherAudit.json.items);
    expect(otherItems.length).toBeGreaterThan(0);
    expect(otherItems.every((row) => row.payload.agent_id === other.id)).toBe(true);

    expect((await call("GET", "/api/admin/agents/agent:missing/audit")).response.status).toBe(404);
  });
});

describe("admin authorization", () => {
  it("非管理员不能读写管理侧 Agent", async () => {
    const created = await call("POST", "/api/admin/users", {
      username: "employee",
      name: "Employee",
      password: "employee-password",
      roles: ["employee"],
      brands: ["LT"],
    });
    expect(created.response.status).toBe(201);
    const login = await call("POST", "/api/auth/login", { username: "employee", password: "employee-password" }, "");
    expect(login.response.status).toBe(200);
    const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
    expect((await call("GET", "/api/admin/agents", undefined, cookie)).response.status).toBe(403);
    expect((await call("POST", "/api/admin/agents", { name: "越权 Agent" }, cookie)).response.status).toBe(403);
  });
});
