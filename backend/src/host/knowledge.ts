/**
 * WikiSkill 三层：Raw（系统只写）→ Wiki（管理员抽取/审批）→ Skill + published mail_template。
 * Inference / Worker 不得读 wiki 全文。已启用的 mail_template 只把
 * subject / body_en / placeholders 写入 CONTEXT，由 Codex harness 当这一封底稿。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { authDisabled, requireAdmin, scopedUser } from "../auth.js";
import { BRAND_MAILBOXES, DEMO_USER, dataDir } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { pickComposeTemplate } from "./compose-loop.js";
import { currentUser } from "./persona.js";
import { departmentHeadAccessForUser } from "../contract-scope.js";
import { directory, memberScopeIds } from "./grants.js";

export const KNOWLEDGE_KINDS = ["mail_template", "policy", "pattern", "glossary"] as const;
export const KNOWLEDGE_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
export const KNOWLEDGE_SKIP_REASONS = [
  "not_published",
  "scope_mismatch",
  "not_cited",
  "deprecated_by_user",
  "expired",
  "shadowed_by_higher_priority",
  "binding_disabled",
  "missing",
] as const;
export const DEPRECATE_REASONS = {
  outdated: "内容过时",
  brand_mismatch: "品牌用不上",
  pep_risk: "发出去容易被拦",
} as const;

const DEPRECATE_REASON_ALIASES: Record<string, keyof typeof DEPRECATE_REASONS> = {
  outdated: "outdated",
  brand_mismatch: "brand_mismatch",
  pep_risk: "pep_risk",
  过时: "outdated",
  内容过时: "outdated",
  品牌不对: "brand_mismatch",
  品牌用不上: "brand_mismatch",
  "容易 PEP 拦": "pep_risk",
  发出去容易被拦: "pep_risk",
};

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export type DeprecateReason = keyof typeof DEPRECATE_REASONS;

export function mapDeprecateReason(raw: string): DeprecateReason {
  const mapped = DEPRECATE_REASON_ALIASES[String(raw || "").trim()];
  if (!mapped) throw new HttpFail(400, "隐藏原因须为 内容过时 / 品牌用不上 / 发出去容易被拦");
  return mapped;
}

const MAIL_SKILLS = ["email_compose"] as const;
const PLACEHOLDER_RE = /\[[^\]\n]{1,32}\]/g;

export function knowledgeActorId(): string {
  return scopedUser()?.id || currentUser().id || DEMO_USER.id;
}

export function actorBrands(): string[] {
  const user = authDisabled() ? currentUser() : (scopedUser() || currentUser());
  const departmentHead = departmentHeadAccessForUser(user);
  if (departmentHead?.company_wide && departmentHead.brand_scope === "all") return Object.keys(BRAND_MAILBOXES);
  return [...(user.brands || [])];
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
}

function asRow(row: Row | undefined): Row {
  if (!row) throw new HttpFail(404, "knowledge not found");
  return { ...row };
}

export function knowledgeRow(id: string): Row {
  return asRow(getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(id) as Row | undefined);
}

function writeVersion(db: ReturnType<typeof getConn>, row: Row, note: string, actor: string): void {
  db.prepare(
    `INSERT INTO knowledge_versions
     (id,knowledge_id,version,title,body,subject,body_en,placeholders,stage_codes,skill_id,brand,lang,kind,status,created_by,created_at,note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    nid("kv"),
    row.id,
    row.current_version,
    row.title,
    row.body,
    row.subject ?? "",
    row.body_en ?? "",
    row.placeholders ?? "[]",
    row.stage_codes ?? "[]",
    row.skill_id ?? "",
    row.brand ?? "*",
    row.lang ?? "en",
    row.kind ?? "policy",
    row.status ?? "draft",
    actor,
    nowIso(),
    note,
  );
}

export function publicKnowledge(row: Row, userId = knowledgeActorId()): Json {
  const cited = row.viewer_cited == null
    ? Boolean(getConn().prepare("SELECT 1 FROM knowledge_citations WHERE user_id=? AND knowledge_id=?").get(userId, row.id))
    : Boolean(row.viewer_cited);
  const dep = row.viewer_deprecate_reason == null
    ? getConn()
      .prepare("SELECT reason, reason_note, deprecated_at FROM knowledge_deprecations WHERE user_id=? AND knowledge_id=?")
      .get(userId, row.id) as { reason: string; reason_note: string; deprecated_at: string } | undefined
    : {
        reason: String(row.viewer_deprecate_reason || ""),
        reason_note: String(row.viewer_deprecate_note || ""),
        deprecated_at: String(row.viewer_deprecated_at || ""),
      };
  const citeCount = row.cite_count == null
    ? (getConn().prepare("SELECT COUNT(*) AS c FROM knowledge_citations WHERE knowledge_id=?").get(row.id) as { c: number }).c
    : Number(row.cite_count);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    in_market: Number(row.in_market || 0),
    kind: row.kind || "policy",
    skill_id: row.skill_id || "",
    brand: row.brand || "*",
    lang: row.lang || "en",
    subject: row.subject || "",
    body_en: row.body_en || "",
    placeholders: parseJsonArray(row.placeholders),
    stage_codes: parseJsonArray(row.stage_codes),
    status: row.status || "draft",
    current_version: Number(row.current_version || 1),
    published_version: row.published_version == null ? null : Number(row.published_version),
    created_by: row.created_by || "",
    approved_by: row.approved_by || "",
    approved_at: row.approved_at || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    cited,
    enabled: cited,
    deprecated: Boolean(dep),
    deprecate_reason: dep?.reason || "",
    deprecate_reason_label: dep?.reason ? DEPRECATE_REASONS[dep.reason as DeprecateReason] || dep.reason : "",
    deprecate_note: dep?.reason_note || "",
    deprecated_at: dep?.deprecated_at || "",
    cite_count: citeCount,
    effective_at: row.effective_at || "",
    expires_at: row.expires_at || "",
    starter: composerStarter(row),
  };
}

function listed(sql: string, args: unknown[], filter?: (row: Row) => boolean): Json[] {
  const userId = knowledgeActorId();
  const all = getConn().prepare(sql).all(...args) as Row[];
  const rows = filter ? all.filter(filter) : all;
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const placeholders = ids.map(() => "?").join(",");
  const cited = new Set(
    (getConn().prepare(
      `SELECT knowledge_id FROM knowledge_citations WHERE user_id=? AND knowledge_id IN (${placeholders})`,
    ).all(userId, ...ids) as Row[]).map((row) => String(row.knowledge_id)),
  );
  const deprecated = new Map(
    (getConn().prepare(
      `SELECT knowledge_id,reason,reason_note,deprecated_at FROM knowledge_deprecations WHERE user_id=? AND knowledge_id IN (${placeholders})`,
    ).all(userId, ...ids) as Row[]).map((row) => [String(row.knowledge_id), row]),
  );
  const counts = new Map(
    (getConn().prepare(
      `SELECT knowledge_id,COUNT(*) AS cite_count FROM knowledge_citations WHERE knowledge_id IN (${placeholders}) GROUP BY knowledge_id`,
    ).all(...ids) as Row[]).map((row) => [String(row.knowledge_id), Number(row.cite_count || 0)]),
  );
  return rows.map((row) => {
    const dep = deprecated.get(String(row.id));
    return publicKnowledge({
      ...row,
      viewer_cited: cited.has(String(row.id)) ? 1 : 0,
      // 无隐藏记录时必须留 undefined：publicKnowledge 以 `viewer_deprecate_reason == null`
      // 判断「是否已批量查询过」；传空串会被当成「有隐藏记录（原因为空）」，每行都显示已隐藏。
      viewer_deprecate_reason: dep ? String(dep.reason || "") : undefined,
      viewer_deprecate_note: dep ? String(dep.reason_note || "") : undefined,
      viewer_deprecated_at: dep ? String(dep.deprecated_at || "") : undefined,
      cite_count: counts.get(String(row.id)) || 0,
    }, userId);
  });
}

export function listPublishedForOps(opts: KnowledgeListOpts = {}): Json[] {
  const filters = knowledgeListFilters(opts);
  const rows = listed(filters.sql, filters.args, filters.filter);
  const offset = Math.max(0, Number(opts.offset || 0) || 0);
  const limit = Math.max(0, Number(opts.limit == null ? 0 : opts.limit) || 0);
  if (!limit && !offset) return rows;
  return limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
}

export function listMarket(): Json[] {
  const filters = knowledgeListFilters({ inMarket: true });
  return listed(filters.sql, filters.args, filters.filter);
}

export function brandMatched(row: Row, brands = actorBrands()): boolean {
  const brand = String(row.brand || "*");
  if (!brand || brand === "*") return true;
  if (!brands.length && authDisabled()) return true;
  return brands.includes(brand);
}

export function composerItems(userId = knowledgeActorId(), brands = actorBrands()): Json[] {
  const rows = getConn()
    .prepare(
      `SELECT k.* FROM knowledge k
        JOIN knowledge_citations c ON c.knowledge_id=k.id AND c.user_id=?
       WHERE k.status='published' AND k.kind='mail_template'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_deprecations d
            WHERE d.knowledge_id=k.id AND d.user_id=?
         )
       ORDER BY k.title`,
    )
    .all(userId, userId) as Row[];
  const viewer = viewerHandle(userId);
  return rows
    .filter((row) => brandMatched(row, brands) && canSeeKnowledge(row, viewer))
    .flatMap((row) => {
      try {
        assertMailTemplateSnapshotApplicable({ knowledgeId: String(row.id), version: Number(row.published_version || 0), userId, brands });
        const snapshot = publishedSnapshot(row);
        const published = { ...row, ...snapshot, id: row.id, current_version: snapshot.version };
        return [{ ...publicKnowledge(published, userId), intent: snapshot.skill_id, starter: composerStarter(snapshot) }];
      } catch (error) {
        if (error instanceof HttpFail) return [];
        throw error;
      }
    });
}

export function composerStarter(row: Row): string {
  const title = String(row.title || "");
  const placeholders = parseJsonArray(row.placeholders);
  if (!placeholders.length) return title;
  return `${title} ${placeholders.map((p) => (p.startsWith("[") ? p : `[${p}]`)).join(" ")}`;
}

export function cite(knowledgeId: string, userId = knowledgeActorId()): Json {
  const row = knowledgeRow(knowledgeId);
  if (String(row.status) !== "published") throw new HttpFail(403, "未发布知识不能启用");
  tx((db) => {
    db.prepare(
      "INSERT OR REPLACE INTO knowledge_citations (user_id,knowledge_id,cited_at) VALUES (?,?,?)",
    ).run(userId, knowledgeId, nowIso());
  });
  audit(userId, "knowledge.cite", { knowledge_id: knowledgeId, version: row.current_version });
  return publicKnowledge(knowledgeRow(knowledgeId), userId);
}

export function uncite(knowledgeId: string, userId = knowledgeActorId()): Json {
  knowledgeRow(knowledgeId);
  tx((db) => {
    db.prepare("DELETE FROM knowledge_citations WHERE user_id=? AND knowledge_id=?").run(userId, knowledgeId);
  });
  audit(userId, "knowledge.uncite", { knowledge_id: knowledgeId });
  return publicKnowledge(knowledgeRow(knowledgeId), userId);
}

export function deprecate(knowledgeId: string, reason: string, note = "", userId = knowledgeActorId()): Json {
  knowledgeRow(knowledgeId);
  reason = mapDeprecateReason(reason);
  tx((db) => {
    db.prepare(
      `INSERT OR REPLACE INTO knowledge_deprecations
       (user_id,knowledge_id,reason,reason_note,deprecated_at) VALUES (?,?,?,?,?)`,
    ).run(userId, knowledgeId, reason, note, nowIso());
  });
  audit(userId, "knowledge.deprecate", { knowledge_id: knowledgeId, reason });
  return publicKnowledge(knowledgeRow(knowledgeId), userId);
}

export function undeprecate(knowledgeId: string, userId = knowledgeActorId()): Json {
  knowledgeRow(knowledgeId);
  tx((db) => {
    db.prepare("DELETE FROM knowledge_deprecations WHERE user_id=? AND knowledge_id=?").run(userId, knowledgeId);
  });
  audit(userId, "knowledge.undeprecate", { knowledge_id: knowledgeId });
  return publicKnowledge(knowledgeRow(knowledgeId), userId);
}

export function listVersions(knowledgeId: string): Json[] {
  knowledgeRow(knowledgeId);
  return getConn()
    .prepare("SELECT * FROM knowledge_versions WHERE knowledge_id=? ORDER BY version")
    .all(knowledgeId) as Json[];
}

function normalizeKind(value: unknown): KnowledgeKind {
  const kind = String(value || "policy") as KnowledgeKind;
  if (!KNOWLEDGE_KINDS.includes(kind)) throw new HttpFail(400, "kind 须为 mail_template / policy / pattern / glossary");
  return kind;
}

function normalizeStatus(value: unknown, fallback: KnowledgeStatus): KnowledgeStatus {
  const status = String(value || fallback) as KnowledgeStatus;
  if (!KNOWLEDGE_STATUSES.includes(status)) throw new HttpFail(400, "非法知识状态");
  return status;
}

export function adminList(): Json[] {
  requireAdmin();
  return listed("SELECT * FROM knowledge ORDER BY status, kind, title", []);
}

export function reviewQueue(): Json[] {
  requireAdmin();
  return listed("SELECT * FROM knowledge WHERE status='pending_review' ORDER BY updated_at DESC", []);
}

type UpsertInput = {
  id?: string;
  title: string;
  body: string;
  tags?: string;
  in_market?: number;
  kind?: string;
  skill_id?: string;
  brand?: string;
  lang?: string;
  subject?: string;
  body_en?: string;
  placeholders?: unknown;
  stage_codes?: unknown;
  status?: string;
};

function placeholdersJson(value: unknown): string {
  return JSON.stringify(parseJsonArray(value));
}

export function createKnowledge(input: UpsertInput, actor = knowledgeActorId()): Json {
  requireAdmin();
  const title = String(input.title || "").trim();
  if (!title) throw new HttpFail(400, "title required");
  const id = String(input.id || nid("kb"));
  if (getConn().prepare("SELECT 1 FROM knowledge WHERE id=?").get(id)) throw new HttpFail(409, "knowledge id exists");
  const now = nowIso();
  const row: Row = {
    id,
    title,
    body: String(input.body || ""),
    tags: String(input.tags || ""),
    in_market: input.in_market == null ? 1 : Number(input.in_market),
    kind: normalizeKind(input.kind),
    skill_id: String(input.skill_id || ""),
    brand: String(input.brand || "*") || "*",
    lang: String(input.lang || "en"),
    subject: String(input.subject || ""),
    body_en: String(input.body_en || ""),
    placeholders: placeholdersJson(input.placeholders),
    stage_codes: placeholdersJson(input.stage_codes),
    status: normalizeStatus(input.status, "draft"),
    current_version: 1,
    published_version: normalizeStatus(input.status, "draft") === "published" ? 1 : null,
    created_by: actor,
    approved_by: "",
    approved_at: "",
    created_at: now,
    updated_at: now,
  };
  if (row.status === "published") {
    row.approved_by = actor;
    row.approved_at = now;
  }
  tx((db) => {
    db.prepare(
      `INSERT INTO knowledge
       (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,published_version,created_by,approved_by,approved_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id, row.title, row.body, row.tags, row.in_market, row.kind, row.skill_id, row.brand, row.lang,
      row.subject, row.body_en, row.placeholders, row.stage_codes, row.status, row.current_version, row.published_version,
      row.created_by, row.approved_by, row.approved_at, row.created_at, row.updated_at,
    );
    writeVersion(db, row, "create", actor);
  });
  audit(actor, "knowledge.create", { knowledge_id: id, status: row.status });
  return publicKnowledge(knowledgeRow(id), actor);
}

export function editKnowledge(id: string, input: Partial<UpsertInput>, actor = knowledgeActorId()): Json {
  requireAdmin();
  const prev = knowledgeRow(id);
  const now = nowIso();
  const next: Row = {
    ...prev,
    title: String(input.title ?? prev.title).trim() || prev.title,
    body: input.body == null ? prev.body : String(input.body),
    tags: input.tags == null ? prev.tags : String(input.tags),
    in_market: input.in_market == null ? prev.in_market : Number(input.in_market),
    kind: input.kind == null ? prev.kind : normalizeKind(input.kind),
    skill_id: input.skill_id == null ? prev.skill_id : String(input.skill_id),
    brand: input.brand == null ? prev.brand : (String(input.brand) || "*"),
    lang: input.lang == null ? prev.lang : String(input.lang),
    subject: input.subject == null ? prev.subject : String(input.subject),
    body_en: input.body_en == null ? prev.body_en : String(input.body_en),
    placeholders: input.placeholders == null ? prev.placeholders : placeholdersJson(input.placeholders),
    stage_codes: input.stage_codes == null ? prev.stage_codes : placeholdersJson(input.stage_codes),
    current_version: Number(prev.current_version || 1) + 1,
    updated_at: now,
  };
  tx((db) => {
    db.prepare(
      `UPDATE knowledge SET title=?,body=?,tags=?,in_market=?,kind=?,skill_id=?,brand=?,lang=?,subject=?,body_en=?,placeholders=?,stage_codes=?,current_version=?,updated_at=?
        WHERE id=?`,
    ).run(
      next.title, next.body, next.tags, next.in_market, next.kind, next.skill_id, next.brand, next.lang,
      next.subject, next.body_en, next.placeholders, next.stage_codes, next.current_version, next.updated_at, id,
    );
    writeVersion(db, next, "edit", actor);
  });
  audit(actor, "knowledge.edit", { knowledge_id: id, version: next.current_version });
  return publicKnowledge(knowledgeRow(id), actor);
}

export function approveKnowledge(id: string, expectedVersion: number | null = null, actor = knowledgeActorId()): Json {
  requireAdmin();
  const row = knowledgeRow(id);
  if (String(row.status) === "archived") throw new HttpFail(400, "已归档知识不能直接发布");
  if (expectedVersion == null || !Number.isFinite(Number(expectedVersion))) {
    throw new HttpFail(400, "expected_version required");
  }
  if (Number(expectedVersion) !== Number(row.current_version || 1)) {
    throw new HttpFail(409, { code: "knowledge_version_conflict", message: "内容已变，请刷新后重新审核" });
  }
  const now = nowIso();
  const version = Number(row.current_version || 1);
  tx((db) => {
    db.prepare(
      "UPDATE knowledge SET status='published',published_version=?,approved_by=?,approved_at=?,updated_at=? WHERE id=?",
    ).run(version, actor, now, now, id);
    const published = { ...row, status: "published", approved_by: actor, approved_at: now, current_version: version };
    writeVersion(db, published, "approve", actor);
  });
  audit(actor, "knowledge.approve", { knowledge_id: id, version });
  return publicKnowledge(knowledgeRow(id), actor);
}

export function archiveKnowledge(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  knowledgeRow(id);
  const now = nowIso();
  tx((db) => {
    db.prepare("UPDATE knowledge SET status='archived',updated_at=? WHERE id=?").run(now, id);
    const row = db.prepare("SELECT * FROM knowledge WHERE id=?").get(id) as Row;
    writeVersion(db, row, "archive", actor);
  });
  audit(actor, "knowledge.archive", { knowledge_id: id });
  return publicKnowledge(knowledgeRow(id), actor);
}

export function sentMailCitesKnowledge(knowledgeId: string): boolean {
  const rows = getConn().prepare("SELECT extra FROM drafts WHERE status='sent'").all() as { extra: string }[];
  return rows.some((row) => {
    try {
      const extra = JSON.parse(String(row.extra || "{}")) as Json;
      return String(extra.knowledge_id || "") === knowledgeId;
    } catch {
      return false;
    }
  });
}

export function hardDeleteKnowledge(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const row = knowledgeRow(id);
  if (String(row.status) === "published" || String(row.status) === "archived") {
    throw new HttpFail(403, "已发布或归档知识只能归档，不能物理删除");
  }
  if (String(row.status) !== "draft") throw new HttpFail(403, "仅未发布草稿可物理删除");
  if (sentMailCitesKnowledge(id)) throw new HttpFail(403, "已被已发送邮件引用的知识不能物理删除");
  tx((db) => {
    db.prepare("DELETE FROM knowledge_versions WHERE knowledge_id=?").run(id);
    db.prepare("DELETE FROM knowledge_citations WHERE knowledge_id=?").run(id);
    db.prepare("DELETE FROM knowledge_deprecations WHERE knowledge_id=?").run(id);
    db.prepare("DELETE FROM knowledge WHERE id=?").run(id);
  });
  audit(actor, "knowledge.hard_delete", { knowledge_id: id });
  return { ok: true, id };
}

export function ingestRaw(input: {
  source: "upload" | "failed_session";
  filename?: string;
  content_type?: string;
  body?: string;
  path?: string | null;
  uploaded_by?: string;
  session_id?: string | null;
  task_id?: string | null;
  meta?: Json;
}): Row {
  const id = nid("kraw");
  const now = nowIso();
  const row = {
    id,
    source: input.source,
    filename: String(input.filename || ""),
    content_type: String(input.content_type || "text/plain"),
    body: String(input.body || ""),
    path: input.path || null,
    uploaded_by: input.uploaded_by || knowledgeActorId(),
    created_at: now,
    session_id: input.session_id || null,
    task_id: input.task_id || null,
    meta: JSON.stringify(input.meta || {}),
  };
  tx((db) => {
    db.prepare(
      `INSERT INTO knowledge_raw
       (id,source,filename,content_type,body,path,uploaded_by,created_at,session_id,task_id,meta)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id, row.source, row.filename, row.content_type, row.body, row.path,
      row.uploaded_by, row.created_at, row.session_id, row.task_id, row.meta,
    );
  });
  return row;
}

export function recordFailedSession(meta: Json, sessionId?: string | null, body = ""): Row {
  return ingestRaw({
    source: "failed_session",
    filename: String(meta.reason || meta.code || "failed_session"),
    content_type: "application/json",
    body: body || JSON.stringify(meta),
    uploaded_by: "system",
    session_id: sessionId || null,
    meta,
  });
}

export function listRaw(): Json[] {
  requireAdmin();
  return getConn().prepare("SELECT * FROM knowledge_raw ORDER BY created_at DESC").all() as Json[];
}

export function listExtractJobs(): Json[] {
  requireAdmin();
  return getConn().prepare("SELECT * FROM knowledge_extract_jobs ORDER BY created_at DESC").all() as Json[];
}

export function deprecateStats(): Json {
  requireAdmin();
  const rows = getConn()
    .prepare(
      `SELECT reason, COUNT(*) AS c FROM knowledge_deprecations GROUP BY reason`,
    )
    .all() as { reason: string; c: number }[];
  const by_reason = Object.fromEntries(
    (Object.keys(DEPRECATE_REASONS) as DeprecateReason[]).map((key) => [
      key,
      { label: DEPRECATE_REASONS[key], count: 0 },
    ]),
  ) as Record<string, { label: string; count: number }>;
  for (const row of rows) {
    if (!by_reason[row.reason]) by_reason[row.reason] = { label: row.reason, count: 0 };
    by_reason[row.reason].count = Number(row.c);
  }
  return { by_reason, total: rows.reduce((sum, row) => sum + Number(row.c), 0) };
}

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 8000 }).toString();
  } catch {
    return null;
  }
}

function extractPdfText(filePath: string, buf: Buffer): string {
  const fromTool = tryExec("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]);
  if (fromTool?.trim()) return fromTool;
  const latin = buf.toString("latin1");
  const chunks = [...latin.matchAll(/\(([^)]{4,})\)/g)].map((m) => m[1]).join("\n");
  return chunks.slice(0, 8000);
}

function extractDocxText(filePath: string): string {
  const fromTool = tryExec("unzip", ["-p", filePath, "word/document.xml"]);
  if (!fromTool) return "";
  return fromTool.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
}

function parseEml(text: string): { title: string; body: string; subject: string; body_en: string } {
  const subject = text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || "未命名来信";
  const split = text.split(/\r?\n\r?\n/);
  const body = split.slice(1).join("\n\n").trim() || text;
  return { title: subject, body, subject, body_en: body };
}

export function extractTextFromUpload(filename: string, mime: string, buf: Buffer, filePath: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".md" || ext === ".txt" || mime.startsWith("text/")) return buf.toString("utf8");
  if (ext === ".eml" || mime === "message/rfc822") return buf.toString("utf8");
  if (ext === ".pdf" || mime === "application/pdf") return extractPdfText(filePath, buf);
  if (ext === ".docx" || mime.includes("wordprocessingml")) return extractDocxText(filePath);
  if (!buf.includes(0)) return buf.toString("utf8");
  return "";
}

export function storeUploadRaw(file: { name: string; type: string; buf: Buffer }, actor = knowledgeActorId()): Row {
  requireAdmin();
  const original = file.name || "upload.bin";
  const safe = original.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "upload.bin";
  const ext = path.extname(safe).toLowerCase();
  const allowed = new Set([".md", ".txt", ".eml", ".pdf", ".docx"]);
  if (!allowed.has(ext)) throw new HttpFail(400, "仅支持 md / txt / eml / pdf / docx");
  const dir = path.join(dataDir(), "uploads", "knowledge-raw");
  fs.mkdirSync(dir, { recursive: true });
  const uploadId = nid("katt");
  const dest = path.join(dir, `${uploadId}_${safe}`);
  fs.writeFileSync(dest, file.buf);
  const body = extractTextFromUpload(safe, file.type, file.buf, dest);
  return ingestRaw({
    source: "upload",
    filename: safe,
    content_type: file.type || "application/octet-stream",
    body,
    path: dest,
    uploaded_by: actor,
    meta: { ext, bytes: file.buf.length },
  });
}

function maintainerPendingFromRaw(raw: Row, actor: string): Json {
  const filename = String(raw.filename || "");
  const ext = path.extname(filename).toLowerCase();
  const text = String(raw.body || "").trim();
  let title = filename.replace(/\.[^.]+$/, "") || "未命名抽取";
  let body = text || "未能抽取正文，请人工编辑。";
  let subject = "";
  let bodyEn = "";
  let kind: KnowledgeKind = "pattern";
  if (ext === ".eml" || String(raw.content_type) === "message/rfc822") {
    const parsed = parseEml(text || "");
    title = parsed.title;
    body = parsed.body;
    subject = parsed.subject;
    bodyEn = parsed.body_en;
    kind = "mail_template";
  } else if (ext === ".md" || ext === ".txt") {
    const heading = text.match(/^#\s+(.+)$/m);
    if (heading) title = heading[1].trim();
    if (/^Subject:/im.test(text)) {
      kind = "mail_template";
      subject = text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || title;
      bodyEn = text;
    }
  } else if (ext === ".pdf" || ext === ".docx") {
    kind = "pattern";
  }
  return createKnowledge({
    title,
    body,
    kind,
    subject,
    body_en: bodyEn,
    tags: "extracted",
    status: "pending_review",
    skill_id: kind === "mail_template" ? "email_compose" : "",
    lang: "en",
    brand: "*",
  }, actor);
}

export function extractFromRaw(rawId: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const raw = getConn().prepare("SELECT * FROM knowledge_raw WHERE id=?").get(rawId) as Row | undefined;
  if (!raw) throw new HttpFail(404, "raw not found");
  const jobId = nid("kjob");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO knowledge_extract_jobs
       (id,raw_id,status,result_knowledge_id,error,created_by,created_at,finished_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(jobId, rawId, "queued", null, null, actor, now, null);
  });
  try {
    const page = maintainerPendingFromRaw(raw, actor);
    const finished = nowIso();
    tx((db) => {
      db.prepare(
        "UPDATE knowledge_extract_jobs SET status='done',result_knowledge_id=?,finished_at=? WHERE id=?",
      ).run(page.id, finished, jobId);
    });
    audit(actor, "knowledge.extract", { raw_id: rawId, knowledge_id: page.id, job_id: jobId });
    return { job_id: jobId, status: "done", knowledge: page };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    tx((db) => {
      db.prepare(
        "UPDATE knowledge_extract_jobs SET status='failed',error=?,finished_at=? WHERE id=?",
      ).run(message, nowIso(), jobId);
    });
    throw error;
  }
}

export function listProposals(): Json[] {
  requireAdmin();
  return getConn().prepare("SELECT * FROM knowledge_proposals ORDER BY created_at DESC").all() as Json[];
}

export function proposeEvolve(input: {
  kind?: string;
  skill_id?: string;
  knowledge_id?: string;
  from_brand?: string;
  to_brand?: string;
  proposed_diff?: string;
}, actor = knowledgeActorId()): Json {
  requireAdmin();
  const kind = String(input.kind || "skill_patch");
  if (!["skill_patch", "template_patch", "brand_transfer"].includes(kind)) {
    throw new HttpFail(400, "proposal kind 须为 skill_patch / template_patch / brand_transfer");
  }
  if (kind === "brand_transfer") {
    const to = String(input.to_brand || "");
    if (!BRAND_MAILBOXES[to]) throw new HttpFail(400, "跨品牌转移必须通过品牌 From 白名单");
  }
  const id = nid("kprop");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO knowledge_proposals
       (id,kind,skill_id,knowledge_id,from_brand,to_brand,proposed_diff,status,profile,created_by,created_at,reviewed_by,reviewed_at,reject_reason)
       VALUES (?,?,?,?,?,?,?,'pending','shadow',?,?,NULL,NULL,NULL)`,
    ).run(
      id,
      kind,
      String(input.skill_id || ""),
      String(input.knowledge_id || ""),
      String(input.from_brand || ""),
      String(input.to_brand || ""),
      String(input.proposed_diff || ""),
      actor,
      now,
    );
  });
  audit(actor, "knowledge.evolve.propose", { proposal_id: id, kind, profile: "shadow", wrote_skill_md: false });
  return getConn().prepare("SELECT * FROM knowledge_proposals WHERE id=?").get(id) as Json;
}

function assertSkillMdUntouched(): void {
  /* WikiSkill evolve never writes production SKILL.md. Review only records the decision. */
}

