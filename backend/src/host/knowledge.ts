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

export const KNOWLEDGE_KINDS = ["mail_template", "policy", "pattern", "glossary"] as const;
export const KNOWLEDGE_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
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
    starter: composerStarter(row),
  };
}

function listed(sql: string, args: unknown[]): Json[] {
  const userId = knowledgeActorId();
  const rows = getConn().prepare(sql).all(...args) as Row[];
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
      viewer_deprecate_reason: dep ? String(dep.reason || "") : "",
      viewer_deprecate_note: dep ? String(dep.reason_note || "") : "",
      viewer_deprecated_at: dep ? String(dep.deprecated_at || "") : "",
      cite_count: counts.get(String(row.id)) || 0,
    }, userId);
  });
}

export function listPublishedForOps(): Json[] {
  return listed("SELECT * FROM knowledge WHERE status='published' ORDER BY kind, title", []);
}

export function listMarket(): Json[] {
  return listed("SELECT * FROM knowledge WHERE status='published' AND in_market=1 ORDER BY kind, title", []);
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
  return rows.filter((row) => brandMatched(row, brands)).map((row) => ({
    ...publicKnowledge(row, userId),
    intent: row.skill_id,
    starter: composerStarter(row),
  }));
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
       (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,created_by,approved_by,approved_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      row.id, row.title, row.body, row.tags, row.in_market, row.kind, row.skill_id, row.brand, row.lang,
      row.subject, row.body_en, row.placeholders, row.stage_codes, row.status, row.current_version,
      row.created_by, row.approved_by, row.approved_at, row.created_at, row.updated_at,
    );
    writeVersion(db, row, "create", actor);
  });
  audit(actor, "knowledge.create", { knowledge_id: id, status: row.status });
  return publicKnowledge(knowledgeRow(id), actor);
}

export function editKnowledge(id: string, input: UpsertInput, actor = knowledgeActorId()): Json {
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

export function approveKnowledge(id: string, actor = knowledgeActorId()): Json {
  requireAdmin();
  const row = knowledgeRow(id);
  if (String(row.status) === "archived") throw new HttpFail(400, "已归档知识不能直接发布");
  const now = nowIso();
  const version = Number(row.current_version || 1);
  tx((db) => {
    db.prepare(
      "UPDATE knowledge SET status='published',approved_by=?,approved_at=?,updated_at=? WHERE id=?",
    ).run(actor, now, now, id);
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

export function assertUsableKnowledge(knowledgeId: string, userId = knowledgeActorId(), brands = actorBrands()): UsableTemplate {
  const row = getConn().prepare("SELECT * FROM knowledge WHERE id=?").get(knowledgeId) as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "knowledge_missing", message: "知识不存在" });
  if (String(row.status) !== "published") {
    throw new HttpFail(403, { code: "knowledge_unapproved", message: "未审批知识不能进入会话或 Worker" });
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
  const skill = String(row.skill_id || "");
  const stageCodes = parseJsonArray(row.stage_codes);
  const templateId = skill === "email_compose" || !skill
    ? pickComposeTemplate("email_compose", stageCodes[0] || null, String(row.title || "")).id
    : `${skill}.v1`;
  return {
    id: String(row.id),
    version: Number(row.current_version || 1),
    kind: String(row.kind || "policy"),
    skill_id: skill,
    brand: String(row.brand || "*"),
    subject: String(row.subject || ""),
    body_en: String(row.body_en || ""),
    body: String(row.body || ""),
    placeholders: parseJsonArray(row.placeholders),
    stage_codes: stageCodes,
    title: String(row.title || ""),
    template_id: templateId,
  };
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
  const rows = composerItems(userId, brands);
  if (!rows.length) return null;
  const staged = stage
    ? rows.filter((row) => {
      const codes = Array.isArray(row.stage_codes) ? row.stage_codes.map(String) : [];
      return !codes.length || codes.includes(stage);
    })
    : rows;
  const pick = staged[0];
  return pick ? assertUsableKnowledge(String(pick.id), userId, brands) : null;
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
     (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,created_by,approved_by,approved_at,created_at,updated_at)
     VALUES (?,?,?,?,1,?,?,?, 'en', ?,?,?,?,'published',1,?,?,?,?,?)`,
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
