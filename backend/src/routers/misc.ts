import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Hono } from "hono";
import { authDisabled, isAdmin, requireAdmin, scopedUser } from "../auth.js";
import { examDemoStatus, examTodoCount } from "../exam.js";
import { starry } from "../adapters/clients.js";
import { BRAND_MAILBOXES, clawMode, kolClawConfigured, starryKolMcpBearer, starryKolMcpConfigured } from "../config.js";
import { getConn, listAudit, nowIso } from "../db.js";
import { uploadsDir } from "../host/attachments.js";
import { HttpFail } from "../host/errors.js";
import { currentUser, setPersona } from "../host/persona.js";
import { personaAccess } from "../host/persona-key.js";
import { login, logout, requirePm, isProductManager } from "../host/auth.js";
import { directory, grantsForSkill, setSkillGrants, visibleSkillIds } from "../host/grants.js";
import { FUNNEL_STAGES, SOP_POLICY, skillCatalog, skillEmployeeDoc } from "../host/skills-catalog.js";
import {
  getSkillSop,
  overlaySummaries,
  resetSkillSop,
  saveSkillSop,
} from "../host/skill-sop.js";
import {
  createPublishedSkill,
  deletePublishedSkill,
  skillAdminMeta,
  updatePublishedSkill,
} from "../host/skill-publish.js";
import {
  createSkillTest,
  deleteSkillTest,
  listSkillTestRuns,
  listSkillTests,
  listSkillVersions,
  publishSkillVersion,
  recordSkillTestRun,
  rollbackSkillVersion,
  skillLifecycleMeta,
  skillMetrics,
  skillStageHistory,
  SKILL_STAGES,
  SKILL_STAGE_LABELS,
  transitionSkillStage,
  updateSkillLifecycleMeta,
} from "../host/skill-lifecycle.js";
import { nid } from "../ids.js";
import { publicProfiles } from "../profiles.js";
import { resetDemoRuntimeState, seedAll } from "../seed.js";
import { STAGES, label } from "../stages.js";
import type { Json, Row } from "../types.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { buildHomeBoard } from "../host/home-board.js";
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
  defs: Map<string, ReturnType<typeof taskDefinition>>;
  cats: Map<string, ReturnType<typeof skillCatalog>[number]>;
  overlays: Map<string, { summary: string; updated_at: string }>;
};

const SKILL_LOOKUP_TTL_MS = 60_000;
let skillDefinitionCache: { expiresAt: number; defs: SkillLookup["defs"]; cats: SkillLookup["cats"] } | null = null;

function skillLookup(): SkillLookup {
  const now = Date.now();
  if (skillDefinitionCache && skillDefinitionCache.expiresAt > now) {
    return { ...skillDefinitionCache, overlays: overlaySummaries() };
  }
  const defs = new Map<string, ReturnType<typeof taskDefinition>>();
  for (const definition of taskDefinitions()) defs.set(definition.id, definition);
  const cats = new Map<string, ReturnType<typeof skillCatalog>[number]>();
  for (const entry of skillCatalog()) cats.set(entry.id, entry);
  skillDefinitionCache = { expiresAt: now + SKILL_LOOKUP_TTL_MS, defs, cats };
  return { defs, cats, overlays: overlaySummaries() };
}