export function reviewProposal(id: string, action: "approve" | "reject", rejectReason = "", actor = knowledgeActorId()): Json {
  requireAdmin();
  const row = getConn().prepare("SELECT * FROM knowledge_proposals WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "proposal not found");
  if (String(row.status) !== "pending") throw new HttpFail(409, "proposal already reviewed");
  assertSkillMdUntouched();
  const now = nowIso();
  if (action === "reject") {
    tx((db) => {
      db.prepare(
        "UPDATE knowledge_proposals SET status='rejected',reviewed_by=?,reviewed_at=?,reject_reason=? WHERE id=?",
      ).run(actor, now, rejectReason || "rejected", id);
    });
    audit(actor, "knowledge.evolve.reject", { proposal_id: id, wrote_skill_md: false });
    return getConn().prepare("SELECT * FROM knowledge_proposals WHERE id=?").get(id) as Json;
  }
  if (String(row.kind) === "brand_transfer") {
    const to = String(row.to_brand || "");
    if (!BRAND_MAILBOXES[to]) throw new HttpFail(400, "跨品牌转移必须通过品牌 From 白名单");
    const sourceId = String(row.knowledge_id || "");
    if (sourceId) {
      const src = knowledgeRow(sourceId);
      createKnowledge({
        title: `${src.title} · ${to}`,
        body: String(src.body || ""),
        kind: String(src.kind || "mail_template"),
        skill_id: String(src.skill_id || ""),
        brand: to,
        lang: String(src.lang || "en"),
        subject: String(src.subject || ""),
        body_en: String(src.body_en || ""),
        placeholders: src.placeholders,
        stage_codes: src.stage_codes,
        tags: String(src.tags || ""),
        status: "pending_review",
      }, actor);
    }
  }
  tx((db) => {
    db.prepare(
      "UPDATE knowledge_proposals SET status='approved',reviewed_by=?,reviewed_at=? WHERE id=?",
    ).run(actor, now, id);
  });
  audit(actor, "knowledge.evolve.approve", { proposal_id: id, profile: "shadow", wrote_skill_md: false });
  return getConn().prepare("SELECT * FROM knowledge_proposals WHERE id=?").get(id) as Json;
}

export function transferBrand(knowledgeId: string, toBrand: string, actor = knowledgeActorId()): Json {
  return proposeEvolve({
    kind: "brand_transfer",
    knowledge_id: knowledgeId,
    to_brand: toBrand,
    proposed_diff: `transfer brand From whitelist → ${toBrand} ${BRAND_MAILBOXES[toBrand] || ""}`,
  }, actor);
}

export type UsableTemplate = {
  id: string;
  version: number;
  kind: string;
  skill_id: string;
  brand: string;
  subject: string;
  body_en: string;
  body: string;
  placeholders: string[];
  stage_codes: string[];
  title: string;
  template_id: string;
};

function publishedSnapshot(row: Row, version?: number | null): Row {
  const requested = version == null ? Number(row.published_version || 0) : Number(version);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new HttpFail(403, { code: "knowledge_publish_pending", message: "知识没有可用的已发布版本" });
  }
  const snapshot = getConn().prepare(
    `SELECT * FROM knowledge_versions
      WHERE knowledge_id=? AND version=?
        AND status='published'
        AND (note='approve' OR note='create' OR note LIKE 'seed %')`,
  ).get(row.id, requested) as Row | undefined;
  if (!snapshot) {
    throw new HttpFail(403, { code: "knowledge_publish_pending", message: "知识没有可用的已发布版本" });
  }
  return snapshot;
}

