import { postgresConnection } from "../postgres/pool.js";
import { mediaCrawlerConfigured } from "../crawl/managed-connection.js";
import { employeeSkillPreferences, recordEmployeeSkillView, setEmployeeSkillFavorite } from "../host/employee-skill-preferences.js";
import { publishKnowledgeConfig } from '../knowledge/skill-generation.js';
import { starryKolConnectionHealth } from "../starrykol/connection.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import { authDisabled, isAdmin, requireAdmin, requireSkill, scopedUser } from "../auth.js";
import { examDemoStatus, examTodoCount } from "../exam.js";
import { starry } from "../adapters/clients.js";
import { BRAND_MAILBOXES, DEMO_ADMIN, DEMO_USER, clawMode, kolClawConfigured } from "../config.js";
import { AUDIT_PAYLOAD_PREVIEW_CHARS, audit, auditPayloadPreview, listAudit, nowIso } from "../db.js";
import { postgresPool } from "../postgres/pool.js";
import { uploadsDir } from "../host/attachments.js";
import { HttpFail } from "../host/errors.js";
import { currentUser, setPersona } from "../host/persona.js";
import { personaAccess } from "../host/persona-key.js";
import { login, logout, requirePm, isProductManager } from "../host/auth.js";
import { directory, grantsForSkill, setSkillGrants, visibleSkillIds } from "../host/grants.js";
import { avatarUrlForUser, canUseAgent, visibleSkillIdsForUser } from "../runtime/organization-tree.js";
import { ensureManagedAgents } from "../runtime/managed-agents.js";
import { FUNNEL_STAGES, SOP_POLICY, skillCatalog, skillEmployeeDoc } from "../host/skills-catalog.js";
import {
  effectiveSkillTemplate,
  getSkillSop,
  isBundledSkill,
  overlaySummaries,
  readBundledSkill,
} from "../host/skill-sop.js";
import {
  createPublishedSkill,
  deletePublishedSkill,
  getSkillDraft,
  saveSkillDraft,
  applySkillDraft,
  skillAdminMeta,
  updatePublishedSkill,
} from "../host/skill-publish.js";
import {
  createSkillTest,
  deleteSkillTest,
  latestSkillPublishApproval,
  listSkillTestRuns,
  listSkillTests,
  listSkillVersions,
  publishSkillVersion,
  recordSkillTestRun,
  rollbackSkillVersion,
  skillLifecycleMeta,
  skillMetrics,
  skillPublishCheck,
  assertSkillPublishAllowed,
  skillStageHistory,
  setSkillOrigin,
  SKILL_STAGES,
  SKILL_STAGE_LABELS,
  transitionSkillStage,
  updateSkillLifecycleMeta,
} from "../host/skill-lifecycle.js";
import { createWorkApproval } from "../gateway/wecom.js";
import { roleHolder } from "../approval/org.js";
import { defaultOrgSnapshot } from "../approval/snapshot.js";
import type { Employee } from "../approval/types.js";
import { nid } from "../ids.js";
import { publicProfiles } from "../profiles.js";
import { resetDemoRuntimeState, seedAll } from "../seed.js";
import { STAGES, label } from "../stages.js";
import type { Json, Row } from "../types.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { skillToolProfile } from "../runtime/skill-coverage.js";
import { buildHomeBoard } from "../host/home-board.js";
import { listSkillResultMemories } from "../host/skill-result-memory.js";
import { HOME_ENTRY_REGISTRY, publicEntryRegistry } from "../host/entry-registry.js";
import {
  clearStarryBinding,
  currentFollowScope,
  mailboxFromStarryRow,
  publicStarryBinding,
  saveStarryBinding,
  starryBindingRow,
  starryBindingRows,
} from "../host/starry-bind.js";
import { looksLikePhone, normalizeEmail, normalizePhone } from "../host/identity.js";
import { listStarryMailboxes } from "../starrykol/service.js";
import { ensureStarryHomeLibrary, resetStarryHomeLibrarySync, startStarryHomeLibrarySync, starryLibraryStatus } from "../starrykol/library-sync.js";
import { ensureFollowedMailSync, followedMailStatus, resetFollowedMailSync, startFollowedMailSync } from "../starrykol/mail-sync.js";

export const misc = new Hono();

const FUNNEL_ORDER = FUNNEL_STAGES.map((f) => f.id);

/**
 * Per-request lookups for the skill list. `taskDefinition` and `skillCatalog`
 * each rescan every SKILL.md, so calling them once per row made `/api/skills`
 * quadratic: ~3s of synchronous work that stalled the whole single-threaded
 * Host on every 新工作任务 mount.
 */
type SkillLookup = {
  defs: Map<string, Awaited<ReturnType<typeof taskDefinition>>>;
  cats: Map<string, Awaited<ReturnType<typeof skillCatalog>>[number]>;
  overlays: Map<string, { summary: string; updated_at: string }>;
  origins: Map<string, "official" | "third_party">;
};

const SKILL_LOOKUP_TTL_MS = 60_000;
let skillDefinitionCache: { expiresAt: number; defs: SkillLookup["defs"]; cats: SkillLookup["cats"]; source: Awaited<ReturnType<typeof taskDefinitions>> } | null = null;

function clearSkillLookupCache(): void {
  skillDefinitionCache = null;
}

async function skillLookup(): Promise<SkillLookup> {
  const now = Date.now();
  const [originResult, overlayResult] = await Promise.all([
    (await postgresConnection().query<{ skill_id: string; origin: string | null; tags: string | null }>("SELECT skill_id, origin, tags FROM skill_lifecycle")),
    (await postgresConnection().query<{ id: string; summary: string; updated_at: string }>("SELECT id, summary, updated_at FROM skill_sops")),
  ]);
  const origins = new Map<string, "official" | "third_party">();
  for (const row of originResult.rows) {
    const tags = String(row.tags || "");
    origins.set(String(row.skill_id), row.origin === "third_party" || (!row.origin && tags.includes("第三方")) ? "third_party" : "official");
  }
  const overlays = new Map(overlayResult.rows.map((row) => [String(row.id), { summary: row.summary, updated_at: row.updated_at }]));
  if (skillDefinitionCache && skillDefinitionCache.expiresAt > now && skillDefinitionCache.source === (await taskDefinitions())) {
    return { ...skillDefinitionCache, overlays, origins };
  }
  const source = (await taskDefinitions());
  const defs = new Map<string, Awaited<ReturnType<typeof taskDefinition>>>();
  for (const definition of source) defs.set(definition.id, definition);
  const cats = new Map<string, Awaited<ReturnType<typeof skillCatalog>>[number]>();
  for (const entry of (await skillCatalog())) cats.set(entry.id, entry);
  skillDefinitionCache = { expiresAt: now + SKILL_LOOKUP_TTL_MS, defs, cats, source };
  return { defs, cats, overlays, origins };
}