function skillMeta(name: string, lookup?: SkillLookup): Json {
  const ctx = lookup || skillLookup();
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
  const isAsync = name === "creator_discovery" || mcpTools.some((tool) => /start_crawl|crawl_status|crawl_logs|stop_crawl/i.test(tool));
  const executionTools = [
    ...mcpTools.map((ref) => ({
      kind: "mcp",
      ref,
      risk: /send|decrypt|delete|upload|import|changeLifecycleStage/i.test(ref) ? "L3" : "L1",
      confirmation: /send|decrypt|delete|upload|import|changeLifecycleStage/i.test(ref) ? "required" : "none",
    })),
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
    input_schema: definition?.input_schema || null,
    result_type: definition?.result_type || null,
    next_actions: definition?.next_actions || [],
    memory_policy: definition?.memory_policy || null,
    supports: definition?.supports || null,
    funnel,
    funnel_label: stage?.label || "",
    funnel_hint: stage?.hint || "",
    summary: (overlay?.summary || cat?.summary || cat?.label || name).trim(),
    source: definition?.source || cat?.source || "bundled",
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

function visibleForRequest(): Set<string> {
  const vis = visibleSkillIds();
  if (authDisabled() || isAdmin()) return vis;
  const user = scopedUser();
  if (!user) return vis;
  const personal = new Set(
    (getConn().prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(user.id) as Row[])
      .map((row) => String(row.skill_id)),
  );
  const mem = getConn()
    .prepare("SELECT scope FROM memberships WHERE user_handle = ?")
    .all(user.handle) as { scope: string }[];
  if (!mem.length) return personal;
  if (!personal.size) return vis;
  return new Set([...vis].filter((id) => personal.has(id)));
}

function listedSkills(market: boolean): Json[] {
  const vis = visibleForRequest();
  const lookup = skillLookup();
  return [...lookup.cats.values()]
    .filter((s) => (market ? s.in_market : vis.has(s.id)))
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.funnel) - FUNNEL_ORDER.indexOf(b.funnel) || a.label.localeCompare(b.label, "zh"))
    .map((s) => skillMeta(s.id, lookup));
}

const VERSION_CACHE: { version: string; started_at: string } = { version: "", started_at: nowIso() };
misc.get("/version", (c) => {
  if (!VERSION_CACHE.version) {
    let commit = String(process.env.LINGONG_VERSION || "").trim();
    if (!commit) {
      try {
        commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      } catch {
        commit = "unknown";
      }
    }
    VERSION_CACHE.version = commit || "unknown";
  }
  return c.json(VERSION_CACHE);
});

misc.get("/skills", (c) => {
  c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  return c.json(listedSkills(false).map((s) => ({ ...s, granted: true })));
});
misc.get("/skills/market", (c) => {
  c.header("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  const vis = visibleForRequest();
  return c.json(listedSkills(true).map((s) => ({
    ...s,
    granted: vis.has(String(s.id)),
  })));
});
misc.get("/skills/:id", (c) => {
  const id = c.req.param("id");
  const sop = getSkillSop(id);
  // `employee_doc`：该技能 `## 员工口径` 小节的正文（已过白名单）。没有这一节就是空串，
  // 前端据此整节不渲染 —— 不把 SKILL.md 原文发出去，也不拿空壳冒充说明书。
  return c.json({ ...skillMeta(id), ...sop, employee_doc: skillEmployeeDoc(id) });
});
misc.put("/skills/:id/sop", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { summary?: string; body?: string };
  return c.json(saveSkillSop(id, body));
});
misc.delete("/skills/:id/sop", (c) => {
  requirePm();
  return c.json(resetSkillSop(c.req.param("id")));
});
misc.get("/admin/skills", (c) => {
  requirePm();
  return c.json({
    directory: directory(),
    funnel: FUNNEL_STAGES,
    meta: { ...skillAdminMeta(), stages: SKILL_STAGES, stage_labels: SKILL_STAGE_LABELS },
    skills: skillCatalog().map((s) => ({
      ...skillMeta(s.id),
      grants: grantsForSkill(s.id),
      lifecycle: skillLifecycleMeta(s.id),
    })),
  });
});
misc.post("/admin/skills", async (c) => {
  requirePm();
  const body = (await c.req.json()) as Record<string, unknown>;
  const created = createPublishedSkill(body);
  return c.json({ ...skillMeta(created.id), grants: grantsForSkill(created.id) }, 201);
});
misc.patch("/admin/skills/:id", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as Record<string, unknown>;
  const updated = updatePublishedSkill(id, body);
  return c.json({ ...skillMeta(updated.id), grants: grantsForSkill(id) });
});
misc.delete("/admin/skills/:id", (c) => {
  requirePm();
  return c.json(deletePublishedSkill(c.req.param("id")));
});
misc.put("/admin/skills/:id/grants", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { org?: string[]; team?: string[]; user?: string[] };
  return c.json({ id, grants: setSkillGrants(id, body) });
});
misc.post("/admin/skills/:id/stage", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { stage?: string; reason?: string };
  return c.json({ id, ...transitionSkillStage(id, String(body.stage || ""), body.reason) });
});
misc.patch("/admin/skills/:id/lifecycle", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { owner?: string; business_stage?: string; tags?: string[] };
  updateSkillLifecycleMeta(id, body);
  return c.json({ id, lifecycle: skillLifecycleMeta(id) });
});
misc.get("/admin/skills/:id/stage-history", (c) => {
  requirePm();
  const id = c.req.param("id");
  return c.json({ id, history: skillStageHistory(id) });
});
misc.get("/admin/skills/:id/versions", (c) => {
  requirePm();
  const id = c.req.param("id");
  return c.json({ id, versions: listSkillVersions(id) });
});
misc.post("/admin/skills/:id/versions", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { description?: string };
  return c.json({ id, ...publishSkillVersion(id, body.description) });
});
misc.post("/admin/skills/:id/versions/rollback", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { version?: number };
  return c.json({ id, ...rollbackSkillVersion(id, Number(body.version || 0)) });
});
misc.get("/admin/skills/:id/tests", (c) => {
  requirePm();
  const id = c.req.param("id");
  return c.json({ id, tests: listSkillTests(id), runs: listSkillTestRuns(id) });
});
misc.post("/admin/skills/:id/tests", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as { name?: string; input?: string; expected?: string };
  return c.json(createSkillTest(id, body), 201);
});
misc.delete("/admin/skills/:id/tests/:testId", (c) => {
  requirePm();
  return c.json(deleteSkillTest(c.req.param("id"), c.req.param("testId")));
});
misc.post("/admin/skills/:id/tests/run", async (c) => {
  requirePm();
  const id = c.req.param("id");
  const body = (await c.req.json()) as {
    results?: { test_id: string; passed: boolean; fail_reason?: string; duration_ms?: number }[];
    version?: number;
  };
  return c.json({ id, ...recordSkillTestRun(id, body.results || [], body.version) });
});
misc.get("/admin/skills/:id/metrics", (c) => {
  requirePm();
  const id = c.req.param("id");
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") || 7)));
  return c.json(skillMetrics(id, days));
});
misc.post("/login", async (c) => {
  const body = (await c.req.json()) as { username?: string; password?: string };
  const result = login(String(body.username || ""), String(body.password || ""));
  void startFollowedMailSync(true).catch(() => undefined);
  return c.json(result);
});
misc.post("/logout", (c) => c.json(logout()));
misc.get("/profiles", (c) => c.json(publicProfiles()));