function templateFromSnapshot(row: Row, snapshot: Row): UsableTemplate {
  const skill = String(snapshot.skill_id || "");
  const stageCodes = parseJsonArray(snapshot.stage_codes);
  const templateId = skill === "email_compose" || !skill
    ? pickComposeTemplate("email_compose", stageCodes[0] || null, String(snapshot.title || "")).id
    : `${skill}.v1`;
  return {
    id: String(row.id),
    version: Number(snapshot.version),
    kind: String(snapshot.kind || "policy"),
    skill_id: skill,
    brand: String(snapshot.brand || "*"),
    subject: String(snapshot.subject || ""),
    body_en: String(snapshot.body_en || ""),
    body: String(snapshot.body || ""),
    placeholders: parseJsonArray(snapshot.placeholders),
    stage_codes: stageCodes,
    title: String(snapshot.title || ""),
    template_id: templateId,
  };
}

export function assertMailTemplateSnapshotApplicable(opts: {
  knowledgeId: string;
  version: number;
  skillId?: string | null;
  stageCode?: string | null;
  brand?: string | null;
  userId?: string;
  brands?: string[];
}): UsableTemplate {
  const userId = opts.userId || knowledgeActorId();
  const brands = opts.brands || actorBrands();
  const row = getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(opts.knowledgeId) as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "knowledge_missing", message: "知识不存在" });
  if (String(row.status) !== "published") {
    throw new HttpFail(403, { code: "knowledge_unapproved", message: "未审批或已归档知识不能进入会话或发送" });
  }
  if (Number(row.in_market) !== 1) {
    throw new HttpFail(403, { code: "knowledge_disabled", message: "已停用知识不能进入会话或发送" });
  }
  const cited = getConn().prepare(
    "SELECT 1 FROM knowledge_citations WHERE user_id=? AND knowledge_id=?",
  ).get(userId, opts.knowledgeId);
  if (!cited) throw new HttpFail(403, { code: "knowledge_uncited", message: "未启用知识不能进入会话或发送" });
  const dep = getConn().prepare(
    "SELECT 1 FROM knowledge_deprecations WHERE user_id=? AND knowledge_id=?",
  ).get(userId, opts.knowledgeId);
  if (dep) throw new HttpFail(403, { code: "knowledge_deprecated", message: "已隐藏知识不能进入会话或发送" });
  const template = templateFromSnapshot(row, publishedSnapshot(row, opts.version));
  if (template.kind !== "mail_template") {
    throw new HttpFail(403, { code: "knowledge_kind", message: "知识不是邮件模板" });
  }
  if (opts.skillId && template.skill_id !== String(opts.skillId)) {
    throw new HttpFail(403, { code: "knowledge_skill", message: "知识模板不适用于当前技能" });
  }
  if (!brandMatched({ brand: template.brand }, brands)) {
    throw new HttpFail(403, { code: "knowledge_brand", message: "知识品牌与当前账号不匹配" });
  }
  const brand = String(opts.brand || "").trim();
  if (brand && template.brand !== "*" && template.brand !== brand) {
    throw new HttpFail(403, { code: "knowledge_brand", message: "知识模板不适用于当前对象品牌" });
  }
  const stage = String(opts.stageCode || "").trim();
  if (stage && template.stage_codes.length && !template.stage_codes.includes(stage)) {
    throw new HttpFail(403, { code: "knowledge_stage", message: "知识模板不适用于当前正式阶段" });
  }
  return template;
}