async function skillMeta(name: string, lookup?: SkillLookup): Promise<Json> {
  const ctx = lookup || (await skillLookup());
  const definition = ctx.defs.get(name);
  const cat = ctx.cats.get(name);
  const overlay = ctx.overlays.get(name);
  const title = definition?.title || cat?.label || name;
  const funnel = cat?.funnel || "reach";
  const stage = FUNNEL_STAGES.find((f) => f.id === funnel);
  const requiredInputs = definition?.required_inputs || [];
  const actions = definition?.actions || [];
  const sideEffects = definition?.side_effects || "none";
  const needsConfirmation = sideEffects !== "none" || actions.some((action) => /send|write|update|delete|decrypt|import|stage|sync/i.test(action));
  const mcpTools = definition?.mcp || [];
  const toolProfile = (await skillToolProfile(name, mcpTools));
  const mcpNeedsConfirmation = toolProfile.risk === "L3";
  const isAsync = name === "creator_discovery" || mcpTools.some((tool) => /start_crawl|crawl_status|crawl_logs|stop_crawl/i.test(tool));
  const executionTools = [
    // Employee surfaces describe the approved connector category, never the
    // raw MCP method name or server wiring from a SKILL.md manifest.
    ...(mcpTools.length ? [{
      kind: "mcp",
      ref: "authorized_connector",
      risk: toolProfile.risk || "L1",
      confirmation: mcpNeedsConfirmation ? "required" : "none",
    }] : []),
    ...actions.map((ref) => ({
      kind: "internal_action",
      ref,
      risk: needsConfirmation ? "L3" : "L1",
      confirmation: needsConfirmation ? "required" : "none",
    })),
  ];
  return {
    id: name,
    title,
    label: title,
    description: definition?.description || cat?.summary || title,
    aliases: definition?.aliases || cat?.aliases || [],
    in_market: cat ? cat.in_market : Boolean(definition?.in_market),
    category: definition?.category || cat?.category,
    profile: definition?.profile || cat?.profile,
    output: definition?.output || "task_result",
    required_inputs: requiredInputs,
    document_query: mcpTools.includes('knowledge.ask_documents'),
    input_schema: definition?.input_schema || null,
    result_type: definition?.result_type || null,
    result_schema: definition?.result_schema || null,
    next_actions: definition?.next_actions || [],
    memory_policy: definition?.memory_policy || null,
    supports: definition?.supports || null,
    funnel,
    funnel_label: stage?.label || "",
    funnel_hint: stage?.hint || "",
    // 展示元数据来自技能 md（内置技能可经草稿→发布覆盖）；执行面与风险档读取时派生。
    icon: definition?.icon || null,
    badge: definition?.badge || null,
    starter: definition?.starter || null,
    connectors: toolProfile.connectors,
    connectors_mounted: toolProfile.connectors_mounted,
    risk: toolProfile.risk,
    summary: (overlay?.summary || cat?.summary || cat?.label || name).trim(),
    source: definition?.source || cat?.source || "bundled",
    origin: ctx.origins.get(name) || "official",
    employee_visible: definition?.employee_visible ?? true,
    // 员工面两段入口口径与示例逐字来自 SKILL.md；没登记的技能不带这几个键，
    // 前端据「缺失」照实说明待专家补齐，不编口径（docs/BUSINESS.md 覆盖表）。
    employee_quick: definition?.employee_quick ?? null,
    employee_agent: definition?.employee_agent ?? null,
    employee_example: definition?.employee_example ?? null,
    keeps_stage: true,
    sop_editable: false,
    sop_owner: SOP_POLICY.owner,
    edited: Boolean(overlay),
    updated_at: overlay?.updated_at || null,
    learning: {
      when_to_use: definition?.description || cat?.summary || title,
      inputs: requiredInputs,
      steps: actions.length ? actions : ["理解你的目标", "读取授权范围内的信息", "生成结果并展示依据"],
      result: definition?.output || "task_result",
      side_effects: sideEffects,
      confirmation: needsConfirmation ? "执行前确认并留下回执" : "无需额外确认",
    },
    execution: {
      tools: executionTools,
      permissions: definition?.permissions || [],
      async: isAsync ? {
        enabled: true,
        status: "需要查看进度",
        cancelable: definition?.supports?.cancel ?? true,
        retryable: definition?.supports?.retry ?? true,
      } : { enabled: false },
      receipt_required: needsConfirmation,
    },
  };
}

async function visibleForRequest(): Promise<Set<string>> {
  return (visibleSkillIds());
}

async function employeeVisibleSkill(id: string): Promise<boolean> {
  const { rows } = await postgresConnection().query<{ stage: string }>("SELECT stage FROM skill_lifecycle WHERE skill_id=$1", [id]);
  const lifecycle = rows[0];
  // Legacy bundled skills without lifecycle rows retain their established availability;
  // explicit draft/editing/testing/disabled records stay out of the employee directory.
  return !lifecycle || lifecycle.stage === "published";
}

async function listedSkills(market: boolean): Promise<Json[]> {
  const vis = (await visibleForRequest());
  const lookup = await skillLookup();
  const visible = await Promise.all([...lookup.cats.values()].map(async (skill) => [skill, await employeeVisibleSkill(skill.id)] as const));
  return (Promise.all(visible
    .filter(([skill, visible]) => visible && (market ? skill.in_market : vis.has(skill.id)))
    .map(([skill]) => skill)
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.funnel) - FUNNEL_ORDER.indexOf(b.funnel) || a.label.localeCompare(b.label, "zh"))
    .map(async (s) => (await skillMeta(s.id, lookup)))));
}