misc.get("/projects", (c) => {
  // 默认只列「跟我有关的」：显式放入项目（list_in_projects）、有往来邮件（任一方向）、
  // 有正式阶段写入、有任务或有草稿。Starry 全量库同步会灌进来几百条画像，
  // 列表里给它们留位置等于没列表（同步只灌画像，不造邮件——所以这条口径不会被同步打回）。
  // 需要整库时传 ?include=all（或在菜单里搜索）。
  const includeAll = String(c.req.query("include") || "") === "all";
  const rows = getConn().prepare(
    `SELECT c.id, c.handle, c.display_name, c.brand, c.platform, c.stage_code
       FROM collaborations c
      WHERE ? = 1
         OR IFNULL(c.list_in_projects, 0) = 1
         OR EXISTS (SELECT 1 FROM stage_transitions t WHERE t.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM work_items w WHERE w.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM drafts d WHERE d.collaboration_id = c.id)
         OR EXISTS (SELECT 1 FROM kol_mail_items m WHERE m.collaboration_id = c.id)
      ORDER BY c.display_name`,
  ).all(includeAll ? 1 : 0) as Row[];
  return c.json(rows.map((row) => ({
    id: row.id,
    label: row.display_name || row.handle,
    handle: row.handle,
    description: `${row.brand} · ${row.platform || ""} · ${label(String(row.stage_code))}`,
  })));
});