export function assertUsableKnowledge(knowledgeId: string, userId = knowledgeActorId(), brands = actorBrands()): UsableTemplate {
  const row = getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(knowledgeId) as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "knowledge_missing", message: "知识不存在" });
  if (String(row.status) !== "published") {
    throw new HttpFail(403, { code: "knowledge_unapproved", message: "未审批知识不能进入会话或 Worker" });
  }
  if (Number(row.in_market) !== 1) {
    throw new HttpFail(403, { code: "knowledge_disabled", message: "已停用知识不能进入会话或 Worker" });
  }
  const cited = getConn().prepare(
    "SELECT 1 FROM knowledge_citations WHERE user_id=? AND knowledge_id=?",
  ).get(userId, knowledgeId);
  if (!cited) throw new HttpFail(403, { code: "knowledge_uncited", message: "未启用知识不能进入会话" });
  const dep = getConn().prepare(
    "SELECT 1 FROM knowledge_deprecations WHERE user_id=? AND knowledge_id=?",
  ).get(userId, knowledgeId);
  if (dep) throw new HttpFail(403, { code: "knowledge_deprecated", message: "已隐藏知识不能进入会话" });
  if (!brandMatched(row, brands)) {
    throw new HttpFail(403, { code: "knowledge_brand", message: "知识品牌与当前账号不匹配" });
  }
  return templateFromSnapshot(row, publishedSnapshot(row));
}