const VERSION_CACHE: { version: string; started_at: string } = { version: "", started_at: nowIso() };
misc.get("/version", (c) => {
  if (!VERSION_CACHE.version) {
    // Deployment `.env` can outlive a `git reset` and thus contain a stale
    // LINGONG_VERSION. Prefer the actual checked-out repository revision so
    // health checks prove what process is serving traffic; containers without
    // a Git worktree retain the explicit environment fallback.
    let commit = String(process.env.DEPLOY_REVISION || "").trim();
    if (!commit) {
      try { commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* fallback below */ }
    }
    if (!commit) commit = String(process.env.LINGONG_VERSION || "").trim();
    VERSION_CACHE.version = commit || "unknown";
  }
  return c.json(VERSION_CACHE);
});

misc.get("/skills", async (c) => {
  c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  return c.json((await listedSkills(false)).map((s) => ({ ...s, granted: true })));
});
misc.get("/skills/personal", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const ids = (await listedSkills(false)).filter(row => row.employee_visible !== false).map(row => String(row.id));
  c.header("Cache-Control", "private, no-store");
  return c.json({ items: await employeeSkillPreferences(user.id, ids) });
});
async function skillPersonalActor(skillId: string): Promise<string> {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  if (!(await taskDefinition(skillId)) || !(await employeeVisibleSkill(skillId)) || !(await visibleForRequest()).has(skillId)
    || (await skillMeta(skillId)).employee_visible === false) throw new HttpFail(404, "skill not found");
  return user.id;
}
misc.post("/skills/:id/favorite", async (c) => {
  const id = c.req.param("id");
  await setEmployeeSkillFavorite((await skillPersonalActor(id)), id, true);
  return c.json({ id, favorite: true });
});
misc.delete("/skills/:id/favorite", async (c) => {
  const id = c.req.param("id");
  await setEmployeeSkillFavorite((await skillPersonalActor(id)), id, false);
  return c.json({ id, favorite: false });
});
misc.post("/skills/:id/view", async (c) => {
  const id = c.req.param("id");
  await recordEmployeeSkillView((await skillPersonalActor(id)), id);
  return c.json({ id });
});
misc.get("/skills/market", async (c) => {
  c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  const vis = (await visibleForRequest());
  return c.json((await listedSkills(true)).map((s) => ({
    ...s,
    granted: vis.has(String(s.id)),
  })));
});
misc.get("/skills/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await employeeVisibleSkill(id))) throw new HttpFail(404, "skill not found");
  const sop = await getSkillSop(id);
  // `employee_doc`：该技能 `## 员工口径` 小节的正文（已过白名单）。没有这一节就是空串，
  // 前端据此整节不渲染 —— 不把 SKILL.md 原文发出去，也不拿空壳冒充说明书。
  return c.json({ ...(await skillMeta(id)), ...sop, employee_doc: await skillEmployeeDoc(id) });
});
misc.get("/skills/:id/agents", async (c) => {
  const id = c.req.param("id");
  // 未知技能直接 404；lifecycle 非 published 的技能对员工不可见，404 不泄漏存在性。
  if (!(await taskDefinition(id))) throw new HttpFail(404, "skill not found");
  if (!(await employeeVisibleSkill(id))) throw new HttpFail(404, "skill not found");
  (await ensureManagedAgents());
  const { rows } = await postgresConnection().query<{ id: string; name: string }>(`
    SELECT ma.id AS id, ma.name AS name
    FROM managed_agents ma
    JOIN runtime_agent_skills ras ON ras.agent_id = ma.id
    WHERE ras.skill_id = $1 AND ras.enabled = 1 AND ma.status = 'published'
    ORDER BY ma.created_at, ma.id
  `, [id]);
  // 取数前校验（CONST-05）：只返回调用者有资格使用的 Agent；管理员 / 鉴权关闭沿用直通口径。
  // 只暴露 id 与 name —— 绑定目标、组织树、版本等治理信息不泄漏（使用 ≠ 治理）。
  const privileged = authDisabled() || isAdmin();
  const userId = scopedUser()?.id || null;
  const allowed = await Promise.all(rows.map(async (row) => privileged || (await canUseAgent(userId, row.id))));
  const agents = rows.filter((_, index) => allowed[index]).map((row) => ({ id: row.id, name: row.name }));
  return c.json({ agents });
});
misc.get("/skills/:id/memories", async (c) => {
  const skillId = c.req.param("id");
  const definition = (await taskDefinition(skillId));
  if (!definition) throw new HttpFail(404, "skill not found");
  requireSkill(skillId);
  c.header("Cache-Control", "private, no-store");
  if (definition.memory_policy?.kind !== "skill_result"
    || definition.memory_policy.scope !== "owner"
    || definition.memory_policy.auto_persist === "never") {
    return c.json({ items: [], next_cursor: null });
  }
  const owner = scopedUser()?.id || (authDisabled() ? DEMO_USER.id : "");
  if (!owner) throw new HttpFail(401, "authentication required");
  const limit = Number(c.req.query("limit") || 20);
  if (!Number.isFinite(limit) || limit < 1) throw new HttpFail(400, "invalid limit");
  return c.json(await listSkillResultMemories({
    owner,
    skillId,
    limit,
    cursor: c.req.query("cursor"),
  }));
});
misc.put("/skills/:id/sop", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { summary?: string; body?: string };
  if (isBundledSkill(id)) {
    (await saveSkillDraft(id, { _sop_summary: body.summary, _sop_body: body.body }));
  } else {
    (await saveSkillDraft(id, { description: body.summary, body: body.body }));
  }
  if ((await skillLifecycleMeta(id)).origin === "third_party") {
    await setSkillOrigin(id, "official");
    clearSkillLookupCache();
  }
  const live = await getSkillSop(id);
  const draft = (await getSkillDraft(id));
  return c.json({ ...live, summary: String(draft.patch._sop_summary ?? draft.patch.description ?? live.summary), body: String(draft.patch._sop_body ?? draft.patch.body ?? live.body), draft: true, updated_at: draft.updated_at });
});
misc.delete("/skills/:id/sop", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const definition = (await taskDefinition(id));
  const summary = String(definition?.employee_summary || definition?.description || "");
  const body = readBundledSkill(id);
  if (isBundledSkill(id)) (await saveSkillDraft(id, { _sop_summary: summary, _sop_body: body }));
  else (await saveSkillDraft(id, { description: summary, body }));
  if ((await skillLifecycleMeta(id)).origin === "third_party") {
    await setSkillOrigin(id, "official");
    clearSkillLookupCache();
  }
  return c.json({ id, summary, body, draft: true, reset_to_packaged: true });
});
misc.get("/admin/skills", async (c) => {
  await requirePm();
  return c.json({
    directory: (await directory()),
    funnel: FUNNEL_STAGES,
    meta: { ...(await skillAdminMeta()), stages: SKILL_STAGES, stage_labels: SKILL_STAGE_LABELS },
    skills: (await Promise.all((await skillCatalog()).map(async (s) => ({
      ...(await (skillMeta(s.id))),
      grants: (await grantsForSkill(s.id)),
      lifecycle: (await skillLifecycleMeta(s.id)),
    })))),
  });
});
misc.get("/admin/skills/:id/sop", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const live = await getSkillSop(id);
  const draft = (await getSkillDraft(id));
  return c.json({ ...live, summary: String(draft.patch._sop_summary ?? draft.patch.description ?? live.summary), body: String(draft.patch._sop_body ?? draft.patch.body ?? live.body), draft: Object.keys(draft.patch).length > 0, updated_at: draft.updated_at || live.updated_at });
});
misc.get("/admin/skills/:id/draft", async (c) => {
  await requirePm();
  return c.json((await getSkillDraft(c.req.param("id"))));
});
misc.get("/admin/skills/:id/template", async (c) => {
  await requirePm();
  const definition = (await taskDefinition(c.req.param("id")));
  if (!definition || !definition.employee_visible) throw new HttpFail(404, "skill template not found");
  return c.json(await effectiveSkillTemplate(definition));
});
misc.put("/admin/skills/:id/draft", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as Record<string, unknown>;
  const result = (await saveSkillDraft(id, body));
  if (Object.keys(body).some((key) => key !== "in_market") && (await skillLifecycleMeta(id)).origin === "third_party") {
    await setSkillOrigin(id, "official");
    clearSkillLookupCache();
  }
  return c.json({ ...result, lifecycle: (await skillLifecycleMeta(id)) });
});
misc.post("/admin/skills", async (c) => {
  await requirePm();
  const body = (await c.req.json()) as Record<string, unknown>;
  const created = (await createPublishedSkill(body));
  await updateSkillLifecycleMeta(created.id, { tags: [] });
  clearSkillLookupCache();
  return c.json({ ...(await skillMeta(created.id)), grants: (await grantsForSkill(created.id)), lifecycle: (await skillLifecycleMeta(created.id)) }, 201);
});
misc.post("/admin/skills/import", async (c) => {
  await requirePm();
  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === "string" || Array.isArray(file) || typeof file.text !== "function") {
    throw new HttpFail(400, "请选择一个 Markdown 文件");
  }
  const name = String(file.name || "");
  if (!/\.md$/i.test(name)) throw new HttpFail(400, "仅支持 .md 文件");
  if (Number(file.size || 0) > 128 * 1024) throw new HttpFail(413, "Markdown 文件不能超过 128 KB");
  const markdown = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new HttpFail(400, "缺少有效的 YAML front matter");
  let meta: Record<string, unknown>;
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("front matter must be an object");
    meta = parsed as Record<string, unknown>;
  } catch (error) {
    throw new HttpFail(400, `front matter 解析失败：${error instanceof Error ? error.message : "格式错误"}`);
  }
  const secretPattern = /(api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*["']?(?!\$\{|env:|secret:)[A-Za-z0-9_\-/.+=]{12,}/i;
  if (secretPattern.test(markdown)) throw new HttpFail(400, "文件疑似包含明文密钥，请改为环境变量或 Secret 引用");
  const created = (await createPublishedSkill({
    ...meta,
    body: match[2].trim(),
    grant_org: false,
  }));
  await updateSkillLifecycleMeta(created.id, { tags: ["本地导入"] });
  await setSkillOrigin(created.id, "third_party");
  clearSkillLookupCache();
  return c.json({
    ...(await skillMeta(created.id)),
    grants: (await grantsForSkill(created.id)),
    lifecycle: (await skillLifecycleMeta(created.id)),
    import_receipt: { filename: name, status: "draft", source: "third_party" },
  }, 201);
});
misc.patch("/admin/skills/:id", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as Record<string, unknown>;
  const { in_market, ...draftPatch } = body;
  let updated = (await skillMeta(id));
  if (Object.keys(draftPatch).length) {
    (await saveSkillDraft(id, draftPatch));
    if ((await skillLifecycleMeta(id)).origin === "third_party") {
      await setSkillOrigin(id, "official");
      clearSkillLookupCache();
    }
  }
  if (typeof in_market === "boolean") {
    const changed = (await updatePublishedSkill(id, { in_market }));
    clearSkillLookupCache();
    updated = (await skillMeta(changed.id));
  }
  return c.json({ ...updated, grants: (await grantsForSkill(id)), draft: (await getSkillDraft(id)), lifecycle: (await skillLifecycleMeta(id)) });
});
misc.delete("/admin/skills/:id", async (c) => {
  await requirePm();
  const deleted = (await deletePublishedSkill(c.req.param("id")));
  clearSkillLookupCache();
  return c.json(deleted);
});
misc.put("/admin/skills/:id/grants", async (c) => {
  await requirePm();
  throw new HttpFail(410, "直接技能授权已退役；请在 Agent 页绑定组织或人员");
});
misc.post("/admin/skills/:id/stage", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { stage?: string; reason?: string };
  const release=async ()=>(await transitionSkillStage(id,String(body.stage || ''),body.reason));
  const result = (body.stage==='published'?await publishKnowledgeConfig((await currentUser()).id,id,release):(await release())) as {stage:string};
  if (result.stage === "published") clearSkillLookupCache();
  return c.json({ id, ...result });
});
misc.patch("/admin/skills/:id/lifecycle", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { owner?: string; business_stage?: string; tags?: string[]; biz_family?: string; biz_domain?: string };
  await updateSkillLifecycleMeta(id, body);
  return c.json({ id, lifecycle: (await skillLifecycleMeta(id)) });
});
/** 发布前检查：测试 / 工具挂载 / 知识版本 / 审批 / 负责人，逐项中文原因。 */
misc.get("/admin/skills/:id/publish-check", async (c) => {
  await requirePm();
  return c.json((await skillPublishCheck(c.req.param("id"))));
});
/**
 * 发起技能发布审批（R3 必需）：复用统一审批引擎，kind=skill_publish，
 * 审批链为 CEO 终审单节点。审批通过后才能发布对应版本（base_version 绑定）。
 */
