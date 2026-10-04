import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { AUDIT_PAYLOAD_PREVIEW_CHARS, audit, auditPayloadPreview, getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { deleteBinding, listBases, saveBinding } from "../host/knowledge.js";
import { skillCatalog } from "../host/skills-catalog.js";
import { hasDocumentTool } from "../runtime/document-knowledge.js";
import {
  createManagedAgent, listManagedAgents, managedAgent, updateManagedAgent,
} from "../runtime/managed-agents.js";
import {
  createAgentBinding, effectiveAgentUsers, listAgentBindings, listOrganizationPeople,
  listOrganizationUnits, personRefForUser, previewAgentBinding, revokeAgentBinding, syncUserOrganization,
} from "../runtime/organization-tree.js";
import { getAgentSkills, setAgentSkill } from "../runtime/store.js";

export const adminAgentsRouter = new Hono();

function agentView(id: string) {
  const agent = managedAgent(id);
  const skills = getAgentSkills(id);
  const bindings = listAgentBindings(id);
  const coverage = effectiveAgentUsers(id);
  const knowledge = getConn().prepare(
    `SELECT kb.id,kb.skill_id,kb.selector,kb.enabled,kb.note FROM knowledge_bindings kb
      JOIN runtime_agent_skills ras ON ras.skill_id=kb.skill_id AND ras.agent_id=? AND ras.enabled=1
      ORDER BY kb.created_at,kb.id`,
  ).all(id);
  return { ...agent, skills, bindings, coverage, knowledge };
}

type BindingBody = {
  target_type?: "organization_unit" | "person"; target_id?: string; user_id?: string; reason?: string;
};

/**
 * 绑定与预览共用的目标解析：类型合法、目标存在、同公司（CONST-05）。
 * 预览（syncPerson=false）不写 users/site：person 按 personRefForUser 只读解析，组织关系由预览内核模拟。
 */
function resolveBindingTarget(body: BindingBody, opts: { syncPerson: boolean }): {
  targetType: "organization_unit" | "person";
  targetId: string;
  companyId: string;
} {
  const db = getConn();
  if (body.target_type !== "organization_unit" && body.target_type !== "person") throw new HttpFail(400, "绑定类型无效");
  const targetType = body.target_type;
  let targetId = String(body.target_id || "");
  if (targetType === "person" && body.user_id) {
    const user = db.prepare("SELECT id,site,active FROM users WHERE id=?").get(body.user_id) as
      { id: string; site: string | null; active: number } | undefined;
    if (!user?.active) throw new HttpFail(404, "员工不存在或已停用");
    targetId = opts.syncPerson ? syncUserOrganization(user.id, user.site) : (personRefForUser(user.id) || "");
    if (!targetId) throw new HttpFail(404, "员工不存在或已停用");
  }
  const units = listOrganizationUnits();
  // 组织单元覆盖任意层级（一级/二级/三级组），只要求 status='active'（CONST-05）。
  const unit = units.find((row) => row.id === targetId && row.status === "active");
  if (targetType === "organization_unit" && !unit) throw new HttpFail(400, "请选择有效的组织单元");
  const person = targetType === "person"
    ? listOrganizationPeople().find((row) => row.person_ref === targetId && row.status === "active")
    : null;
  // 已同步人员（含绑定接口）必须是已确认人员；仅预览尚未同步的账号时放行，交给预览内核模拟。
  if (targetType === "person" && !person && !(body.user_id && !opts.syncPerson)) {
    throw new HttpFail(400, "请选择已确认的人员");
  }
  const companyRow = unit?.company_id ||
    db.prepare("SELECT company_id FROM organization_memberships WHERE person_ref=? AND status='active' LIMIT 1")
      .get(targetId) as { company_id?: string } | undefined;
  const company = typeof companyRow === "string" ? companyRow : companyRow?.company_id;
  if (!company) {
    const companies = [...new Set(units.map((row) => row.company_id))];
    if (companies.length !== 1) throw new HttpFail(409, "人员公司归属未确认");
  }
  const selectedCompany = company || units[0]?.company_id;
  if (!selectedCompany) throw new HttpFail(409, "组织公司未配置");
  return { targetType, targetId, companyId: selectedCompany };
}

adminAgentsRouter.get("/admin/agents", (c) => {
  requireAdmin();
  return c.json({
    agents: listManagedAgents().map((row) => agentView(row.id)),
    units: listOrganizationUnits().filter((unit) => unit.status === "active"),
    people: listOrganizationPeople().filter((person) => person.status === "active"),
    skills: skillCatalog().map((skill) => ({ id: skill.id, label: skill.label, category: skill.category, summary: skill.summary, document_query: hasDocumentTool(skill.id) })),
    bases: listBases(),
  });
});

adminAgentsRouter.post("/admin/agents", async (c) => {
  const admin = requireAdmin();
  const body = await c.req.json() as { name?: string; description?: string };
  const created = createManagedAgent({ name: String(body.name || ""), description: body.description });
  audit(admin.id, "admin.agent.create", { agent_id: created.id });
  return c.json(agentView(created.id), 201);
});

adminAgentsRouter.patch("/admin/agents/:id", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  const body = await c.req.json() as {
    name?: string; description?: string; status?: "draft" | "published" | "disabled"; expected_version: number;
  };
  if (body.status === "published") {
    if (!getAgentSkills(id).some((skill) => Number(skill.enabled) === 1)) {
      throw new HttpFail(409, "发布前请先装配至少一项技能");
    }
    if (!listAgentBindings(id).length) throw new HttpFail(409, "发布前请先绑定组织或人员");
  }
  const updated = updateManagedAgent(id, body);
  audit(admin.id, "admin.agent.update", { agent_id: id, status: updated.status, version: updated.version });
  return c.json(agentView(id));
});

