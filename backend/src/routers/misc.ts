import fs from "node:fs";
import path from "node:path";
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
import { FUNNEL_STAGES, SOP_POLICY, skillCatalog } from "../host/skills-catalog.js";
import {
  effectiveSummary,
  getSkillSop,
  overlayRow,
  resetSkillSop,
  saveSkillSop,
} from "../host/skill-sop.js";
import {
  createPublishedSkill,
  deletePublishedSkill,
  skillAdminMeta,
  updatePublishedSkill,
} from "../host/skill-publish.js";
import { nid } from "../ids.js";
import { publicProfiles } from "../profiles.js";
import { resetDemoRuntimeState, seedAll } from "../seed.js";
import { STAGES, label } from "../stages.js";
import type { Json, Row } from "../types.js";
import { taskDefinition } from "../tasks/registry.js";
import { buildHomeBoard } from "../host/home-board.js";
import { HOME_ENTRY_REGISTRY, publicEntryRegistry } from "../host/entry-registry.js";
import {
  clearStarryBinding,
  currentFollowScope,
  mailboxFromStarryRow,
  publicStarryBinding,
  saveStarryBinding,
  starryBindingRow,
} from "../host/starry-bind.js";
import { looksLikePhone, normalizeEmail, normalizePhone } from "../host/identity.js";
import { listStarryMailboxes } from "../starrykol/service.js";
import { ensureStarryHomeLibrary, resetStarryHomeLibrarySync, startStarryHomeLibrarySync } from "../starrykol/library-sync.js";
import { ensureFollowedMailSync, resetFollowedMailSync, startFollowedMailSync } from "../starrykol/mail-sync.js";

export const misc = new Hono();

const FUNNEL_ORDER = FUNNEL_STAGES.map((f) => f.id);
function skillMeta(name: string): Json {
  const definition = taskDefinition(name);
  const cat = skillCatalog().find((s) => s.id === name);
  const title = definition?.title || cat?.label || name;
  const funnel = cat?.funnel || "reach";
  const stage = FUNNEL_STAGES.find((f) => f.id === funnel);
  const over = overlayRow(name);
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
    funnel,
    funnel_label: stage?.label || "",
    funnel_hint: stage?.hint || "",
    summary: effectiveSummary(name),
    source: definition?.source || cat?.source || "bundled",
    keeps_stage: true,
    sop_editable: false,
    sop_owner: SOP_POLICY.owner,
    edited: Boolean(over),
    updated_at: over?.updated_at || null,
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
  return skillCatalog()
    .filter((s) => (market ? s.in_market : vis.has(s.id)))
    .sort((a, b) => FUNNEL_ORDER.indexOf(a.funnel) - FUNNEL_ORDER.indexOf(b.funnel) || a.label.localeCompare(b.label, "zh"))
    .map((s) => skillMeta(s.id));
}

misc.get("/skills", (c) => {
  return c.json(listedSkills(false).map((s) => ({ ...s, granted: true })));
});
misc.get("/skills/market", (c) => {
  const vis = visibleForRequest();
  return c.json(listedSkills(true).map((s) => ({
    ...s,
    granted: vis.has(String(s.id)),
  })));
});
misc.get("/skills/:id", (c) => {
  const id = c.req.param("id");
  const sop = getSkillSop(id);
  return c.json({ ...skillMeta(id), ...sop });
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
    meta: skillAdminMeta(),
    skills: skillCatalog().map((s) => ({
      ...skillMeta(s.id),
      grants: grantsForSkill(s.id),
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
misc.post("/login", async (c) => {
  const body = (await c.req.json()) as { username?: string; password?: string };
  const result = login(String(body.username || ""), String(body.password || ""));
  void startFollowedMailSync(true).catch(() => undefined);
  return c.json(result);
});
misc.post("/logout", (c) => c.json(logout()));
misc.get("/profiles", (c) => c.json(publicProfiles()));

misc.get("/projects", (c) => {
  const rows = getConn().prepare(
    `SELECT id,handle,display_name,brand,platform,stage_code
       FROM collaborations ORDER BY display_name`,
  ).all() as Row[];
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
  return c.json({ required: true, ...publicStarryBinding(starryBindingRow(user.id)) });
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

misc.delete("/me/starry-binding", (c) => {
  if (authDisabled()) return c.json(currentFollowScope());
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  return c.json(clearStarryBinding(user.id));
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

misc.get("/home/board", async (c) => {
  c.header("Cache-Control", "no-store");
  const refresh = c.req.query("refresh") === "1" || c.req.query("sync") === "1";
  const library = await ensureStarryHomeLibrary();
  const mail = await ensureFollowedMailSync(refresh);
  return c.json({
    ...buildHomeBoard(),
    library,
    mail,
    entries: publicEntryRegistry(),
    entry: "memory",
    creates_session: false,
  });
});

/** 我跟进的红人 — Collaborations by 跟进 index. Memory GET; never INSERT sessions. */
misc.get("/home/following", (c) => {
  c.header("Cache-Control", "no-store");
  const board = buildHomeBoard();
  return c.json({
    entry: "memory",
    creates_session: false,
    kind: "memory",
    kols: board.kols,
    follow_scope: board.follow_scope,
    index: "我的跟进",
  });
});

misc.get("/home/entries", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    entries: publicEntryRegistry(),
    composer_copy: "让 Agent 分析/安排",
    note: "GET board / todos / following / discovery results never INSERT sessions.",
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