misc.post("/admin/skills/:id/publish-approvals", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const meta = (await skillLifecycleMeta(id));
  if (meta.risk !== "L3") {
    throw new HttpFail(400, {
      code: "approval_not_required",
      message: `该技能风险等级为 ${meta.risk || "未知"}，无需走发布审批。`,
    });
  }
  const pending = await latestSkillPublishApproval(id);
  if (pending && pending.status === "pending") {
    return c.json({ id, approval_id: pending.approval_id, status: "pending", reused: true });
  }
  const me = (await currentUser());
  const org = defaultOrgSnapshot();
  // roleHolder 的 gm 分支不使用 requester，这里仅为满足类型传入占位。
  const placeholder = {
    id: me.id || me.handle,
    name: me.name || me.handle,
    department_id: "",
    position: "",
    manager_id: null,
    status: "active",
    cost_center: "",
    mailboxes: [],
    delegate_to: null,
  } as Employee;
  const ceo = roleHolder(org, "gm", placeholder);
  if (!ceo) throw new HttpFail(400, { code: "ceo_not_found", message: "组织架构中未找到 CEO，无法发起发布审批。" });
  const base = meta.current_version || 0;
  const skillLabel = (await taskDefinition(id))?.title || id;
  const approval = (await createWorkApproval({
    kind: "skill_publish",
    title: `技能发布审批：${skillLabel}（v${base + 1}）`,
    chain: [ceo.id],
    payload: {
      skill_id: id,
      skill_label: skillLabel,
      base_version: base,
      risk: meta.risk,
      requester_name: me.name || me.handle,
      steps: [{ employee_id: ceo.id, name: ceo.name, role: "CEO" }],
    },
  }));
  if (!approval?.id) {
    throw new HttpFail(400, { code: "empty_approval_chain", message: "审批链为空，无法发起发布审批。" });
  }
  (await audit("host", "skill.publish.approval.created", { skill: id, approval_id: approval.id, base_version: base }));
  return c.json({ id, approval_id: approval.id, status: "pending", base_version: base, chain: [ceo.id] }, 201);
});
/**
 * user_skill_grants 废止迁移清单：该表已退役（不再被任何装配路径读取），
 * 管理员按清单在 Agent 页重新绑定后，可删除本表记录。
 */