export function mailTemplatePayload(template: UsableTemplate): Json {
  return {
    id: template.id,
    version: template.version,
    skill_id: template.skill_id,
    title: template.title,
    subject: template.subject,
    body_en: template.body_en,
    placeholders: template.placeholders,
    stage_codes: template.stage_codes,
    template_id: template.template_id,
  };
}

export function resolveMailTemplate(opts: {
  knowledgeId?: string | null;
  stageCode?: string | null;
  skillId?: string | null;
  userId?: string;
  brands?: string[];
}): UsableTemplate | null {
  const userId = opts.userId || knowledgeActorId();
  const brands = opts.brands || actorBrands();
  const knowledgeId = String(opts.knowledgeId || "").trim();
  if (knowledgeId) return assertUsableKnowledge(knowledgeId, userId, brands);
  const skill = String(opts.skillId || "email_compose");
  if (skill && skill !== "email_compose") return null;
  const stage = String(opts.stageCode || "").trim();
  const bound = resolveForSkill("email_compose", { userId, brands, stageCode: stage, record: true });
  if (bound.resolved.length) return assertUsableKnowledge(bound.resolved[0].id, userId, brands);
  const rows = composerItems(userId, brands);
  if (!rows.length) {
    audit(userId, "knowledge.resolve", { skill_id: "email_compose", source: "legacy", resolved: [], skipped_count: 0 });
    return null;
  }
  const staged = stage
    ? rows.filter((row) => {
      const codes = Array.isArray(row.stage_codes) ? row.stage_codes.map(String) : [];
      return !codes.length || codes.includes(stage);
    })
    : rows;
  const pick = staged[0];
  audit(userId, "knowledge.resolve", {
    skill_id: "email_compose",
    source: "legacy",
    resolved: pick ? [{ id: String(pick.id), version: Number(pick.current_version || 1) }] : [],
    skipped_count: Math.max(0, staged.length - (pick ? 1 : 0)),
  });
  return pick ? assertUsableKnowledge(String(pick.id), userId, brands) : null;
}

export function resolveApplicableMailTemplates(opts: {
  knowledgeId?: string | null;
  stageCode?: string | null;
  brand?: string | null;
  skillId?: string | null;
  userId?: string;
  brands?: string[];
}): UsableTemplate[] {
  const userId = opts.userId || knowledgeActorId();
  const brands = opts.brands || actorBrands();
  const skill = String(opts.skillId || "email_compose");
  if (skill !== "email_compose") return [];
  const stage = String(opts.stageCode || "").trim();
  const brand = String(opts.brand || "").trim();
  const requested = String(opts.knowledgeId || "").trim();
  const rows = requested
    ? [getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(requested) as Row | undefined].filter(Boolean) as Row[]
    : getConn().prepare(
      `SELECT k.* FROM knowledge k
        JOIN knowledge_citations c ON c.knowledge_id=k.id AND c.user_id=?
       WHERE k.status='published' AND k.kind='mail_template'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_deprecations d
            WHERE d.knowledge_id=k.id AND d.user_id=?
         )`,
    ).all(userId, userId) as Row[];
  const templates: UsableTemplate[] = [];
  for (const row of rows) {
    try {
      const template = assertMailTemplateSnapshotApplicable({
        knowledgeId: String(row.id),
        version: Number(row.published_version || 0),
        skillId: skill,
        stageCode: stage || null,
        brand: brand || null,
        userId,
        brands,
      });
      templates.push(template);
    } catch (error) {
      if (requested) throw error;
    }
  }
  return templates.sort((left, right) => {
    const rank = (template: UsableTemplate) => [
      template.brand === brand ? 0 : 1,
      template.stage_codes.includes(stage) ? 0 : 1,
    ];
    const [leftBrand, leftStage] = rank(left);
    const [rightBrand, rightStage] = rank(right);
    return leftBrand - rightBrand || leftStage - rightStage || left.id.localeCompare(right.id);
  });
}