misc.get("/files/recent", (c) => {
  const user = scopedUser();
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 12), 1), 50);
  const rows = (!authDisabled() && user
    ? getConn().prepare(
        `SELECT id,name,path,size_bytes,mime_type,created_at,last_used_at
           FROM user_uploads WHERE owner_user_id=?
          ORDER BY last_used_at DESC LIMIT ?`,
      ).all(user.id, limit)
    : getConn().prepare(
        `SELECT id,name,path,size_bytes,mime_type,created_at,last_used_at
           FROM user_uploads ORDER BY last_used_at DESC LIMIT ?`,
      ).all(limit)) as Row[];
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
  getConn().prepare(
    `INSERT INTO user_uploads
     (id,owner_user_id,name,path,size_bytes,mime_type,created_at,last_used_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(uploadId, scopedUser()?.id || null, safe, dest, buf.length, mime, now, now);
  return c.json({ id: uploadId, name: safe, path: dest, size: buf.length, type: mime });
});

// /cron/risks and /cron/risk-scan live in routers/cron.ts (overdue-scan view / manual run).

misc.get("/me", (c) => {
  const user = currentUser();
  const appUser = scopedUser();
  return c.json({
    ...user,
    exam_todo_count: appUser?.exam_todo_count ?? examTodoCount(user.id),
    ...(appUser ? {
      username: appUser.username,
      email: appUser.email || appUser.username,
      phone: appUser.phone || "",
      roles: appUser.roles,
      available_modes: ["employee", ...(isAdmin(appUser) ? ["admin"] : [])],
      starry_binding: publicStarryBinding(starryBindingRow(appUser.id)),
    } : {
      email: appUser ? "" : (user.handle === "lingong" ? "" : "sriphy.yan@amperetime.com"),
      ...personaAccess(),
      starry_binding: currentFollowScope(),
    }),
  });
});

misc.patch("/me", async (c) => {
  if (authDisabled()) return c.json(currentUser());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const name = body.name === undefined ? user.name : String(body.name).trim();
  if (!name) throw new HttpFail(400, "name required");
  const email = body.email === undefined
    ? user.email
    : (String(body.email || "").trim() ? normalizeEmail(String(body.email)) : "");
  if (email && !email.includes("@")) throw new HttpFail(400, "请填写有效邮箱");
  const phone = body.phone === undefined
    ? user.phone
    : (String(body.phone || "").trim() ? normalizePhone(String(body.phone)) : "");
  if (String(body.phone || "").trim() && !looksLikePhone(String(body.phone))) {
    throw new HttpFail(400, "请填写有效手机号");
  }
  getConn().prepare("UPDATE users SET name=?,email=?,phone=?,updated_at=? WHERE id=?")
    .run(name, email, phone, nowIso(), user.id);
  return c.json({
    ...user,
    name,
    email,
    phone,
    starry_binding: publicStarryBinding(starryBindingRow(user.id)),
  });
});

misc.get("/me/starry-binding", (c) => {
  if (authDisabled()) return c.json(currentFollowScope());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const rows = starryBindingRows(user.id);
  return c.json({
    required: true,
    ...publicStarryBinding(starryBindingRow(user.id)),
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
      throw new HttpFail(401, { code: "starrykol_login_required", message: "Starry 登录已过期，请重新粘贴用户 JWT。", next_action: "在个人设置里重新连接。" });
    }
    throw new HttpFail(502, message || "无法读取 Starry 邮箱列表");
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
  const saved = saveStarryBinding(user.id, {
    mailbox_email: chosen.mailbox_email,
    mailbox_id: chosen.id || String(body.mailbox_id || ""),
    owner_name: chosen.owner_name || String(body.owner_name || ""),
    bearer,
  });
  resetStarryHomeLibrarySync();
  return c.json(saved);
});

misc.delete("/me/starry-binding", async (c) => {
  if (authDisabled()) return c.json(currentFollowScope());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const mailbox = normalizeEmail(
    String(body.mailbox_email || body.mailboxEmail || c.req.query("mailbox_email") || c.req.query("box") || ""),
  );
  return c.json(clearStarryBinding(user.id, mailbox || undefined));
});

misc.post("/me/persona", async (c) => {
  if (!authDisabled()) throw new HttpFail(404, "not found");
  const body = (await c.req.json()) as { persona: string };
  try {
    return c.json(setPersona(body.persona));
  } catch {
    throw new HttpFail(400, "unknown persona");
  }
});

misc.get("/exam", (c) => {
  const u = currentUser();
  return c.json(examDemoStatus(u.id, u.name, u.brands || []));
});

misc.get("/admin", (c) => {
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
      configured: clawMode() === "mock" || Boolean(process.env.MEDIACRAWLER_MCP_URL && process.env.MEDIACRAWLER_MCP_TOKEN),
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
    emailmcp_health: {
      mode: process.env.STARRY_KOL_MCP_MODE || process.env.EMAIL_MCP_MODE || "remote",
      configured: starryKolMcpConfigured(),
      user_jwt: Boolean(starryKolMcpBearer()),
      url: (() => {
        try {
          return starryKolMcpConfigured() ? new URL(process.env.STARRY_KOL_MCP_URL || process.env.EMAIL_MCP_URL || "").origin : null;
        } catch {
          return null;
        }
      })(),
    },
    starrykol_health: {
      mode: process.env.STARRY_KOL_MCP_MODE || process.env.EMAIL_MCP_MODE || "remote",
      configured: starryKolMcpConfigured(),
      user_jwt: Boolean(starryKolMcpBearer()),
      url: (() => {
        try {
          return starryKolMcpConfigured() ? new URL(process.env.STARRY_KOL_MCP_URL || process.env.EMAIL_MCP_URL || "").origin : null;
        } catch {
          return null;
        }
      })(),
    },
    can_edit_skills: isProductManager(),
    logged_in: isProductManager(),
    sop: {
      ...SOP_POLICY,
      funnel: FUNNEL_STAGES,
    },
  });
});

misc.get("/audit", (c) => {
  if (!authDisabled()) requireAdmin();
  return c.json(listAudit(c.req.query("event_type")));
});

misc.get("/workers", (c) => {
  const user = scopedUser();
  const rows = !authDisabled() && user && !isAdmin(user)
    ? getConn().prepare(
        "SELECT w.* FROM workers w JOIN sessions s ON s.id=w.session_id WHERE s.owner_user_id=? ORDER BY w.created_at DESC",
      ).all(user.id)
    : getConn().prepare("SELECT * FROM workers ORDER BY created_at DESC").all();
  const out = (rows as Row[]).map((r) => ({
    ...r,
    contract_log: JSON.parse(String(r.contract_log)),
    items: JSON.parse(String(r.items)),
  }));
  return c.json(out);
});
misc.get("/stage-transitions", (c) => {
  const collaborationId = c.req.query("collaboration_id");
  const rows = (collaborationId
    ? getConn()
        .prepare("SELECT * FROM stage_transitions WHERE collaboration_id = ? ORDER BY occurred_at, id")
        .all(collaborationId)
    : getConn().prepare("SELECT * FROM stage_transitions ORDER BY occurred_at, id").all()) as Row[];
  return c.json(
    rows.map((row) => ({
      ...row,
      evidence: JSON.parse(String(row.evidence || "{}")),
    })),
  );
});

misc.post("/demo/reset", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { workbench?: boolean };
  seedAll();
  resetDemoRuntimeState();
  if (body.workbench) {
    const { seedWorkbenchFixtures } = await import("../seed-fixtures.js");
    seedWorkbenchFixtures();
  }
  const { resetKolJourneyThreads } = await import("../host/kol-journey.js");
  resetKolJourneyThreads();
  logout();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  await startStarryHomeLibrarySync();
  await startFollowedMailSync(true);
  return c.json({ ok: true });
});

misc.get("/home/board", (c) => {
  c.header("Cache-Control", "no-store");
  const refresh = c.req.query("refresh") === "1" || c.req.query("sync") === "1";
  // Local DB projection first. Remote Starry library/mail sync is started in
  // the background and never blocks this response (including ?refresh=1).
  // Poll a later GET or read library/mail.synced_at when fresh remote data is required.
  const board = buildHomeBoard();
  const library = starryLibraryStatus();
  const mail = followedMailStatus();
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

misc.get("/home", (c) => {
  c.header("Cache-Control", "no-store");
  const user = scopedUser();
  const catalog = skillCatalog();
  const granted = authDisabled() || (user && isAdmin(user))
    ? new Set(catalog.map((skill) => skill.id))
    : new Set(
        (getConn().prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(user?.id || "") as Row[])
          .map((row) => String(row.skill_id)),
      );
  return c.json({
    brand: "灵工 工作",
    h1: "今天有什么工作要处理？",
    recs: catalog.map((skill) => ({
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
      description: taskDefinition(skill.id)?.description || "",
      granted: granted.has(skill.id),
    })),
  });
});