misc.get("/admin/skills/legacy-grants", async (c) => {
  await requirePm();
  const { rows } = await postgresConnection().query<{ user_id: string; skill_id: string; created_at: string; username: string | null; user_name: string | null }>(
    `SELECT g.user_id, g.skill_id, g.created_at, u.username, u.name AS user_name
       FROM user_skill_grants g LEFT JOIN users u ON u.id = g.user_id
       ORDER BY g.created_at DESC`,
  );
  const labels = new Map<string, string>();
  for (const entry of (await skillCatalog())) labels.set(entry.id, entry.label || entry.id);
  return c.json({
    deprecated: true,
    notice: "user_skill_grants 已退役：不再被任何装配路径读取。请按清单在 Agent 页为对应人员重新绑定，确认生效后可删除本表记录。",
    count: rows.length,
    grants: rows.map((r) => ({
      user_id: r.user_id,
      user: r.user_name || r.username || r.user_id,
      skill_id: r.skill_id,
      skill_label: labels.get(r.skill_id) || r.skill_id,
      created_at: r.created_at,
    })),
  });
});
misc.get("/admin/skills/:id/stage-history", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  return c.json({ id, history: await skillStageHistory(id) });
});
misc.get("/admin/skills/:id/versions", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  return c.json({ id, versions: await listSkillVersions(id) });
});
misc.post("/admin/skills/:id/versions", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  // 发布门禁：负责人必填；R3 无已通过审批单时 403（先行检查，避免草稿被提前应用）。
  (await assertSkillPublishAllowed(id));
  if ((await postgresConnection().query("SELECT 1 FROM skill_knowledge_configs WHERE skill_id=$1", [id])).rowCount) throw new HttpFail(409, "知识技能须通过真实试算和生命周期发布；不能直接发布版本。");
  const body = (await c.req.json()) as { description?: string };
  (await applySkillDraft(id));
  clearSkillLookupCache();
  return c.json({ id, ...(await publishSkillVersion(id, body.description)) });
});
misc.post("/admin/skills/:id/versions/rollback", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  if ((await postgresConnection().query("SELECT 1 FROM skill_knowledge_configs WHERE skill_id=$1", [id])).rowCount) throw new HttpFail(409, "请将历史说明复制到待发布草稿，核对知识依赖并重新试算后发布。");
  const body = (await c.req.json()) as { version?: number };
  const result = await rollbackSkillVersion(id, Number(body.version || 0));
  clearSkillLookupCache();
  return c.json({ id, ...result });
});
misc.get("/admin/skills/:id/tests", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  return c.json({ id, tests: await listSkillTests(id), runs: await listSkillTestRuns(id) });
});
misc.post("/admin/skills/:id/tests", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { name?: string; input?: string; expected?: string };
  return c.json(await createSkillTest(id, body), 201);
});
misc.delete("/admin/skills/:id/tests/:testId", async (c) => {
  await requirePm();
  return c.json(await deleteSkillTest(c.req.param("id"), c.req.param("testId")));
});
misc.post("/admin/skills/:id/tests/run", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    results?: { test_id: string; passed: boolean; fail_reason?: string; duration_ms?: number }[];
    version?: number;
  };
  return c.json({ id, ...(await recordSkillTestRun(id, body.results || [], body.version)) });
});
misc.get("/admin/skills/:id/metrics", async (c) => {
  await requirePm();
  const id = c.req.param("id");
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") || 7)));
  return c.json(await skillMetrics(id, days));
});
misc.post("/login", async (c) => {
  const body = (await c.req.json()) as { username?: string; password?: string };
  const result = await login(String(body.username || ""), String(body.password || ""));
  void startFollowedMailSync(true).catch(() => undefined);
  return c.json(result);
});
misc.post("/logout", async (c) => c.json(await logout()));
misc.get("/profiles", (c) => c.json(publicProfiles()));