export function leftoverPlaceholders(text: string): string[] {
  return [...String(text || "").matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  let out = text || "";
  const aliases: Record<string, string[]> = {
    handle: ["红人", "红人或合作"],
    amount: ["金额USD", "金额", "USD"],
    tracking: ["运单号"],
    carrier: ["承运商"],
    eta: ["ETA"],
    mailboxEmail: ["发件邮箱", "发件箱"],
    to: ["收件邮箱", "收件人"],
    subject: ["主题", "邮件主题"],
  };
  for (const [key, labels] of Object.entries(aliases)) {
    const value = values[key];
    if (!value) continue;
    for (const label of labels) {
      out = out.split(`[${label}]`).join(value);
    }
  }
  return out;
}

export function compileMailDraft(template: UsableTemplate, values: Record<string, string>): {
  subject: string;
  body: string;
  missing: string[];
} {
  const subject = fillTemplate(template.subject, values);
  const body = fillTemplate(template.body_en || template.body, values);
  const missing = [...new Set([...leftoverPlaceholders(subject), ...leftoverPlaceholders(body)])];
  return { subject, body, missing };
}

export function workerSafeExtra(extra: Json): Json {
  const copy: Json = { ...extra };
  delete copy.wiki;
  delete copy.knowledge_body;
  delete copy.raw;
  delete copy.knowledge_wiki;
  if (copy.mail_template && typeof copy.mail_template === "object") {
    const t = copy.mail_template as Json;
    copy.mail_template = {
      id: t.id,
      version: t.version,
      skill_id: t.skill_id,
      title: t.title,
      subject: t.subject,
      body_en: t.body_en,
      placeholders: t.placeholders,
      stage_codes: t.stage_codes,
      template_id: t.template_id,
    };
  }
  return copy;
}

export type KnowledgeListOpts = {
  q?: string | null;
  kind?: string | null;
  stage?: string | null;
  brand?: string | null;
  limit?: number | null;
  offset?: number | null;
};

function likeEscaped(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** id → handle：演示目录优先，真实账号回退 username（mapUser 的 handle 即 username）。 */
function viewerHandle(userId: string): string {
  const me = currentUser();
  if (me.id === userId) return me.handle;
  const db = getConn();
  const dir = db.prepare("SELECT handle FROM directory_users WHERE id=?").get(userId) as { handle?: string } | undefined;
  if (dir?.handle) return String(dir.handle);
  const user = db.prepare("SELECT username FROM users WHERE id=?").get(userId) as { username?: string } | undefined;
  return String(user?.username || userId);
}

/** 列表过滤：范围/授权先于取数；阶段与品牌只收窄，不过滤无授权行的已发布知识。 */
function knowledgeListFilters(opts: KnowledgeListOpts & { inMarket?: boolean } = {}): {
  sql: string;
  args: unknown[];
  filter: (row: Row) => boolean;
} {
  const clauses = ["status='published'"];
  const args: unknown[] = [];
  if (opts.inMarket) clauses.push("in_market=1");
  const q = String(opts.q || "").trim();
  if (q) {
    const like = `%${likeEscaped(q)}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR body_en LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like, like);
  }
  const kind = String(opts.kind || "").trim();
  if (kind) {
    clauses.push("kind=?");
    args.push(kind);
  }
  const stage = String(opts.stage || "").trim();
  const brand = String(opts.brand || "").trim();
  const handle = currentUser().handle;
  const filter = (row: Row): boolean => {
    if (!canSeeKnowledge(row, handle)) return false;
    if (!brandMatched(row)) return false;
    if (stage) {
      const codes = parseJsonArray(row.stage_codes);
      if (codes.length && !codes.includes(stage)) return false;
    }
    if (brand) {
      const rowBrand = String(row.brand || "*");
      if (rowBrand !== "*" && rowBrand !== brand) return false;
    }
    return true;
  };
  return { sql: `SELECT * FROM knowledge WHERE ${clauses.join(" AND ")} ORDER BY kind, title`, args, filter };
}

export function grantsForKnowledge(id: string): { org: string[]; team: string[]; user: string[] } {
  requireAdmin();
  knowledgeRow(id);
  const rows = getConn()
    .prepare("SELECT scope, scope_id FROM knowledge_grants WHERE knowledge_id=?")
    .all(id) as { scope: string; scope_id: string }[];
  const out = { org: [] as string[], team: [] as string[], user: [] as string[] };
  for (const row of rows) {
    if (row.scope === "org") out.org.push(row.scope_id);
    if (row.scope === "team") out.team.push(row.scope_id);
    if (row.scope === "user") out.user.push(row.scope_id);
  }
  return out;
}

export function setKnowledgeGrants(
  id: string,
  patch: { org?: string[]; team?: string[]; user?: string[] },
  actor = knowledgeActorId(),
): { org: string[]; team: string[]; user: string[] } {
  requireAdmin();
  knowledgeRow(id);
  const dir = directory();
  const orgOk = new Set(dir.orgs.map((row) => row.id));
  const teamOk = new Set(dir.teams.map((row) => row.id));
  const userOk = new Set(dir.users.map((row) => row.handle));
  const next = {
    org: [...new Set(patch.org || [])],
    team: [...new Set(patch.team || [])],
    user: [...new Set(patch.user || [])],
  };
  for (const scopeId of next.org) if (!orgOk.has(scopeId)) throw new HttpFail(400, "unknown org");
  for (const scopeId of next.team) if (!teamOk.has(scopeId)) throw new HttpFail(400, "unknown team");
  for (const scopeId of next.user) if (!userOk.has(scopeId)) throw new HttpFail(400, "unknown user");
  const now = nowIso();
  tx((db) => {
    db.prepare("DELETE FROM knowledge_grants WHERE knowledge_id=?").run(id);
    const ins = db.prepare(
      "INSERT INTO knowledge_grants (id,knowledge_id,scope,scope_id,granted_by,granted_at) VALUES (?,?,?,?,?,?)",
    );
    for (const scopeId of next.org) ins.run(nid("kgr"), id, "org", scopeId, actor, now);
    for (const scopeId of next.team) ins.run(nid("kgr"), id, "team", scopeId, actor, now);
    for (const scopeId of next.user) ins.run(nid("kgr"), id, "user", scopeId, actor, now);
  });
  audit(actor, "knowledge.grant.save", { knowledge_id: id, org: next.org, team: next.team, user: next.user });
  return grantsForKnowledge(id);
}

/** 某条知识出现授权行时按对象收窄；无授权行者维持「已发布即可见」。 */
export function canSeeKnowledge(row: Row, handle?: string): boolean {
  const id = String(row.id || "");
  if (!id) return true;
  const rows = getConn()
    .prepare("SELECT scope, scope_id FROM knowledge_grants WHERE knowledge_id=?")
    .all(id) as { scope: string; scope_id: string }[];
  if (!rows.length) return true;
  const who = handle || currentUser().handle;
  const mem = memberScopeIds(who);
  return rows.some((grant) =>
    (grant.scope === "org" && mem.orgs.includes(grant.scope_id)) ||
    (grant.scope === "team" && mem.teams.includes(grant.scope_id)) ||
    (grant.scope === "user" && grant.scope_id === who)
  );
}

export function getKnowledgeVersion(id: string, version: number): Json {
  requireAdmin();
  if (!Number.isFinite(Number(version))) throw new HttpFail(404, "version not found");
  knowledgeRow(id);
  const row = getConn()
    .prepare("SELECT * FROM knowledge_versions WHERE knowledge_id=? AND version=?")
    .get(id, Number(version)) as Row | undefined;
  if (!row) throw new HttpFail(404, "version not found");
  return row;
}

/** 回滚 = 以历史版本内容生成新草稿版本，历史行不动。 */
export function rollbackKnowledge(id: string, version: number, actor = knowledgeActorId()): Json {
  requireAdmin();
  if (!Number.isFinite(Number(version))) throw new HttpFail(404, "version not found");
  const prev = knowledgeRow(id);
  const snap = getConn()
    .prepare("SELECT * FROM knowledge_versions WHERE knowledge_id=? AND version=?")
    .get(id, Number(version)) as Row | undefined;
  if (!snap) throw new HttpFail(404, "version not found");
  const next: Row = {
    ...prev,
    title: String(snap.title ?? prev.title),
    body: String(snap.body ?? prev.body),
    tags: String(snap.tags ?? prev.tags),
    kind: String(snap.kind || prev.kind),
    skill_id: String(snap.skill_id ?? prev.skill_id),
    brand: String(snap.brand ?? prev.brand) || "*",
    lang: String(snap.lang || prev.lang),
    subject: String(snap.subject ?? prev.subject),
    body_en: String(snap.body_en ?? prev.body_en),
    placeholders: String(snap.placeholders ?? prev.placeholders),
    stage_codes: String(snap.stage_codes ?? prev.stage_codes),
    status: "draft",
    current_version: Number(prev.current_version || 1) + 1,
    updated_at: nowIso(),
  };
  tx((db) => {
    db.prepare(
      `UPDATE knowledge
          SET title=?,body=?,tags=?,kind=?,skill_id=?,brand=?,lang=?,subject=?,body_en=?,placeholders=?,stage_codes=?,status=?,current_version=?,updated_at=?
        WHERE id=?`,
    ).run(
      next.title, next.body, next.tags, next.kind, next.skill_id, next.brand, next.lang, next.subject,
      next.body_en, next.placeholders, next.stage_codes, next.status, next.current_version, next.updated_at, id,
    );
    writeVersion(db, next, `rollback from v${Number(version)}`, actor);
  });
  audit(actor, "knowledge.rollback", { knowledge_id: id, from_version: Number(version), to_version: next.current_version });
  return publicKnowledge(knowledgeRow(id), actor);
}

export const BINDING_SELECTOR_KEYS = ["ids", "kinds", "tags", "stage_codes", "brand", "lang"] as const;

export type KnowledgeBindingSelector = {
  ids?: string[];
  kinds?: string[];
  tags?: string[];
  stage_codes?: string[];
  brand?: string;
  lang?: string;
};

type StoredBinding = { id: string; skill_id: string; selector: KnowledgeBindingSelector };

function stringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeSelector(value: unknown): KnowledgeBindingSelector {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "{}");
    } catch {
      throw new HttpFail(400, "selector 须为 JSON 对象");
    }
  }
  if (raw == null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpFail(400, "selector 须为 JSON 对象");
  const input = raw as Json;
  for (const key of Object.keys(input)) {
    if (!(BINDING_SELECTOR_KEYS as readonly string[]).includes(key)) {
      throw new HttpFail(400, `selector 允许键：${BINDING_SELECTOR_KEYS.join(" / ")}`);
    }
  }
  const kinds = stringList(input.kinds);
  for (const kind of kinds) {
    if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
      throw new HttpFail(400, "kind 须为 mail_template / policy / pattern / glossary");
    }
  }
  const selector: KnowledgeBindingSelector = {};
  const ids = stringList(input.ids);
  if (ids.length) selector.ids = ids;
  if (kinds.length) selector.kinds = kinds;
  const tags = stringList(input.tags);
  if (tags.length) selector.tags = tags;
  const stageCodes = stringList(input.stage_codes);
  if (stageCodes.length) selector.stage_codes = stageCodes;
  const brand = String(input.brand == null ? "" : input.brand).trim();
  if (brand) selector.brand = brand;
  const lang = String(input.lang == null ? "" : input.lang).trim();
  if (lang) selector.lang = lang;
  return selector;
}

function parseSelectorStored(value: unknown): KnowledgeBindingSelector {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as KnowledgeBindingSelector;
  } catch {
    return {};
  }
}

function bindingRows(skillId?: string, enabledOnly = false): Row[] {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (enabledOnly) clauses.push("enabled=1");
  if (skillId) {
    clauses.push("skill_id=?");
    args.push(skillId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return getConn()
    .prepare(`SELECT * FROM knowledge_bindings${where} ORDER BY created_at, id`)
    .all(...args) as Row[];
}

function storedBindings(skillId?: string, enabledOnly = false): StoredBinding[] {
  return bindingRows(skillId, enabledOnly).map((row) => ({
    id: String(row.id),
    skill_id: String(row.skill_id),
    selector: parseSelectorStored(row.selector),
  }));
}

export function listBindings(): Json[] {
  requireAdmin();
  return bindingRows().map((row) => ({ ...row, selector: parseSelectorStored(row.selector) }));
}

export function saveBinding(
  input: { id?: string; skill_id?: string; selector?: unknown; enabled?: boolean | number; note?: string },
  actor = knowledgeActorId(),
): Json {
  requireAdmin();
  const id = String(input.id || "").trim();
  const prev = id
    ? getConn().prepare("SELECT * FROM knowledge_bindings WHERE id=?").get(id) as Row | undefined
    : undefined;
  if (id && !prev) throw new HttpFail(404, "binding not found");
  const skillId = String(input.skill_id == null ? prev?.skill_id ?? "" : input.skill_id).trim();
  if (!skillId) throw new HttpFail(400, "skill_id required");
  const selector = input.selector == null ? parseSelectorStored(prev?.selector) : normalizeSelector(input.selector);
  const enabled = input.enabled == null ? (Number(prev?.enabled ?? 1) ? 1 : 0) : (input.enabled ? 1 : 0);
  const note = input.note == null ? String(prev?.note ?? "") : String(input.note);
  const bindingId = id || nid("kbind");
  const now = nowIso();
  tx((db) => {
    if (prev) {
      db.prepare("UPDATE knowledge_bindings SET skill_id=?,selector=?,enabled=?,note=?,updated_at=? WHERE id=?")
        .run(skillId, JSON.stringify(selector), enabled, note, now, bindingId);
    } else {
      db.prepare(
        `INSERT INTO knowledge_bindings (id,skill_id,selector,enabled,note,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(bindingId, skillId, JSON.stringify(selector), enabled, note, actor, now, now);
    }
  });
  audit(actor, "knowledge.binding.save", { binding_id: bindingId, skill_id: skillId, enabled });
  const row = getConn().prepare("SELECT * FROM knowledge_bindings WHERE id=?").get(bindingId) as Row;
  return { ...row, selector: parseSelectorStored(row.selector) };
}

export function deleteBinding(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const row = getConn().prepare("SELECT * FROM knowledge_bindings WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "binding not found");
  tx((db) => {
    db.prepare("DELETE FROM knowledge_bindings WHERE id=?").run(id);
  });
  audit(actor, "knowledge.binding.save", {
    binding_id: id,
    skill_id: String(row.skill_id || ""),
    enabled: Number(row.enabled || 0),
    deleted: true,
  });
  return { ok: true, id };
}

export function bindingMatchesRow(selector: KnowledgeBindingSelector, row: Row): boolean {
  const ids = selector.ids || [];
  if (ids.length && !ids.includes(String(row.id || ""))) return false;
  const kinds = selector.kinds || [];
  if (kinds.length && !kinds.includes(String(row.kind || ""))) return false;
  const tags = selector.tags || [];
  if (tags.length) {
    const rowTags = String(row.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    if (!tags.some((tag) => rowTags.includes(tag))) return false;
  }
  const brand = String(selector.brand || "").trim();
  if (brand) {
    const rowBrand = String(row.brand || "*");
    if (rowBrand !== "*" && rowBrand !== brand) return false;
  }
  const lang = String(selector.lang || "").trim();
  if (lang && String(row.lang || "en") !== lang) return false;
  return true;
}

export type KnowledgeResolveItem = {
  id: string;
  version: number;
  title: string;
  kind: string;
  subject: string;
  stage_codes: string[];
  brand: string;
};

export type KnowledgeResolveSkip = { knowledge_id: string; title?: string; reason: string };

export type KnowledgeResolveResult = {
  resolved: KnowledgeResolveItem[];
  skipped: KnowledgeResolveSkip[];
  bound: boolean;
};

function stagePriority(row: Row, stage: string): number {
  const codes = parseJsonArray(row.stage_codes);
  if (stage && codes.includes(stage)) return 0;
  if (!codes.length) return 1;
  return 2;
}

function brandPriority(row: Row): number {
  const brand = String(row.brand || "*");
  return brand && brand !== "*" ? 0 : 1;
}

/** 运行时解析（员工路径可用，不加 requireAdmin）：显式 ids > 阶段精确 > 品牌精确 > 更新时间。 */
export function resolveForSkill(
  skillId: string,
  opts: { userId?: string; brands?: string[]; stageCode?: string | null; record?: boolean } = {},
): KnowledgeResolveResult {
  const skill = String(skillId || "").trim();
  const bindings = skill ? storedBindings(skill, true) : [];
  if (!bindings.length) return { resolved: [], skipped: [], bound: false };
  const userId = opts.userId || knowledgeActorId();
  const brands = opts.brands || actorBrands();
  const stage = String(opts.stageCode || "").trim();
  const handle = viewerHandle(userId);
  const db = getConn();
  const published = db.prepare("SELECT * FROM knowledge WHERE status='published'").all() as Row[];
  const citedIds = new Set(
    (db.prepare("SELECT knowledge_id FROM knowledge_citations WHERE user_id=?").all(userId) as Row[])
      .map((row) => String(row.knowledge_id)),
  );
  const deprecatedIds = new Set(
    (db.prepare("SELECT knowledge_id FROM knowledge_deprecations WHERE user_id=?").all(userId) as Row[])
      .map((row) => String(row.knowledge_id)),
  );
  const skipped: KnowledgeResolveSkip[] = [];
  const skipKeys = new Set<string>();
  const pushSkip = (entry: KnowledgeResolveSkip): void => {
    const key = `${entry.knowledge_id}:${entry.reason}`;
    if (skipKeys.has(key)) return;
    skipKeys.add(key);
    skipped.push(entry);
  };
  const gateReason = (row: Row): string | null => {
    if (!brandMatched(row, brands) || !canSeeKnowledge(row, handle)) return "scope_mismatch";
    if (!citedIds.has(String(row.id))) return "not_cited";
    if (deprecatedIds.has(String(row.id))) return "deprecated_by_user";
    return null;
  };
  const pinned: string[] = [];
  const candidates = new Map<string, Row>();
  const evaluated = new Set<string>();
  for (const binding of bindings) {
    for (const id of binding.selector.ids || []) {
      const row = db.prepare("SELECT * FROM knowledge WHERE id=?").get(id) as Row | undefined;
      if (!row) {
        pushSkip({ knowledge_id: id, reason: "missing" });
        continue;
      }
      if (!pinned.includes(id)) pinned.push(id);
      if (evaluated.has(id)) continue;
      if (String(row.status) !== "published") {
        pushSkip({ knowledge_id: id, title: String(row.title || ""), reason: "not_published" });
        evaluated.add(id);
        continue;
      }
      if (!bindingMatchesRow(binding.selector, row)) continue;
      const reason = gateReason(row);
      if (reason) {
        pushSkip({ knowledge_id: id, title: String(row.title || ""), reason });
        evaluated.add(id);
        continue;
      }
      candidates.set(id, row);
      evaluated.add(id);
    }
    for (const row of published) {
      if (!bindingMatchesRow(binding.selector, row)) continue;
      const id = String(row.id);
      if (evaluated.has(id)) continue;
      const reason = gateReason(row);
      if (reason) {
        pushSkip({ knowledge_id: id, title: String(row.title || ""), reason });
        evaluated.add(id);
        continue;
      }
      candidates.set(id, row);
      evaluated.add(id);
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => {
    const ai = pinned.indexOf(String(a.id));
    const bi = pinned.indexOf(String(b.id));
    const ap = ai < 0 ? Number.MAX_SAFE_INTEGER : ai;
    const bp = bi < 0 ? Number.MAX_SAFE_INTEGER : bi;
    if (ap !== bp) return ap - bp;
    const stageDiff = stagePriority(a, stage) - stagePriority(b, stage);
    if (stageDiff) return stageDiff;
    const brandDiff = brandPriority(a) - brandPriority(b);
    if (brandDiff) return brandDiff;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
  const resolved: KnowledgeResolveItem[] = [];
  const seenKinds = new Set<string>();
  for (const row of ordered) {
    const kind = String(row.kind || "policy");
    resolved.push({
      id: String(row.id),
      version: Number(row.current_version || 1),
      title: String(row.title || ""),
      kind,
      subject: String(row.subject || ""),
      stage_codes: parseJsonArray(row.stage_codes),
      brand: String(row.brand || "*"),
    });
    if (seenKinds.has(kind)) {
      pushSkip({ knowledge_id: String(row.id), title: String(row.title || ""), reason: "shadowed_by_higher_priority" });
    } else {
      seenKinds.add(kind);
    }
  }
  if (opts.record) {
    audit(userId, "knowledge.resolve", {
      skill_id: skill,
      source: "binding",
      resolved: resolved.map((item) => ({ id: item.id, version: item.version })),
      skipped_count: skipped.length,
    });
  }
  return { resolved, skipped, bound: true };
}

export function resolvePreview(input: {
  skill_id?: string;
  user_id?: string;
  stage_code?: string;
  brand?: string;
}): Json {
  requireAdmin();
  const skillId = String(input.skill_id || "").trim();
  if (!skillId) throw new HttpFail(400, "skill_id required");
  const userId = String(input.user_id || "").trim() || knowledgeActorId();
  const brand = String(input.brand || "").trim();
  const result = resolveForSkill(skillId, {
    userId,
    brands: brand ? [brand] : actorBrands(),
    stageCode: input.stage_code,
    record: false,
  });
  const bindings: Json[] = bindingRows(skillId).map((row) => ({ ...row, selector: parseSelectorStored(row.selector) }));
  const skipped: KnowledgeResolveSkip[] = [...result.skipped];
  const seen = new Set(skipped.map((entry) => `${entry.knowledge_id}:${entry.reason}`));
  const published = getConn().prepare("SELECT * FROM knowledge WHERE status='published'").all() as Row[];
  for (const binding of bindings) {
    if (Number(binding.enabled || 0)) continue;
    const selector = parseSelectorStored(binding.selector);
    for (const row of published) {
      if (!bindingMatchesRow(selector, row)) continue;
      const id = String(row.id);
      const key = `${id}:binding_disabled`;
      if (seen.has(key)) continue;
      seen.add(key);
      skipped.push({ knowledge_id: id, title: String(row.title || ""), reason: "binding_disabled" });
    }
  }
  return { resolved: result.resolved, skipped, bindings };
}

export function listFeedback(): Json[] {
  requireAdmin();
  return getConn()
    .prepare(
      `SELECT d.user_id, d.knowledge_id, k.title AS title, d.reason, d.reason_note, d.deprecated_at,
              d.handled_at, d.handled_by, d.handle_action, d.handle_note
         FROM knowledge_deprecations d
         LEFT JOIN knowledge k ON k.id = d.knowledge_id
        ORDER BY d.deprecated_at DESC`,
    )
    .all() as Json[];
}

export function handleFeedback(
  knowledgeId: string,
  userId: string,
  action: "to_revision" | "archive" | "ignore",
  note = "",
  actor = knowledgeActorId(),
): Json {
  requireAdmin();
  if (!["to_revision", "archive", "ignore"].includes(action)) {
    throw new HttpFail(400, "action 须为 to_revision / archive / ignore");
  }
  const db = getConn();
  const owner = String(userId || "").trim();
  const dep = db
    .prepare("SELECT * FROM knowledge_deprecations WHERE user_id=? AND knowledge_id=?")
    .get(owner, knowledgeId) as Row | undefined;
  if (!dep) throw new HttpFail(404, "feedback not found");
  if (dep.handled_at) throw new HttpFail(409, "feedback already handled");
  const now = nowIso();
  if (action === "to_revision") {
    const prev = knowledgeRow(knowledgeId);
    const next: Row = {
      ...prev,
      status: "draft",
      current_version: Number(prev.current_version || 1) + 1,
      updated_at: now,
    };
    tx((inner) => {
      inner.prepare("UPDATE knowledge SET status='draft',current_version=?,updated_at=? WHERE id=?")
        .run(next.current_version, next.updated_at, knowledgeId);
      writeVersion(inner, next, "feedback to_revision", actor);
    });
  } else if (action === "archive") {
    archiveKnowledge(knowledgeId, actor);
  }
  tx((inner) => {
    inner.prepare(
      "UPDATE knowledge_deprecations SET handled_at=?,handled_by=?,handle_action=?,handle_note=? WHERE user_id=? AND knowledge_id=?",
    ).run(now, actor, action, String(note || ""), owner, knowledgeId);
  });
  audit(actor, "knowledge.feedback.handle", { knowledge_id: knowledgeId, user_id: owner, action });
  return db
    .prepare(
      `SELECT d.*, k.title AS title FROM knowledge_deprecations d
        LEFT JOIN knowledge k ON k.id = d.knowledge_id
        WHERE d.user_id=? AND d.knowledge_id=?`,
    )
    .get(owner, knowledgeId) as Json;
}

export function adminAssets(): Json[] {
  requireAdmin();
  const bindings = storedBindings(undefined, true);
  return adminList().map((row) => ({
    ...row,
    ref_skills: [...new Set(
      bindings.filter((binding) => bindingMatchesRow(binding.selector, row)).map((binding) => binding.skill_id),
    )],
  }));
}

export function seedKnowledge(conn = getConn()): void {
  const now = "2026-01-01T00:00:00.000Z";
  const actor = "system";
  const policies: Array<{
    id: string;
    title: string;
    body: string;
    tags: string;
    skill_id: string;
  }> = [
    {
      id: "kb_followup",
      title: "跟进信模板（阶段保持）",
      body: "Follow-up must keep official stage. Never imply a new commercial commitment. Sign with brand mailbox.",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_quote",
      title: "报价信与审批带",
      body: "报价走写合作邮件。发送不等于改阶段。金额与审批在 Starry 邮件预览里由人确认。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_addr",
      title: "地址核验口径",
      body: "姓名/电话/完整地址/国家邮编/SKU/数量。齐全才可以出库。不调用 WMS。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
    {
      id: "kb_nudge",
      title: "内容催更门槛",
      body: "催大纲用写合作邮件。发送不等于改阶段。",
      tags: "email_compose,policy",
      skill_id: "email_compose",
    },
  ];
  const mails: Array<{
    id: string;
    title: string;
    skill_id: (typeof MAIL_SKILLS)[number];
    brand: string;
    subject: string;
    body_en: string;
    placeholders: string[];
    stage_codes: string[];
    tags: string;
  }> = [
    {
      id: "kb_mail_kol",
      title: "首封建联",
      skill_id: "email_compose",
      brand: "LT",
      subject: "LiTime Mini 12V — weekend van test",
      body_en:
        "Hi,\n\nWe would love to send a LiTime Mini 12V for a weekend van test. Happy to share the spec sheet whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[发件邮箱]", "[收件邮箱]", "[主题]"],
      stage_codes: ["INITIAL_CONTACT"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_followup",
      title: "阶段跟进",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Following up — LiTime collab kit",
      body_en:
        "Hi,\n\nJust a quick follow-up on the LiTime collab kit we mentioned last week. Happy to share the spec sheet or a short unboxing angle whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["INITIAL_CONTACT", "INTERESTED"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_quote",
      title: "报价确认",
      skill_id: "email_compose",
      brand: "LT",
      subject: "LiTime collaboration quote — USD [金额USD] per hour",
      body_en:
        "Hi,\n\nPlease find the LiTime collaboration quote at USD [金额USD] per hour.\n\nReply to this thread if this rate works.\n\nBest,\nLiTime Creator Desk\n",
      placeholders: ["[红人]", "[金额USD]"],
      stage_codes: ["QUOTE_PENDING", "NEGOTIATING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_addr",
      title: "地址催补",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Need shipping details for the sample kit",
      body_en:
        "Hi,\n\nBefore we can ship the sample, please reply with your recipient name, phone, full address, country, postal code, SKU and quantity.\n\nBest,\nCreator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["SAMPLE_PENDING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_nudge",
      title: "催大纲",
      skill_id: "email_compose",
      brand: "RO",
      subject: "Outline check-in — family camping power",
      body_en:
        "Hi,\n\nChecking in on the family camping power outline. A one-pager with shot list and publish window would help us lock the sample kit.\n\nBest,\nRenogy Creator Desk\n",
      placeholders: ["[红人或合作]"],
      stage_codes: ["TESTING", "CONTENT_PLANNING"],
      tags: "email_compose,mail_template",
    },
    {
      id: "kb_mail_ship",
      title: "发货通知",
      skill_id: "email_compose",
      brand: "LT",
      subject: "Sample shipped — [运单号]",
      body_en:
        "Hi,\n\nYour sample kit is on the way.\nTracking: [运单号]\nCarrier: [承运商]\n\nBest,\nCreator Desk\n",
      placeholders: ["[运单号]", "[承运商]"],
      stage_codes: ["SHIPPED"],
      tags: "email_compose,mail_template",
    },
  ];

  const upsert = conn.prepare(
    `INSERT OR REPLACE INTO knowledge
     (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,published_version,created_by,approved_by,approved_at,created_at,updated_at)
     VALUES (?,?,?,?,1,?,?,?, 'en', ?,?,?,?,'published',1,1,?,?,?,?,?)`,
  );
  const hasVersion = conn.prepare("SELECT 1 FROM knowledge_versions WHERE knowledge_id=? AND version=1");
  const insVer = conn.prepare(
    `INSERT INTO knowledge_versions
     (id,knowledge_id,version,title,body,subject,body_en,placeholders,stage_codes,skill_id,brand,lang,kind,status,created_by,created_at,note)
     VALUES (?,?,1,?,?,?,?,?,?,?,?,'en',?,'published',?,?,?)`,
  );

  for (const p of policies) {
    upsert.run(
      p.id, p.title, p.body, p.tags, "policy", p.skill_id, "*", "", "", "[]", "[]",
      actor, actor, now, now, now,
    );
    if (!hasVersion.get(p.id)) {
      insVer.run(
        `kv_${p.id}_1`, p.id, p.title, p.body, "", "", "[]", "[]", p.skill_id, "*", "policy", actor, now, "seed policy v1",
      );
    }
  }
  for (const m of mails) {
    upsert.run(
      m.id, m.title, m.body_en, m.tags, "mail_template", m.skill_id, m.brand, m.subject, m.body_en,
      JSON.stringify(m.placeholders), JSON.stringify(m.stage_codes),
      actor, actor, now, now, now,
    );
    if (!hasVersion.get(m.id)) {
      insVer.run(
        `kv_${m.id}_1`, m.id, m.title, m.body_en, m.subject, m.body_en,
        JSON.stringify(m.placeholders), JSON.stringify(m.stage_codes),
        m.skill_id, m.brand, "mail_template", actor, now, "seed mail_template v1",
      );
    }
  }
}