adminAgentsRouter.put("/admin/agents/:id/skills/:skillId", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const body = await c.req.json() as { enabled?: boolean; expected_version?: number };
  if (typeof body.enabled !== "boolean" || !Number.isInteger(body.expected_version)) {
    throw new HttpFail(400, "enabled 与 expected_version 必填");
  }
  const row = setAgentSkill(id, c.req.param("skillId"), body.enabled, Number(body.expected_version));
  audit(admin.id, "admin.agent.skill", { agent_id: id, skill_id: row.skill_id, enabled: row.enabled, version: row.version });
  return c.json(agentView(id));
});

adminAgentsRouter.post("/admin/agents/:id/knowledge", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const body = await c.req.json() as { skill_id?: string; base_id?: string };
  const skillId = String(body.skill_id || "").trim();
  const baseId = String(body.base_id || "").trim();
  if (!getAgentSkills(id).some((skill) => skill.skill_id === skillId && Number(skill.enabled) === 1)) {
    throw new HttpFail(409, "先将该技能装配到 Agent");
  }
  const base = listBases().find((row) => String(row.id) === baseId);
  if (!base) throw new HttpFail(404, "知识库不存在");
  if (String(base.kind) === "unstructured" && !hasDocumentTool(skillId)) {
    throw new HttpFail(409, "请先为该技能启用非结构化文档问答能力");
  }
  const binding = saveBinding({
    skill_id: skillId,
    selector: { base_ids: [baseId] },
    enabled: true,
    note: `Agent ${id} 从管理页为技能添加知识库；此技能的其他 Agent 也会使用该依赖。`,
  }, admin.id);
  audit(admin.id, "admin.agent.knowledge.bind", { agent_id: id, skill_id: skillId, base_id: baseId, binding_id: binding.id });
  return c.json(agentView(id), 201);
});

adminAgentsRouter.post("/admin/agents/:id/bindings", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const body = await c.req.json() as BindingBody;
  const target = resolveBindingTarget(body, { syncPerson: true });
  const row = createAgentBinding({
    agent_id: id, target_type: target.targetType, target_id: target.targetId,
    company_id: target.companyId, created_by: admin.id, reason: body.reason || null, source: "admin",
  });
  audit(admin.id, "admin.agent.bind", { agent_id: id, binding_id: row.id, target_type: row.target_type, target_id: row.target_id });
  return c.json(agentView(id));
});

adminAgentsRouter.delete("/admin/agents/:id/bindings/:bindingId", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const bindingId = c.req.param("bindingId");
  if (!listAgentBindings(id).some((row) => row.id === bindingId)) throw new HttpFail(404, "绑定不存在");
  const reason = String((await c.req.json().catch(() => ({})) as { reason?: string }).reason || "管理员撤销");
  revokeAgentBinding(bindingId, { reason });
  audit(admin.id, "admin.agent.unbind", { agent_id: id, binding_id: bindingId, reason });
  return c.json(agentView(id));
});