misc.get("/projects", async (c) => {
  // 默认只列「跟我有关的」：显式放入项目（list_in_projects）、有往来邮件（任一方向）、
  // 有正式阶段写入、有任务或有草稿。Starry 全量库同步会灌进来几百条画像，
  // 列表里给它们留位置等于没列表（同步只灌画像，不造邮件——所以这条口径不会被同步打回）。
  // 需要整库时传 ?include=all（或在菜单里搜索）。
  const includeAll = String(c.req.query("include") || "") === "all";
  const { rows } = await postgresConnection().query<Row>(
    `SELECT c.id, c.handle, c.display_name, c.brand, c.platform, c.stage_code
       FROM collaborations c
      WHERE $1 = 1
         OR COALESCE(c.list_in_projects, 0) = 1
         OR EXISTS (SELECT 1 FROM stage_transitions t WHERE t.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM tickets w WHERE w.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM drafts d WHERE d.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM kol_mail_items m WHERE m.collaboration_id = c.id)
      ORDER BY c.display_name`, [includeAll ? 1 : 0]);
  return c.json(rows.map((row) => ({
    id: row.id,
    label: row.display_name || row.handle,
    handle: row.handle,
    description: `${row.brand} · ${row.platform || ""} · ${label(String(row.stage_code))}`,
  })));
});

misc.get("/files/recent", async (c) => {
  const user = scopedUser();
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 12), 1), 50);
  const { rows } = !authDisabled() && user
    ? await postgresConnection().query<Row>(`SELECT id,name,path,size_bytes,mime_type,created_at,last_used_at
           FROM user_uploads WHERE owner_user_id=$1 ORDER BY last_used_at DESC LIMIT $2`, [user.id, limit])
    : await postgresConnection().query<Row>(`SELECT id,name,path,size_bytes,mime_type,created_at,last_used_at
           FROM user_uploads ORDER BY last_used_at DESC LIMIT $1`, [limit]);
  return c.json(rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    size: row.size_bytes,
    type: row.mime_type,
    created_at: row.created_at,
    available: fs.existsSync(String(row.path)),
  })));
});

misc.post("/attachments", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") throw new HttpFail(400, "file required");
  const original = (file as File).name || "upload.bin";
  const safe = original.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "upload.bin";
  const dir = uploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  const uploadId = nid("att");
  const dest = path.join(dir, `${uploadId}_${safe}`);
  const buf = Buffer.from(await (file as File).arrayBuffer());
  const max = Number(process.env.MAX_ATTACHMENT_BYTES || 10 * 1024 * 1024);
  if (buf.length > max) throw new HttpFail(413, `attachment exceeds ${max} bytes`);
  fs.writeFileSync(dest, buf);
  if (!fs.existsSync(dest)) throw new HttpFail(500, "failed to store attachment");
  const now = nowIso();
  const mime = (file as File).type || "application/octet-stream";
  await postgresConnection().query(
    `INSERT INTO user_uploads
     (id,owner_user_id,name,path,size_bytes,mime_type,created_at,last_used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uploadId, scopedUser()?.id || null, safe, dest, buf.length, mime, now, now],
  );
  return c.json({ id: uploadId, name: safe, path: dest, size: buf.length, type: mime });
});

// /cron/risks and /cron/risk-scan live in routers/cron.ts (overdue-scan view / manual run).

misc.get("/me", async (c) => {
  const user = (await currentUser());
  const appUser = scopedUser();
  return c.json({
    ...user,
    avatar_url: (await avatarUrlForUser(user.id)),
    exam_todo_count: appUser?.exam_todo_count ?? await examTodoCount(user.id),
    ...(appUser ? {
      username: appUser.username,
      email: appUser.email || appUser.username,
      phone: appUser.phone || "",
      roles: appUser.roles,
      available_modes: ["employee", ...(isAdmin(appUser) ? ["admin"] : [])],
      starry_binding: publicStarryBinding(await starryBindingRow(appUser.id)),
    } : {
      email: appUser ? "" : (user.handle === "lingong" ? "" : DEMO_ADMIN.email),
      ...(await personaAccess()),
      starry_binding: await currentFollowScope(),
    }),
  });
});

misc.patch("/me", async (c) => {
  if (authDisabled()) return c.json((await currentUser()));
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Record<string, unknown>;
  const managed = ((await postgresConnection().query("SELECT 1 FROM organization_people WHERE user_id=$1 AND status='active'", [user.id])).rowCount ?? 0) > 0;
  if (managed) {
    const unchanged = (field: "name" | "email" | "phone") => body[field] === undefined ||
      String(body[field] ?? "").trim() === String(user[field] ?? "").trim();
    if (!unchanged("name") || !unchanged("email") || !unchanged("phone")) {
      throw new HttpFail(403, "enterprise profile fields are managed by your administrator");
    }
    return c.json({ ...user, starry_binding: publicStarryBinding(await starryBindingRow(user.id)) });
  }
  const name = body.name === undefined ? user.name : String(body.name).trim();
  if (!name) throw new HttpFail(400, "name required");
  const email = body.email === undefined ? user.email : (String(body.email || "").trim() ? normalizeEmail(String(body.email)) : "");
  if (email && !email.includes("@")) throw new HttpFail(400, "请填写有效邮箱");
  const phone = body.phone === undefined ? user.phone : (String(body.phone || "").trim() ? normalizePhone(String(body.phone)) : "");
  if (String(body.phone || "").trim() && !looksLikePhone(String(body.phone))) throw new HttpFail(400, "请填写有效手机号");
  await postgresConnection().query("UPDATE users SET name=$1,email=$2,phone=$3,updated_at=$4 WHERE id=$5", [name, email, phone, nowIso(), user.id]);
  return c.json({ ...user, name, email, phone, starry_binding: publicStarryBinding(await starryBindingRow(user.id)) });
});

misc.get("/me/starry-binding", async (c) => {
  if (authDisabled()) return c.json(await currentFollowScope());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const rows = await starryBindingRows(user.id);
  return c.json({
    required: true,
    ...publicStarryBinding(await starryBindingRow(user.id)),
    bindings: rows.map((row) => ({
      mailbox_email: String(row.mailbox_email || ""),
      owner_name: String(row.owner_name || ""),
      mailbox_id: String(row.mailbox_id || ""),
      status: String(row.status || "connected") === "expired" ? "expired" : "connected",
      is_default: Boolean(Number(row.is_default || 0)),
      synced_at: row.synced_at ? String(row.synced_at) : null,
      updated_at: row.updated_at ? String(row.updated_at) : null,
    })),
  });
});

misc.post("/me/starry-binding/probe", async (c) => {
  if (authDisabled()) {
    const mailboxes = (await listStarryMailboxes()).map(mailboxFromStarryRow);
    return c.json({ mailboxes, used_pasted_token: false });
  }
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const bearer = String(body.bearer || "").trim();
  try {
    const mailboxes = (await listStarryMailboxes(bearer ? { bearer } : undefined)).map(mailboxFromStarryRow)
      .filter((row) => row.mailbox_email);
    if (!mailboxes.length) throw new HttpFail(422, "当前身份没有可用的 Starry 发件邮箱");
    return c.json({ mailboxes, used_pasted_token: Boolean(bearer) });
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/登录过期|请先登录|10141103/.test(message)) {
      throw new HttpFail(401, { code: "starrykol_login_required", message: "邮箱连接已过期，请在个人设置中重新连接。", next_action: "重新连接邮箱。" });
    }
    throw new HttpFail(502, { code: "starry_mailbox_unavailable", message: "暂时无法读取邮箱列表，请稍后重试。", next_action: "稍后重试或重新连接邮箱。" });
  }
});

misc.post("/me/starry-binding", async (c) => {
  if (authDisabled()) throw new HttpFail(400, "演示模式无需绑定 Starry 邮箱");
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const mailboxEmail = String(body.mailbox_email || body.mailboxEmail || "").trim();
  const bearer = String(body.bearer || "").trim();
  const probed = (await listStarryMailboxes(bearer ? { bearer } : undefined)).map(mailboxFromStarryRow);
  const chosen = probed.find((row) => row.mailbox_email === normalizeEmail(mailboxEmail));
  if (!chosen) throw new HttpFail(422, "请从当前身份可用的邮箱里选择一个");
  const saved = await saveStarryBinding(user.id, {
    mailbox_email: chosen.mailbox_email,
    mailbox_id: chosen.id || String(body.mailbox_id || ""),
    owner_name: chosen.owner_name,
    owner_open_id: chosen.owner_open_id,
    bearer,
  });
  resetStarryHomeLibrarySync();
  return c.json(saved);
});

misc.delete("/me/starry-binding", async (c) => {
  if (authDisabled()) return c.json(await currentFollowScope());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const mailbox = normalizeEmail(
    String(body.mailbox_email || body.mailboxEmail || c.req.query("mailbox_email") || c.req.query("box") || ""),
  );
  return c.json(await clearStarryBinding(user.id, mailbox || undefined));
});

misc.post("/me/persona", async (c) => {
  if (!authDisabled()) throw new HttpFail(404, "not found");
  const body = (await c.req.json()) as { persona: string };
  try {
    return c.json((await setPersona(body.persona)));
  } catch {
    throw new HttpFail(400, "unknown persona");
  }
});

misc.get("/exam", async (c) => {
  const u = (await currentUser());
  return c.json(await examDemoStatus(u.id, u.name, u.brands || []));
});

misc.get("/admin", async (c) => {
  if (!authDisabled()) requireAdmin();
  return c.json({
    connectors: [
      { id: "enterprise_mail", label: "企业邮箱", status: "mocked", p0: true },
      { id: "wecom", label: "企业微信", status: "mocked", p0: true },
    ],
    hidden_connectors: ["飞书多维表", "本地文件夹"],
    not_in_kol_scope: ["积加", "金蝶", "Lucas", "MES", "WMS", "经营早报", "飞书表", "加班审批"],
    mailboxes: BRAND_MAILBOXES,
    stages: STAGES,
    profiles: publicProfiles(),
    starry_mode: starry.mode,
    claw_health: {
      mode: clawMode(),
      configured: clawMode() === "mock" || (await mediaCrawlerConfigured()),
    },
    kolclaw_health: {
      mode: process.env.KOLCLAW_MODE || "remote",
      configured: kolClawConfigured(),
      url: (() => {
        try {
          return kolClawConfigured() ? new URL(process.env.KOLCLAW_MCP_URL || "").origin : null;
        } catch {
          return null;
        }
      })(),
    },
    emailmcp_health: (await starryKolConnectionHealth()),
    starrykol_health: (await starryKolConnectionHealth()),
    can_edit_skills: await isProductManager(),
    logged_in: await isProductManager(),
    sop: {
      ...SOP_POLICY,
      funnel: FUNNEL_STAGES,
    },
  });
});

misc.get("/audit", async (c) => {
  if (!authDisabled()) requireAdmin();
  const limit = Math.min(Math.max(1, Number(c.req.query("limit") || 200)), 500);
  return c.json((await listAudit(c.req.query("event_type"), { limit })));
});

/** Bounded admin audit reader; raw `/audit` remains only for existing screens. */
misc.get("/admin/audit/events", async (c) => {
  requireAdmin();
  const limit = Math.min(Math.max(1, Number(c.req.query("limit") || 50)), 200);
  const cursor = Number(c.req.query("cursor") || 0);
  if (!Number.isInteger(cursor) || cursor < 0) throw new HttpFail(400, "invalid audit cursor");
  const eventType = String(c.req.query("event_type") || "").trim();
  const actor = String(c.req.query("actor") || "").trim();
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (cursor) {
    clauses.push("id<?");
    values.push(cursor);
  }
  if (eventType) {
    clauses.push("event_type=?");
    values.push(eventType);
  }
  if (actor) {
    clauses.push("actor=?");
    values.push(actor);
  }
  const indexed = clauses.map((clause, index) => clause.replace("?", `$${index + 1}`));
  const where = indexed.length ? `WHERE ${indexed.join(" AND ")}` : "";
  const { rows } = await postgresConnection().query<Row>(
    `SELECT id,ts,actor,event_type,SUBSTRING(payload FROM 1 FOR $${values.length + 1}) AS payload_preview,length(payload) AS payload_size
       FROM audit_events ${where} ORDER BY id DESC LIMIT $${values.length + 2}`,
    [...values, AUDIT_PAYLOAD_PREVIEW_CHARS, limit + 1],
  );
  const page = rows.slice(0, limit).map((row) => ({
    id: Number(row.id), ts: row.ts, actor: row.actor, event_type: row.event_type,
    payload: auditPayloadPreview(String(row.payload_preview || ""), Number(row.payload_size || 0)),
  }));
  return c.json({
    items: page,
    next_cursor: rows.length > limit && page.length ? page.at(-1)?.id || null : null,
    as_of: nowIso(),
    source_refs: [{ type: "audit_events", scope: "admin" }],
  });
});

misc.get("/workers", async (c) => {
  const user = scopedUser();
  const { rows } = !authDisabled() && user && !isAdmin(user)
    ? await postgresConnection().query<Row>("SELECT w.* FROM workers w JOIN sessions s ON s.id=w.session_id WHERE s.owner_user_id=$1 ORDER BY w.created_at DESC", [user.id])
    : await postgresConnection().query<Row>("SELECT * FROM workers ORDER BY created_at DESC");
  const out = (rows as Row[]).map((r) => ({
    ...r,
    contract_log: JSON.parse(String(r.contract_log)),
    items: JSON.parse(String(r.items)),
  }));
  return c.json(out);
});
misc.get("/stage-transitions", async (c) => {
  const collaborationId = c.req.query("collaboration_id");
  const { rows } = collaborationId
    ? await postgresConnection().query<Row>("SELECT * FROM stage_transitions WHERE collaboration_id = $1 ORDER BY occurred_at, id", [collaborationId])
    : await postgresConnection().query<Row>("SELECT * FROM stage_transitions ORDER BY occurred_at, id");
  return c.json(
    rows.map((row) => ({
      ...row,
      evidence: JSON.parse(String(row.evidence || "{}")),
    })),
  );
});

misc.post("/demo/reset", async (c) => {
  if (!authDisabled()) throw new HttpFail(404, "not found");
  const body = (await c.req.json().catch(() => ({}))) as { workbench?: boolean };
  (await seedAll());
  (await resetDemoRuntimeState());
  if (body.workbench) {
    const { seedWorkbenchFixtures } = await import("../seed-fixtures.js");
    (await seedWorkbenchFixtures());
  }
  const { resetKolJourneyThreads } = await import("../host/kol-journey.js");
  (await resetKolJourneyThreads());
  await logout();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  await startStarryHomeLibrarySync();
  await startFollowedMailSync(true);
  return c.json({ ok: true });
});

misc.get("/home/board", async (c) => {
  c.header("Cache-Control", "no-store");
  const refresh = c.req.query("refresh") === "1" || c.req.query("sync") === "1";
  // Local DB projection first. Remote Starry library/mail sync is started in
  // the background and never blocks this response (including ?refresh=1).
  // Poll a later GET or read library/mail.synced_at when fresh remote data is required.
  const board = (await buildHomeBoard());
  const library = (await starryLibraryStatus());
  const mail = await followedMailStatus();
  if (refresh) {
    void startStarryHomeLibrarySync().catch(() => undefined);
    void startFollowedMailSync(true).catch(() => undefined);
  } else {
    void ensureStarryHomeLibrary().catch(() => undefined);
    void ensureFollowedMailSync(false).catch(() => undefined);
  }
  return c.json({
    ...board,
    library,
    mail,
    sync: {
      deferred: true,
      refresh,
      note: "Local projection is returned first. ensureStarryHomeLibrary + ensureFollowedMailSync run in the background and do not block todo consumers. ?refresh=1 forces a new sync start but still does not await it.",
    },
    entries: publicEntryRegistry(),
    entry: "memory",
    creates_session: false,
  });
});

misc.get("/home/entries", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    entries: publicEntryRegistry(),
    composer_copy: "让 Agent 分析/安排",
    note: "GET board / tasks?view=open / following / discovery results / today-brief never INSERT sessions. Board returns local DB first; remote library/mail sync is deferred. POST /api/home/today-brief/plan locks today_plan and never goes through from-text.",
    registry: HOME_ENTRY_REGISTRY.map((row) => row.id),
  });
});

misc.get("/home", async (c) => {
  c.header("Cache-Control", "no-store");
  const user = scopedUser();
  const catalog = (await skillCatalog());
  const granted = authDisabled() || (user && isAdmin(user))
    ? new Set(catalog.map((skill) => skill.id))
    : new Set((await visibleSkillIdsForUser(user?.id)));
  return c.json({
    brand: "灵工 工作",
    h1: "今天有什么工作要处理？",
    recs: (await Promise.all(catalog.map(async (skill) => ({
      id: skill.id,
      title: skill.label,
      act: "ask",
      prompt: skill.id === "business_approval"
        ? "黎玉燕要申请5万美国KOL推广预算"
        : skill.label,
      intent: skill.id,
      hint: "ask · Skill · Codex",
      category: skill.category,
      group: skill.category,
      profile: skill.profile,
      description: (await taskDefinition(skill.id))?.description || "",
      granted: granted.has(skill.id),
    })))),
  });
});