adminAgentsRouter.post("/admin/agents/:id/bindings/preview", async (c) => {
  requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const body = await c.req.json() as BindingBody;
  const target = resolveBindingTarget(body, { syncPerson: false });
  return c.json(previewAgentBinding(id, {
    add: { target_type: target.targetType, target_id: target.targetId, company_id: target.companyId },
  }));
});

adminAgentsRouter.post("/admin/agents/:id/bindings/:bindingId/revoke-preview", (c) => {
  requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const bindingId = c.req.param("bindingId");
  if (!listAgentBindings(id).some((row) => row.id === bindingId)) throw new HttpFail(404, "绑定不存在");
  return c.json(previewAgentBinding(id, { remove: bindingId }));
});

adminAgentsRouter.delete("/admin/agents/:id/knowledge/:bindingId", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const bindingId = c.req.param("bindingId");
  // 只允许解绑「该 Agent 已启用技能」上的知识库绑定；技能未装配的绑定不属于本 Agent。
  const owned = getConn().prepare(
    `SELECT kb.id FROM knowledge_bindings kb
       JOIN runtime_agent_skills ras ON ras.skill_id=kb.skill_id AND ras.agent_id=? AND ras.enabled=1
      WHERE kb.id=?`,
  ).get(id, bindingId);
  if (!owned) throw new HttpFail(404, "知识库绑定不存在");
  deleteBinding(bindingId, admin.id);
  audit(admin.id, "admin.agent.knowledge.unbind", { agent_id: id, binding_id: bindingId });
  return c.json(agentView(id));
});

const AGENT_AUDIT_DEFAULT_LIMIT = 50;
const AGENT_AUDIT_MAX_LIMIT = 200;

type AgentAuditRow = {
  id: number;
  ts: string;
  actor: string;
  event_type: string;
  payload_preview: string;
  payload_size: number;
};

adminAgentsRouter.get("/admin/agents/:id/audit", (c) => {
  requireAdmin();
  const id = c.req.param("id");
  managedAgent(id);
  const limit = Math.min(
    Math.max(1, Number(c.req.query("limit") || AGENT_AUDIT_DEFAULT_LIMIT) || AGENT_AUDIT_DEFAULT_LIMIT),
    AGENT_AUDIT_MAX_LIMIT,
  );
  const cursor = Number(c.req.query("cursor") || 0);
  if (!Number.isInteger(cursor) || cursor < 0) throw new HttpFail(400, "invalid audit cursor");
  const pattern = `%${id.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = getConn().prepare(
    `SELECT id,ts,actor,event_type,substr(payload,1,?) AS payload_preview,length(payload) AS payload_size
       FROM audit_events
      WHERE event_type LIKE 'admin.agent.%' AND payload LIKE ? ESCAPE '\\'${cursor ? " AND id<?" : ""}
      ORDER BY id DESC LIMIT ?`,
  ).all(AUDIT_PAYLOAD_PREVIEW_CHARS, pattern, ...(cursor ? [cursor] : []), limit + 1) as AgentAuditRow[];
  const page = rows.slice(0, limit).map((row) => ({
    id: Number(row.id), ts: row.ts, actor: row.actor, event_type: row.event_type,
    payload: auditPayloadPreview(String(row.payload_preview || ""), Number(row.payload_size || 0)),
  }));
  return c.json({
    items: page,
    next_cursor: rows.length > limit && page.length ? page.at(-1)?.id || null : null,
  });
});

adminAgentsRouter.get("/admin/users/:uid/agents", (c) => {
  requireAdmin();
  const uid = c.req.param("uid");
  const user = getConn().prepare("SELECT id FROM users WHERE id=?").get(uid);
  if (!user) throw new HttpFail(404, "员工不存在");
  return c.json({ agents: listManagedAgents().map((agent) => {
    const access = effectiveAgentUsers(agent.id).users.find((entry) => entry.user_id === uid);
    return access ? { id: agent.id, name: agent.name, status: agent.status, ...access } : null;
  }).filter(Boolean) });
});
