/**
 * WikiSkill 三层：Raw（系统只写）→ Wiki（管理员抽取/审批）→ Skill + published mail_template。
 * Inference / Worker 不得读 wiki 全文。已启用的 mail_template 只把
 * subject / body_en / placeholders 写入 CONTEXT，由 Codex harness 当这一封底稿。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { authDisabled, isAdmin, requireAdmin, scopedUser } from "../auth.js";
import { BRAND_MAILBOXES, DEMO_USER, dataDir } from "../config.js";
import { audit, postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { pickComposeTemplate } from "./compose-loop.js";
import { currentUser, personaAccess } from "./persona.js";
import { departmentHeadAccessForUser } from "../contract-scope.js";
import { directory, memberScopeIds } from "./grants.js";
import { knowledgeKindSpec, validateStructuredFields } from "../knowledge-kinds.js";
import { knowledgeBindingMatchesRow } from "../knowledge/binding-selector.js";
import { editCatalogDomain, editCatalogBase, type DomainPatch, type BasePatch } from "../knowledge/taxonomy-mutations.js";
export const KNOWLEDGE_KINDS = ["mail_template", "prompt", "policy", "pattern", "glossary", "question_template"] as const;
export const KNOWLEDGE_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
/** 公海工作台四类动作的问题模板槽位；模板正文存于 kind='question_template' 的知识行。 */
export const QUESTION_TEMPLATE_SLOTS = ["potential", "risk", "completeness", "score"] as const;
export type QuestionTemplateSlot = (typeof QUESTION_TEMPLATE_SLOTS)[number];
/** 槽位约定：模板 tags 里带 `pool-question:<slot>`。 */
export const QUESTION_TEMPLATE_TAG_PREFIX = "pool-question:";
const KNOWLEDGE_KIND_HINT = KNOWLEDGE_KINDS.join(" / ");
export const KNOWLEDGE_SKIP_REASONS = [
  "not_published",
  "scope_mismatch",
  "not_cited",
  "deprecated_by_user",
  "expired",
  "wrong_base_type",
  "shadowed_by_higher_priority",
  "binding_disabled",
  "missing",
] as const;
export const DEPRECATE_REASONS = {
  not_helpful: "这条对我没帮助",
  outdated: "内容过时",
  brand_mismatch: "品牌用不上",
  pep_risk: "发出去容易被拦",
} as const;
const DEPRECATE_REASON_ALIASES: Record<string, keyof typeof DEPRECATE_REASONS> = {
  not_helpful: "not_helpful",
  这条对我没帮助: "not_helpful",
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
  if (!mapped)
    throw new HttpFail(400, "隐藏原因须为 这条对我没帮助 / 内容过时 / 品牌用不上 / 发出去容易被拦");
  return mapped;
}
const MAIL_SKILLS = ["email_compose"] as const;
const PLACEHOLDER_RE = /\[[^\]\n]{1,32}\]/g;
export async function knowledgeActorId(): Promise<string> {
  return scopedUser()?.id || (await currentUser()).id || DEMO_USER.id;
}
export async function actorBrands(): Promise<string[]> {
  const user = authDisabled() ? (await currentUser()) : (scopedUser() || (await currentUser()));
  const departmentHead = departmentHeadAccessForUser(user);
  if (departmentHead?.company_wide && departmentHead.brand_scope === "all")
    return Object.keys(BRAND_MAILBOXES);
  return [...(user.brands || [])];
}
function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  }
  catch {
    return String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
}
function asRow(row: Row | undefined): Row {
  if (!row)
    throw new HttpFail(404, "knowledge not found");
  return { ...row };
}
export async function knowledgeRow(id: string): Promise<Row> {
  return asRow((await postgresDb().one("SELECT * FROM knowledge WHERE id=$1", id)) as Row | undefined);
}
// ---------------------------------------------------------------------------
// 知识分层（2026-10-01，DECISIONS ADR-2026-10-01 三）：
// 主题域族 → 主题域 → 知识库。分类只做业务归类，不承载权限
// （可见范围仍走 knowledge_grants / 品牌 / 阶段）。
// ---------------------------------------------------------------------------
export const KNOWLEDGE_DOMAIN_LEVELS = ["family", "domain"] as const;
export const KNOWLEDGE_BASE_KINDS = ["structured", "unstructured"] as const;
export const KNOWLEDGE_DOMAIN_CODE_RE = /^[a-z][a-z0-9_]*$/;
export type KnowledgeDomainLevel = (typeof KNOWLEDGE_DOMAIN_LEVELS)[number];
export type KnowledgeBaseKind = (typeof KNOWLEDGE_BASE_KINDS)[number];
const DOMAIN_COLUMNS = "id,code,name,level,parent_id,sort,status,note,created_at,updated_at";
const TAXONOMY_JOIN = `LEFT JOIN knowledge_bases b ON b.id=k.base_id
   LEFT JOIN knowledge_domains d ON d.id=b.domain_id
   LEFT JOIN knowledge_domains f ON f.id=d.parent_id`;
const KNOWLEDGE_LIST_COLUMNS = `k.*, b.code AS base_code, b.name AS base_name,
   d.id AS domain_id, d.name AS domain_name, f.id AS family_id, f.name AS family_name`;
const BASE_SELECT = `SELECT b.*, d.name AS domain_name, d.parent_id AS family_id, f.name AS family_name,
   (SELECT COUNT(*) FROM knowledge k WHERE k.base_id=b.id) AS entries
     FROM knowledge_bases b
     LEFT JOIN knowledge_domains d ON d.id=b.domain_id
     LEFT JOIN knowledge_domains f ON f.id=d.parent_id`;
async function domainRow(id: string): Promise<Row> {
  const row = (await postgresDb().one("SELECT * FROM knowledge_domains WHERE id=$1", id)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "主题域不存在");
  return { ...row };
}
async function domainView(id: string): Promise<Json> {
  return (await postgresDb().one(`SELECT ${DOMAIN_COLUMNS} FROM knowledge_domains WHERE id=$1`, id)) as Json;
}
function normalizeDomainLevel(value: unknown): KnowledgeDomainLevel {
  const level = String(value || "");
  if (!(KNOWLEDGE_DOMAIN_LEVELS as readonly string[]).includes(level)) {
    throw new HttpFail(400, "level 须为 family / domain");
  }
  return level as KnowledgeDomainLevel;
}
function normalizeBaseKind(value: unknown): KnowledgeBaseKind {
  const kind = String(value || "");
  if (!(KNOWLEDGE_BASE_KINDS as readonly string[]).includes(kind)) {
    throw new HttpFail(400, "kind 须为 structured / unstructured");
  }
  return kind as KnowledgeBaseKind;
}
function normalizeRecordStatus(value: unknown, fallback: string): "active" | "archived" {
  const status = String(value == null || value === "" ? fallback : value);
  if (status !== "active" && status !== "archived")
    throw new HttpFail(400, "status 须为 active / archived");
  return status;
}
function parseJsonObject(value: unknown, fallback: Json = {}): Json {
  if (value == null || value === "")
    return fallback;
  if (typeof value === "object" && !Array.isArray(value))
    return value as Json;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : fallback;
  }
  catch {
    return fallback;
  }
}
export async function listDomains(): Promise<Json[]> {
  (await requireAdmin());
  return (await postgresDb().many(`SELECT ${DOMAIN_COLUMNS} FROM knowledge_domains
        ORDER BY CASE level WHEN 'family' THEN 0 ELSE 1 END, sort, name, code`)) as Json[];
}
/** 用户侧只读分类目录：名称与管理端同读 knowledge_domains / knowledge_bases 主数据。 */
export async function publicKnowledgeTaxonomy(): Promise<{
  domains: Json[];
  bases: Json[];
}> {
  const domains = (await postgresDb().many(`SELECT ${DOMAIN_COLUMNS} FROM knowledge_domains
        WHERE status='active'
        ORDER BY CASE level WHEN 'family' THEN 0 ELSE 1 END, sort, name, code`)) as Json[];
  const bases = (await postgresDb().many(`${BASE_SELECT} WHERE b.status='active' ORDER BY f.sort, f.name, d.sort, d.name, b.name, b.code`)).map((row) => baseView(row as Row)) as Json[];
  return { domains, bases };
}
export async function createDomain(input: {
  code?: string;
  name?: string;
  level?: string;
  parent_id?: string | null;
  sort?: number | null;
  note?: string;
}, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const code = String(input.code || "").trim();
  if (!KNOWLEDGE_DOMAIN_CODE_RE.test(code))
    throw new HttpFail(400, "code 须为小写字母开头的 a-z0-9_ 编码");
  const name = String(input.name || "").trim();
  if (!name)
    throw new HttpFail(400, "name required");
  const level = normalizeDomainLevel(input.level);
  const parentId = String(input.parent_id == null ? "" : input.parent_id).trim();
  if (level === "family") {
    if (parentId)
      throw new HttpFail(400, "主题域族不能有父级（parent_id）");
  }
  else {
    if (!parentId)
      throw new HttpFail(400, "主题域必须给 parent_id（所属族）");
    const parent = (await postgresDb().one("SELECT * FROM knowledge_domains WHERE id=$1", parentId)) as Row | undefined;
    if (!parent)
      throw new HttpFail(400, "父级主题域不存在");
    if (String(parent.level) !== "family")
      throw new HttpFail(400, "主题域的父级必须是族（family）");
  }
  const conflict = (await postgresDb().one("SELECT 1 FROM knowledge_domains WHERE code=$1 AND COALESCE(parent_id,'')=$2", code, parentId));
  if (conflict)
    throw new HttpFail(409, { code: "knowledge_domain_code_conflict", message: "同一父级下编码已存在" });
  const id = nid("kdom");
  const now = nowIso();
  const sort = Number.isFinite(Number(input.sort)) ? Number(input.sort) : 0;
  const note = String(input.note || "");
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_domains (id,code,name,level,parent_id,sort,status,note,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, code, name, level, level === "family" ? null : parentId, sort, "active", note, actor, now, now));
  }));
  (await audit(actor, "knowledge.domain.save", { id, code, level, created: true }));
  return { domain: (await domainView(id)) };
}
export async function editDomain(id: string, patch: DomainPatch): Promise<Json> {
  return (await editCatalogDomain(id, patch));
}
async function baseRow(id: string): Promise<Row> {
  const row = (await postgresDb().one(`${BASE_SELECT} WHERE b.id=$1`, id)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "知识库不存在");
  return { ...row };
}
function baseView(row: Row): Json {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    domain_id: row.domain_id,
    domain_name: row.domain_name == null ? "" : String(row.domain_name),
    family_id: row.family_id == null ? null : String(row.family_id),
    family_name: row.family_name == null ? null : String(row.family_name),
    kind: row.kind,
    description: row.description == null ? "" : String(row.description),
    owner_user_id: row.owner_user_id == null ? "" : String(row.owner_user_id),
    status: row.status,
    settings: parseJsonObject(row.settings, {}),
    external_ref: row.external_ref == null || row.external_ref === "" ? null : parseJsonObject(row.external_ref, {}),
    version: Number(row.version || 1),
    entries: Number(row.entries || 0),
    created_at: row.created_at == null ? "" : String(row.created_at),
    updated_at: row.updated_at == null ? "" : String(row.updated_at),
  };
}
export async function listBases(opts: {
  domain_id?: string | null;
  kind?: string | null;
} = {}): Promise<Json[]> {
  (await requireAdmin());
  const clauses: string[] = [];
  const args: unknown[] = [];
  const domainId = String(opts.domain_id || "").trim();
  if (domainId) {
    args.push(domainId);
    clauses.push(`b.domain_id=$${args.length}`);
  }
  const kind = String(opts.kind || "").trim();
  if (kind) {
    args.push(kind);
    clauses.push(`b.kind=$${args.length}`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await postgresDb().many(`${BASE_SELECT}${where} ORDER BY f.sort, f.name, d.sort, d.name, b.name, b.code`, ...args)) as Row[];
  return rows.map(baseView);
}
export async function createBase(input: {
  code?: string;
  name?: string;
  domain_id?: string;
  kind?: string;
  description?: string;
  settings?: unknown;
  external_ref?: unknown;
}, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const code = String(input.code || "").trim();
  if (!code)
    throw new HttpFail(400, "code required");
  const name = String(input.name || "").trim();
  if (!name)
    throw new HttpFail(400, "name required");
  const domainId = String(input.domain_id || "").trim();
  if (!domainId)
    throw new HttpFail(400, "domain_id required");
  const domain = (await postgresDb().one("SELECT * FROM knowledge_domains WHERE id=$1", domainId)) as Row | undefined;
  if (!domain)
    throw new HttpFail(400, "主题域不存在");
  if (String(domain.level) !== "domain")
    throw new HttpFail(400, "知识库必须挂在主题域（level=domain）下");
  const kind = normalizeBaseKind(input.kind);
  const externalRef = input.external_ref == null || input.external_ref === "" ? null : JSON.stringify(input.external_ref);
  if (kind === "structured" && externalRef) {
    throw new HttpFail(400, { code: "knowledge_base_external_ref_forbidden", message: "结构化知识库不能带 external_ref" });
  }
  if ((await postgresDb().one("SELECT 1 FROM knowledge_bases WHERE code=$1", code))) {
    throw new HttpFail(409, { code: "knowledge_base_code_conflict", message: "知识库编码已存在" });
  }
  const id = nid("kbase");
  const now = nowIso();
  const settings = JSON.stringify(parseJsonObject(input.settings, {}));
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_bases
       (id,code,name,domain_id,kind,description,owner_user_id,status,settings,external_ref,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, id, code, name, domainId, kind, String(input.description || ""), actor, "active", settings, externalRef, 1, now, now));
  }));
  (await audit(actor, "knowledge.base.save", { id, code, kind, created: true }));
  return { base: baseView((await baseRow(id))) };
}
export async function editBase(id: string, patch: BasePatch): Promise<Json> {
  return (await editCatalogBase(id, patch));
}
/** 条目所属库的类型（无库或库已删为空串）。 */
async function baseKindOf(baseId: unknown): Promise<string> {
  const id = String(baseId || "").trim();
  if (!id)
    return "";
  const row = (await postgresDb().one("SELECT kind FROM knowledge_bases WHERE id=$1", id)) as Row | undefined;
  return row ? String(row.kind || "") : "";
}
function assertKindAllowedInBase(kindCode: string, baseKind: string): void {
  const spec = knowledgeKindSpec(kindCode);
  const allowed = spec?.baseKind || [];
  if (!allowed.includes(baseKind)) {
    throw new HttpFail(400, {
      code: "knowledge_kind_base_mismatch",
      message: `知识类型 ${kindCode} 不能放进 ${baseKind || "未知"} 库`,
    });
  }
}
/** 新建/搬家时的库校验：必填、存在、启用、且类型允许该 kind。 */
async function requireWritableBase(value: unknown, kindCode: string): Promise<Row> {
  const id = String(value == null ? "" : value).trim();
  if (!id) {
    throw new HttpFail(400, { code: "knowledge_base_required", message: "新建条目必须给 base_id（所属知识库）" });
  }
  const base = (await postgresDb().one("SELECT * FROM knowledge_bases WHERE id=$1", id)) as Row | undefined;
  if (!base)
    throw new HttpFail(400, { code: "knowledge_base_missing", message: "知识库不存在" });
  if (String(base.status) !== "active") {
    throw new HttpFail(400, { code: "knowledge_base_archived", message: "知识库已归档，不能写入条目" });
  }
  assertKindAllowedInBase(kindCode, String(base.kind || ""));
  return { ...base };
}
function structuredJson(kindCode: string, value: unknown): string | null {
  if (value == null)
    return null;
  const errors = validateStructuredFields(kindCode, value);
  if (errors.length)
    throw new HttpFail(400, { code: "knowledge_structured_invalid", errors });
  return JSON.stringify(value);
}
function parseStructured(value: unknown): Json | null {
  if (value == null || value === "")
    return null;
  if (typeof value === "object" && !Array.isArray(value))
    return value as Json;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  }
  catch {
    return null;
  }
}
/** 抽取候选等系统写入的默认落点：优先历史库，其次任一启用中的结构化库。 */
async function defaultStructuredBaseId(): Promise<string> {
  const row = (await postgresDb().one(`SELECT id FROM knowledge_bases WHERE kind='structured' AND status='active'
        ORDER BY CASE WHEN code='legacy' THEN 0 ELSE 1 END, id`)) as Row | undefined;
  if (!row)
    throw new HttpFail(400, { code: "knowledge_base_required", message: "没有可用的结构化知识库" });
  return String(row.id);
}
async function writeVersion(db: ReturnType<typeof postgresDb>, row: Row, note: string, actor: string): Promise<void> {
  (await db.execute(`INSERT INTO knowledge_versions
     (id,knowledge_id,version,title,body,subject,body_en,placeholders,stage_codes,skill_id,brand,lang,kind,status,tags,in_market,effective_at,expires_at,base_id,structured,source_body,created_by,created_at,note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`, nid("kv"), row.id, row.current_version, row.title, row.body, row.subject ?? "", row.body_en ?? "", row.placeholders ?? "[]", row.stage_codes ?? "[]", row.skill_id ?? "", row.brand ?? "*", row.lang ?? "en", row.kind ?? "policy", row.status ?? "draft", row.tags == null ? "" : String(row.tags), row.in_market == null ? 1 : Number(row.in_market), row.effective_at == null ? null : String(row.effective_at), row.expires_at == null ? null : String(row.expires_at), row.base_id == null ? null : String(row.base_id), row.structured == null ? null : String(row.structured), row.source_body == null ? null : String(row.source_body), actor, nowIso(), note));
}
export async function publicKnowledge(row: Row, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  const cited = row.viewer_cited == null
    ? Boolean((await postgresDb().one("SELECT 1 FROM knowledge_citations WHERE user_id=$1 AND knowledge_id=$2", userId, row.id)))
    : Boolean(row.viewer_cited);
  const favoriteVersion = row.viewer_favorite_version == null
    ? Number(((await postgresDb().one("SELECT saved_version FROM knowledge_favorites WHERE user_id=$1 AND knowledge_id=$2", userId, row.id)) as Row | undefined)?.saved_version || 0)
    : Number(row.viewer_favorite_version || 0);
  const dep = row.viewer_deprecate_reason == null
    ? (await postgresDb().one("SELECT reason, reason_note, deprecated_at, handled_at, handle_action FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=$2", userId, row.id)) as {
      reason: string;
      reason_note: string;
      deprecated_at: string;
      handled_at?: string;
      handle_action?: string;
    } | undefined
    : {
      reason: String(row.viewer_deprecate_reason || ""),
      reason_note: String(row.viewer_deprecate_note || ""),
      deprecated_at: String(row.viewer_deprecated_at || ""),
      handled_at: String(row.viewer_feedback_handled_at || ""),
      handle_action: String(row.viewer_feedback_handle_action || ""),
    };
  const citeCount = row.cite_count == null
    ? ((await postgresDb().one("SELECT COUNT(*) AS c FROM knowledge_citations WHERE knowledge_id=$1", row.id)) as {
      c: number;
    }).c
    : Number(row.cite_count);
  // 列表 SQL 已带 join 别名时直接用；单行查询（详情/写后回读）按 base_id 补一次库/域/族。
  const base = row.base_code == null
    ? (row.base_id
      ? (await postgresDb().one(`SELECT b.id AS base_id, b.code AS base_code, b.name AS base_name,
                d.id AS domain_id, d.name AS domain_name, f.id AS family_id, f.name AS family_name
           FROM knowledge_bases b
           LEFT JOIN knowledge_domains d ON d.id=b.domain_id
           LEFT JOIN knowledge_domains f ON f.id=d.parent_id
          WHERE b.id=$1`, String(row.base_id))) as Row | undefined
      : undefined)
    : row;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    in_market: Number(row.in_market || 0),
    kind: row.kind || "policy",
    base_id: base?.base_id == null ? null : String(base.base_id),
    base_code: base?.base_code == null ? null : String(base.base_code),
    base_name: base?.base_name == null ? null : String(base.base_name),
    domain_id: base?.domain_id == null ? null : String(base.domain_id),
    domain_name: base?.domain_name == null ? null : String(base.domain_name),
    family_id: base?.family_id == null ? null : String(base.family_id),
    family_name: base?.family_name == null ? null : String(base.family_name),
    structured: parseStructured(row.structured),
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
    favorite: favoriteVersion > 0,
    favorite_version: favoriteVersion || null,
    has_newer_version: favoriteVersion > 0 && Number(row.published_version || (row.status === "published" ? row.current_version : 0)) > favoriteVersion,
    deprecated: Boolean(dep),
    deprecate_reason: dep?.reason || "",
    deprecate_reason_label: dep?.reason ? DEPRECATE_REASONS[dep.reason as DeprecateReason] || dep.reason : "",
    deprecate_note: dep?.reason_note || "",
    deprecated_at: dep?.deprecated_at || "",
    feedback_handled: Boolean(dep?.handled_at),
    feedback_handled_at: dep?.handled_at || "",
    feedback_handle_action: dep?.handle_action || "",
    cite_count: citeCount,
    effective_at: row.effective_at || "",
    expires_at: row.expires_at || "",
    starter: composerStarter(row),
  };
}
async function listed(sql: string, args: unknown[], filter?: (row: Row) => boolean | Promise<boolean>, effectiveOnly = false): Promise<Json[]> {
  const userId = (await knowledgeActorId());
  const raw = (await postgresDb().many(sql, ...args)) as Row[];
  const all = effectiveOnly ? (await effectivePublishedRows(raw)) : raw;
  // 权限谓词需要读取权威 grant；不得将未解析的 Promise 交给
  // Array#filter（Promise 永远真值会导致全部知识被视作可见）。
  const rows = filter
    ? (await Promise.all(all.map(async (row) => (await filter(row)) ? row : undefined))).filter((row): row is Row => row !== undefined)
    : all;
  if (!rows.length)
    return [];
  const ids = rows.map((row) => String(row.id));
  const cited = new Set(((await postgresDb().many("SELECT knowledge_id FROM knowledge_citations WHERE user_id=$1 AND knowledge_id=ANY($2::text[])", userId, ids)) as Row[]).map((row) => String(row.knowledge_id)));
  const deprecated = new Map(((await postgresDb().many("SELECT knowledge_id,reason,reason_note,deprecated_at,handled_at,handle_action FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=ANY($2::text[])", userId, ids)) as Row[]).map((row) => [String(row.knowledge_id), row]));
  const favorites = new Map(((await postgresDb().many("SELECT knowledge_id,saved_version FROM knowledge_favorites WHERE user_id=$1 AND knowledge_id=ANY($2::text[])", userId, ids)) as Row[]).map((row) => [String(row.knowledge_id), Number(row.saved_version || 0)]));
  const counts = new Map(((await postgresDb().many("SELECT knowledge_id,COUNT(*) AS cite_count FROM knowledge_citations WHERE knowledge_id=ANY($1::text[]) GROUP BY knowledge_id", ids)) as Row[]).map((row) => [String(row.knowledge_id), Number(row.cite_count || 0)]));
  return (await Promise.all((await Promise.all((await Promise.all(rows.map(async (row) => {
    const dep = deprecated.get(String(row.id));
    return (await publicKnowledge({
      ...row,
      viewer_cited: cited.has(String(row.id)) ? 1 : 0,
      // 无隐藏记录时必须留 undefined：publicKnowledge 以 `viewer_deprecate_reason == null`
      // 判断「是否已批量查询过」；传空串会被当成「有隐藏记录（原因为空）」，每行都显示已隐藏。
      viewer_deprecate_reason: dep ? String(dep.reason || "") : undefined,
      viewer_deprecate_note: dep ? String(dep.reason_note || "") : undefined,
      viewer_deprecated_at: dep ? String(dep.deprecated_at || "") : undefined,
      viewer_feedback_handled_at: dep ? String(dep.handled_at || "") : undefined,
      viewer_feedback_handle_action: dep ? String(dep.handle_action || "") : undefined,
      viewer_favorite_version: favorites.get(String(row.id)) || 0,
      cite_count: counts.get(String(row.id)) || 0,
    }, userId));
  })))))));
}
export async function listPublishedForOps(opts: KnowledgeListOpts = {}): Promise<Json[]> {
  const filters = (await knowledgeListFilters(opts));
  const rows = (await listed(filters.sql, filters.args, filters.filter, true));
  const offset = Math.max(0, Number(opts.offset || 0) || 0);
  const limit = Math.max(0, Number(opts.limit == null ? 0 : opts.limit) || 0);
  if (!limit && !offset)
    return rows;
  return limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
}
export async function listMarket(): Promise<Json[]> {
  const filters = (await knowledgeListFilters({ inMarket: true }));
  return (await listed(filters.sql, filters.args, filters.filter, true));
}
export async function brandMatched(row: Row, brands?: string[]): Promise<boolean> {
  brands ??= await actorBrands();
  const brand = String(row.brand || "*");
  if (!brand || brand === "*")
    return true;
  if (!brands.length && authDisabled())
    return true;
  return brands.includes(brand);
}
export async function composerItems(userId?: string, brands?: string[]): Promise<Json[]> {
  userId ??= await knowledgeActorId();
  brands ??= await actorBrands();
  const rows = (await postgresDb().many(`SELECT k.* FROM knowledge k
        JOIN knowledge_citations c ON c.knowledge_id=k.id AND c.user_id=$1
       WHERE k.status='published' AND k.kind='mail_template'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_deprecations d
            WHERE d.knowledge_id=k.id AND d.user_id=$2
         )
       ORDER BY k.title`, userId, userId)) as Row[];
  const viewer = (await viewerHandle(userId));
  const visibleRows = (await Promise.all(rows.map(async (row) => ((await brandMatched(row, brands)) && (await canSeeKnowledge(row, viewer))) ? row : undefined)))
    .filter((row): row is Row => row !== undefined);
  return (await Promise.all(visibleRows.map(async (row) => {
    try {
      (await assertMailTemplateSnapshotApplicable({ knowledgeId: String(row.id), version: Number(row.published_version || 0), userId, brands }));
      const snapshot = (await publishedSnapshot(row));
      const published = { ...row, ...snapshot, id: row.id, current_version: snapshot.version };
      return [{ ...(await publicKnowledge(published, userId)), intent: snapshot.skill_id, starter: composerStarter(snapshot) }];
    }
    catch (error) {
      if (error instanceof HttpFail)
        return [];
      throw error;
    }
  }))).flat();
}
export function composerStarter(row: Row): string {
  const title = String(row.title || "");
  const placeholders = parseJsonArray(row.placeholders);
  if (!placeholders.length)
    return title;
  return `${title} ${placeholders.map((p) => (p.startsWith("[") ? p : `[${p}]`)).join(" ")}`;
}
function questionTemplateSlot(row: Row): QuestionTemplateSlot | null {
  const tags = String(row.tags || "")
    .split(",")
    .map((tag) => tag.trim());
  for (const tag of tags) {
    if (!tag.startsWith(QUESTION_TEMPLATE_TAG_PREFIX))
      continue;
    const slot = tag.slice(QUESTION_TEMPLATE_TAG_PREFIX.length) as QuestionTemplateSlot;
    if ((QUESTION_TEMPLATE_SLOTS as readonly string[]).includes(slot))
      return slot;
  }
  return null;
}
/**
 * 公海工作台四个动作的问题模板。与 composerItems() 同一套治理：
 * 已发布 + 未被本人隐藏 + 品牌与范围可见。缺槽位或未发布的模板不出现，
 * 前端据此禁用入口而不是回落到写死的问题文案（CONST-10）。
 */
export async function questionTemplates(userId?: string, brands?: string[]): Promise<Json[]> {
  userId ??= await knowledgeActorId();
  brands ??= await actorBrands();
  const rows = (await postgresDb().many(`SELECT k.* FROM knowledge k
       WHERE k.status='published' AND k.kind='question_template'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_deprecations d
            WHERE d.knowledge_id=k.id AND d.user_id=$1
         )
       ORDER BY k.title`, userId)) as Row[];
  const viewer = (await viewerHandle(userId));
  const visibleRows = (await Promise.all(rows.map(async (row) => ((await brandMatched(row, brands)) && (await canSeeKnowledge(row, viewer))) ? row : undefined)))
    .filter((row): row is Row => row !== undefined);
  return (await Promise.all(visibleRows.map(async (row) => {
    const slot = questionTemplateSlot(row);
    if (!slot) {
      (await audit("system", "knowledge.question_template.bad_slot", { knowledge_id: String(row.id) }));
      return [];
    }
    try {
      const snapshot = (await publishedSnapshot(row));
      return [{
          slot,
          knowledge_id: String(row.id),
          published_version: Number(snapshot.version),
          title: String(snapshot.title || ""),
          body: String(snapshot.body || ""),
          placeholders: parseJsonArray(snapshot.placeholders),
          starter: composerStarter(snapshot),
        }];
    }
    catch (error) {
      if (error instanceof HttpFail)
        return [];
      throw error;
    }
  }))).flat();
}
export async function cite(knowledgeId: string, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  const row = (await knowledgeRow(knowledgeId));
  if (String(row.status) !== "published")
    throw new HttpFail(403, "未发布知识不能启用");
  (await pgTransaction(async (db) => {
    (await db.execute("INSERT INTO knowledge_citations (user_id,knowledge_id,cited_at) VALUES ($1,$2,$3) ON CONFLICT (user_id,knowledge_id) DO UPDATE SET cited_at=EXCLUDED.cited_at", userId, knowledgeId, nowIso()));
  }));
  (await audit(userId, "knowledge.cite", { knowledge_id: knowledgeId, version: row.current_version }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
export async function uncite(knowledgeId: string, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  (await knowledgeRow(knowledgeId));
  (await pgTransaction(async (db) => {
    (await db.execute("DELETE FROM knowledge_citations WHERE user_id=$1 AND knowledge_id=$2", userId, knowledgeId));
  }));
  (await audit(userId, "knowledge.uncite", { knowledge_id: knowledgeId }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
/** 收藏是账号级数据；保存当前已发布版本，用来提示后续发布的新版本。 */
export async function favorite(knowledgeId: string, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  const row = (await knowledgeRow(knowledgeId));
  if (String(row.status) !== "published")
    throw new HttpFail(403, "未发布知识不能收藏");
  const version = Number(row.published_version || row.current_version || 1);
  const stamp = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute("INSERT INTO knowledge_favorites (user_id,knowledge_id,saved_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,knowledge_id) DO UPDATE SET saved_version=EXCLUDED.saved_version,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at", userId, knowledgeId, version, stamp, stamp));
  }));
  (await audit(userId, "knowledge.favorite", { knowledge_id: knowledgeId, version }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
export async function unfavorite(knowledgeId: string, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  (await knowledgeRow(knowledgeId));
  (await pgTransaction(async (db) => {
    (await db.execute("DELETE FROM knowledge_favorites WHERE user_id=$1 AND knowledge_id=$2", userId, knowledgeId));
  }));
  (await audit(userId, "knowledge.unfavorite", { knowledge_id: knowledgeId }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
export async function deprecate(knowledgeId: string, reason: string, note = "", userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  (await knowledgeRow(knowledgeId));
  reason = mapDeprecateReason(reason);
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_deprecations
       (user_id,knowledge_id,reason,reason_note,deprecated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,knowledge_id) DO UPDATE SET reason=EXCLUDED.reason,reason_note=EXCLUDED.reason_note,deprecated_at=EXCLUDED.deprecated_at`, userId, knowledgeId, reason, note, nowIso()));
  }));
  (await audit(userId, "knowledge.deprecate", { knowledge_id: knowledgeId, reason }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
export async function undeprecate(knowledgeId: string, userId?: string): Promise<Json> {
  userId ??= await knowledgeActorId();
  (await knowledgeRow(knowledgeId));
  (await pgTransaction(async (db) => {
    (await db.execute("DELETE FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=$2", userId, knowledgeId));
  }));
  (await audit(userId, "knowledge.undeprecate", { knowledge_id: knowledgeId }));
  return (await publicKnowledge((await knowledgeRow(knowledgeId)), userId));
}
/** 员工侧「可见的已发布条目」：与 listPublishedForOps 同口径（发布 + 有效已发布版本 + 授权/品牌）。 */
async function employeeVisible(row: Row): Promise<boolean> {
  if (String(row.status) !== "published")
    return false;
  try {
    (await publishedSnapshot(row));
  }
  catch (error) {
    if (error instanceof HttpFail)
      return false;
    throw error;
  }
  return (await canSeeKnowledge(row)) && (await brandMatched(row));
}
/**
 * 版本历史是治理视图：管理侧身份（真实会话 roles 含 admin；演示模式按 persona，与前端 viewMode 同口径）
 * 可读任意状态；员工只能读「已发布且对自己可见」的条目，其余按详情路由的 404 口径拒绝。
 */
async function canReadVersionHistory(row: Row): Promise<boolean> {
  if (isAdmin())
    return true;
  if (authDisabled() && (await personaAccess()).roles.includes("admin"))
    return true;
  return (await employeeVisible(row));
}
export async function listVersions(knowledgeId: string): Promise<Json[]> {
  const row = (await knowledgeRow(knowledgeId));
  if (!(await canReadVersionHistory(row)))
    throw new HttpFail(404, "知识不存在或不可访问");
  return (await postgresDb().many("SELECT * FROM knowledge_versions WHERE knowledge_id=$1 ORDER BY version", knowledgeId)) as Json[];
}
function normalizeKind(value: unknown): KnowledgeKind {
  const kind = String(value || "policy") as KnowledgeKind;
  if (!KNOWLEDGE_KINDS.includes(kind))
    throw new HttpFail(400, `kind 须为 ${KNOWLEDGE_KIND_HINT}`);
  return kind;
}
function normalizeStatus(value: unknown, fallback: KnowledgeStatus): KnowledgeStatus {
  const status = String(value || fallback) as KnowledgeStatus;
  if (!KNOWLEDGE_STATUSES.includes(status))
    throw new HttpFail(400, "非法知识状态");
  return status;
}
export type KnowledgeAdminListOpts = KnowledgeListOpts & {
  status?: string | null;
};
export async function adminList(opts: KnowledgeAdminListOpts = {}): Promise<Json[]> {
  (await requireAdmin());
  const args: unknown[] = [];
  const clauses = knowledgeWhereClauses(opts, args);
  const status = String(opts.status || "").trim();
  if (status) {
    args.push(status);
    clauses.push(`k.status=$${args.length}`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await listed(`SELECT ${KNOWLEDGE_LIST_COLUMNS} FROM knowledge k ${TAXONOMY_JOIN}${where} ORDER BY k.status, k.kind, k.title`, args));
  const offset = Math.max(0, Number(opts.offset || 0) || 0);
  const limit = Math.max(0, Number(opts.limit == null ? 0 : opts.limit) || 0);
  if (!limit && !offset)
    return rows;
  return limit ? rows.slice(offset, offset + limit) : rows.slice(offset);
}
export async function reviewQueue(): Promise<Json[]> {
  (await requireAdmin());
  return (await listed("SELECT * FROM knowledge WHERE status='pending_review' ORDER BY updated_at DESC", []));
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
  base_id?: string;
  structured?: unknown;
  source_body?: string;
  effective_at?: string;
  expires_at?: string;
};
function placeholdersJson(value: unknown): string {
  return JSON.stringify(parseJsonArray(value));
}
export async function createKnowledge(input: UpsertInput, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const title = String(input.title || "").trim();
  if (!title)
    throw new HttpFail(400, "title required");
  const id = String(input.id || nid("kb"));
  if ((await postgresDb().one("SELECT 1 FROM knowledge WHERE id=$1", id)))
    throw new HttpFail(409, "knowledge id exists");
  const now = nowIso();
  const kind = normalizeKind(input.kind);
  const base = (await requireWritableBase(input.base_id, kind));
  const body = String(input.body || "");
  const row: Row = {
    id,
    title,
    body,
    tags: String(input.tags || ""),
    in_market: input.in_market == null ? 1 : Number(input.in_market),
    kind,
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
    base_id: String(base.id),
    // 原稿不可变：新建时默认取当前正文（WeKnora source_content 语义），此后编辑只改 body。
    source_body: input.source_body == null ? body : String(input.source_body),
    structured: structuredJson(kind, input.structured),
    effective_at: input.effective_at == null ? null : String(input.effective_at),
    expires_at: input.expires_at == null ? null : String(input.expires_at),
    created_at: now,
    updated_at: now,
  };
  if (row.status === "published") {
    row.approved_by = actor;
    row.approved_at = now;
  }
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge
       (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,published_version,created_by,approved_by,approved_at,base_id,source_body,structured,effective_at,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`, row.id, row.title, row.body, row.tags, row.in_market, row.kind, row.skill_id, row.brand, row.lang, row.subject, row.body_en, row.placeholders, row.stage_codes, row.status, row.current_version, row.published_version, row.created_by, row.approved_by, row.approved_at, row.base_id, row.source_body, row.structured, row.effective_at, row.expires_at, row.created_at, row.updated_at));
    (await writeVersion(db, row, "create", actor));
  }));
  (await audit(actor, "knowledge.create", { knowledge_id: id, status: row.status, base_id: row.base_id }));
  return (await publicKnowledge((await knowledgeRow(id)), actor));
}
export async function editKnowledge(id: string, input: Partial<UpsertInput>, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const prev = (await knowledgeRow(id));
  const now = nowIso();
  const kind = input.kind == null ? String(prev.kind || "policy") : normalizeKind(input.kind);
  if (input.base_id == null) {
    // 未搬家：只要求现有库（若有）仍允许这个 kind；历史行无库时不阻塞编辑。
    const currentBaseId = String(prev.base_id || "");
    if (currentBaseId)
      assertKindAllowedInBase(kind, (await baseKindOf(currentBaseId)));
  }
  else {
    (await requireWritableBase(input.base_id, kind));
  }
  let structured: string | null;
  if (input.structured === undefined) {
    structured = prev.structured == null ? null : String(prev.structured);
    if (structured && input.kind != null) {
      const errors = validateStructuredFields(kind, parseStructured(structured));
      if (errors.length)
        throw new HttpFail(400, { code: "knowledge_structured_invalid", errors });
    }
  }
  else {
    structured = structuredJson(kind, input.structured);
  }
  const next: Row = {
    ...prev,
    title: String(input.title ?? prev.title).trim() || prev.title,
    body: input.body == null ? prev.body : String(input.body),
    tags: input.tags == null ? prev.tags : String(input.tags),
    in_market: input.in_market == null ? prev.in_market : Number(input.in_market),
    kind,
    skill_id: input.skill_id == null ? prev.skill_id : String(input.skill_id),
    brand: input.brand == null ? prev.brand : (String(input.brand) || "*"),
    lang: input.lang == null ? prev.lang : String(input.lang),
    subject: input.subject == null ? prev.subject : String(input.subject),
    body_en: input.body_en == null ? prev.body_en : String(input.body_en),
    placeholders: input.placeholders == null ? prev.placeholders : placeholdersJson(input.placeholders),
    stage_codes: input.stage_codes == null ? prev.stage_codes : placeholdersJson(input.stage_codes),
    base_id: input.base_id == null ? prev.base_id : String(input.base_id),
    structured,
    effective_at: input.effective_at == null ? prev.effective_at : String(input.effective_at),
    expires_at: input.expires_at == null ? prev.expires_at : String(input.expires_at),
    current_version: Number(prev.current_version || 1) + 1,
    updated_at: now,
  };
  (await pgTransaction(async (db) => {
    (await db.execute(`UPDATE knowledge SET title=$1,body=$2,tags=$3,in_market=$4,kind=$5,skill_id=$6,brand=$7,lang=$8,subject=$9,body_en=$10,placeholders=$11,stage_codes=$12,base_id=$13,structured=$14,effective_at=$15,expires_at=$16,current_version=$17,updated_at=$18
        WHERE id=$19`, next.title, next.body, next.tags, next.in_market, next.kind, next.skill_id, next.brand, next.lang, next.subject, next.body_en, next.placeholders, next.stage_codes, next.base_id, next.structured, next.effective_at, next.expires_at, next.current_version, next.updated_at, id));
    (await writeVersion(db, next, "edit", actor));
  }));
  (await audit(actor, "knowledge.edit", { knowledge_id: id, version: next.current_version, base_id: next.base_id }));
  return (await publicKnowledge((await knowledgeRow(id)), actor));
}
export async function approveKnowledge(id: string, expectedVersion: number | null = null, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const row = (await knowledgeRow(id));
  if (String(row.status) === "archived")
    throw new HttpFail(400, "已归档知识不能直接发布");
  if (expectedVersion == null || !Number.isFinite(Number(expectedVersion))) {
    throw new HttpFail(400, "expected_version required");
  }
  if (Number(expectedVersion) !== Number(row.current_version || 1)) {
    throw new HttpFail(409, { code: "knowledge_version_conflict", message: "内容已变，请刷新后重新审核" });
  }
  const now = nowIso();
  const version = Number(row.current_version || 1);
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE knowledge SET status='published',published_version=$1,approved_by=$2,approved_at=$3,updated_at=$4 WHERE id=$5", version, actor, now, now, id));
    const published = { ...row, status: "published", approved_by: actor, approved_at: now, current_version: version };
    (await writeVersion(db, published, "approve", actor));
  }));
  (await audit(actor, "knowledge.approve", { knowledge_id: id, version }));
  return (await publicKnowledge((await knowledgeRow(id)), actor));
}
export async function archiveKnowledge(id: string, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  (await knowledgeRow(id));
  const now = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE knowledge SET status='archived',updated_at=$1 WHERE id=$2", now, id));
    const row = (await db.one("SELECT * FROM knowledge WHERE id=$1", id)) as Row;
    (await writeVersion(db, row, "archive", actor));
  }));
  (await audit(actor, "knowledge.archive", { knowledge_id: id }));
  return (await publicKnowledge((await knowledgeRow(id)), actor));
}
export async function sentMailCitesKnowledge(knowledgeId: string): Promise<boolean> {
  const rows = (await postgresDb().many("SELECT extra FROM drafts WHERE status='sent'")) as {
    extra: string;
  }[];
  return rows.some((row) => {
    try {
      const extra = JSON.parse(String(row.extra || "{}")) as Json;
      return String(extra.knowledge_id || "") === knowledgeId;
    }
    catch {
      return false;
    }
  });
}
export async function hardDeleteKnowledge(id: string, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const row = (await knowledgeRow(id));
  if (String(row.status) === "published" || String(row.status) === "archived") {
    throw new HttpFail(403, "已发布或归档知识只能归档，不能物理删除");
  }
  if (String(row.status) !== "draft")
    throw new HttpFail(403, "仅未发布草稿可物理删除");
  if ((await sentMailCitesKnowledge(id)))
    throw new HttpFail(403, "已被已发送邮件引用的知识不能物理删除");
  (await pgTransaction(async (db) => {
    (await db.execute("DELETE FROM knowledge_versions WHERE knowledge_id=$1", id));
    (await db.execute("DELETE FROM knowledge_citations WHERE knowledge_id=$1", id));
    (await db.execute("DELETE FROM knowledge_favorites WHERE knowledge_id=$1", id));
    (await db.execute("DELETE FROM knowledge_deprecations WHERE knowledge_id=$1", id));
    (await db.execute("DELETE FROM knowledge WHERE id=$1", id));
  }));
  (await audit(actor, "knowledge.hard_delete", { knowledge_id: id }));
  return { ok: true, id };
}
export async function ingestRaw(input: {
  source: "upload" | "failed_session";
  filename?: string;
  content_type?: string;
  body?: string;
  path?: string | null;
  uploaded_by?: string;
  session_id?: string | null;
  task_id?: string | null;
  meta?: Json;
}): Promise<Row> {
  const id = nid("kraw");
  const now = nowIso();
  const row = {
    id,
    source: input.source,
    filename: String(input.filename || ""),
    content_type: String(input.content_type || "text/plain"),
    body: String(input.body || ""),
    path: input.path || null,
    uploaded_by: input.uploaded_by || (await knowledgeActorId()),
    created_at: now,
    session_id: input.session_id || null,
    task_id: input.task_id || null,
    meta: JSON.stringify(input.meta || {}),
  };
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_raw
       (id,source,filename,content_type,body,path,uploaded_by,created_at,session_id,task_id,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, row.id, row.source, row.filename, row.content_type, row.body, row.path, row.uploaded_by, row.created_at, row.session_id, row.task_id, row.meta));
  }));
  return row;
}
export async function recordFailedSession(meta: Json, sessionId?: string | null, body = ""): Promise<Row> {
  return (await ingestRaw({
    source: "failed_session",
    filename: String(meta.reason || meta.code || "failed_session"),
    content_type: "application/json",
    body: body || JSON.stringify(meta),
    uploaded_by: "system",
    session_id: sessionId || null,
    meta,
  }));
}
export async function listRaw(): Promise<Json[]> {
  (await requireAdmin());
  return (await postgresDb().many("SELECT * FROM knowledge_raw ORDER BY created_at DESC")) as Json[];
}
export async function listExtractJobs(): Promise<Json[]> {
  (await requireAdmin());
  return (await postgresDb().many("SELECT * FROM knowledge_extract_jobs ORDER BY created_at DESC")) as Json[];
}
export async function deprecateStats(): Promise<Json> {
  (await requireAdmin());
  const rows = (await postgresDb().many(`SELECT reason, COUNT(*) AS c FROM knowledge_deprecations GROUP BY reason`)) as {
    reason: string;
    c: number;
  }[];
  const by_reason = Object.fromEntries((Object.keys(DEPRECATE_REASONS) as DeprecateReason[]).map((key) => [
    key,
    { label: DEPRECATE_REASONS[key], count: 0 },
  ])) as Record<string, {
    label: string;
    count: number;
  }>;
  for (const row of rows) {
    if (!by_reason[row.reason])
      by_reason[row.reason] = { label: row.reason, count: 0 };
    by_reason[row.reason].count = Number(row.c);
  }
  return { by_reason, total: rows.reduce((sum, row) => sum + Number(row.c), 0) };
}
function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 8000 }).toString();
  }
  catch {
    return null;
  }
}
function extractPdfText(filePath: string, buf: Buffer): string {
  const fromTool = tryExec("pdftotext", ["-layout", "-nopgbrk", filePath, "-"]);
  if (fromTool?.trim())
    return fromTool;
  const latin = buf.toString("latin1");
  const chunks = [...latin.matchAll(/\(([^)]{4,})\)/g)].map((m) => m[1]).join("\n");
  return chunks.slice(0, 8000);
}
function extractDocxText(filePath: string): string {
  const fromTool = tryExec("unzip", ["-p", filePath, "word/document.xml"]);
  if (!fromTool)
    return "";
  return fromTool.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
}
function parseEml(text: string): {
  title: string;
  body: string;
  subject: string;
  body_en: string;
} {
  const subject = text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || "未命名来信";
  const split = text.split(/\r?\n\r?\n/);
  const body = split.slice(1).join("\n\n").trim() || text;
  return { title: subject, body, subject, body_en: body };
}
export function extractTextFromUpload(filename: string, mime: string, buf: Buffer, filePath: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".md" || ext === ".txt" || mime.startsWith("text/"))
    return buf.toString("utf8");
  if (ext === ".eml" || mime === "message/rfc822")
    return buf.toString("utf8");
  if (ext === ".pdf" || mime === "application/pdf")
    return extractPdfText(filePath, buf);
  if (ext === ".docx" || mime.includes("wordprocessingml"))
    return extractDocxText(filePath);
  if (!buf.includes(0))
    return buf.toString("utf8");
  return "";
}
export async function storeUploadRaw(file: {
  name: string;
  type: string;
  buf: Buffer;
}, actor?: string): Promise<Row> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const original = file.name || "upload.bin";
  const safe = original.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "upload.bin";
  const ext = path.extname(safe).toLowerCase();
  const allowed = new Set([".md", ".txt", ".eml", ".pdf", ".docx"]);
  if (!allowed.has(ext))
    throw new HttpFail(400, "仅支持 md / txt / eml / pdf / docx");
  const dir = path.join(dataDir(), "uploads", "knowledge-raw");
  fs.mkdirSync(dir, { recursive: true });
  const uploadId = nid("katt");
  const dest = path.join(dir, `${uploadId}_${safe}`);
  fs.writeFileSync(dest, file.buf);
  const body = extractTextFromUpload(safe, file.type, file.buf, dest);
  return (await ingestRaw({
    source: "upload",
    filename: safe,
    content_type: file.type || "application/octet-stream",
    body,
    path: dest,
    uploaded_by: actor,
    meta: { ext, bytes: file.buf.length },
  }));
}
async function maintainerPendingFromRaw(raw: Row, actor: string): Promise<Json> {
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
  }
  else if (ext === ".md" || ext === ".txt") {
    const heading = text.match(/^#\s+(.+)$/m);
    if (heading)
      title = heading[1].trim();
    if (/^Subject:/im.test(text)) {
      kind = "mail_template";
      subject = text.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || title;
      bodyEn = text;
    }
  }
  else if (ext === ".pdf" || ext === ".docx") {
    kind = "pattern";
  }
  return (await createKnowledge({
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
    // 抽取候选先落默认结构化库，管理员审核时可搬到目标库。
    base_id: (await defaultStructuredBaseId()),
  }, actor));
}
export async function extractFromRaw(rawId: string, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const raw = (await postgresDb().one("SELECT * FROM knowledge_raw WHERE id=$1", rawId)) as Row | undefined;
  if (!raw)
    throw new HttpFail(404, "raw not found");
  const jobId = nid("kjob");
  const now = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_extract_jobs
       (id,raw_id,status,result_knowledge_id,error,created_by,created_at,finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, jobId, rawId, "queued", null, null, actor, now, null));
  }));
  try {
    const page = (await maintainerPendingFromRaw(raw, actor));
    const finished = nowIso();
    (await pgTransaction(async (db) => {
      (await db.execute("UPDATE knowledge_extract_jobs SET status='done',result_knowledge_id=$1,finished_at=$2 WHERE id=$3", page.id, finished, jobId));
    }));
    (await audit(actor, "knowledge.extract", { raw_id: rawId, knowledge_id: page.id, job_id: jobId }));
    return { job_id: jobId, status: "done", knowledge: page };
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (await pgTransaction(async (db) => {
      (await db.execute("UPDATE knowledge_extract_jobs SET status='failed',error=$1,finished_at=$2 WHERE id=$3", message, nowIso(), jobId));
    }));
    throw error;
  }
}
export async function listProposals(): Promise<Json[]> {
  (await requireAdmin());
  return (await postgresDb().many("SELECT * FROM knowledge_proposals ORDER BY created_at DESC")) as Json[];
}
export async function proposeEvolve(input: {
  kind?: string;
  skill_id?: string;
  knowledge_id?: string;
  from_brand?: string;
  to_brand?: string;
  proposed_diff?: string;
}, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const kind = String(input.kind || "skill_patch");
  if (!["skill_patch", "template_patch", "brand_transfer"].includes(kind)) {
    throw new HttpFail(400, "proposal kind 须为 skill_patch / template_patch / brand_transfer");
  }
  if (kind === "brand_transfer") {
    const to = String(input.to_brand || "");
    if (!BRAND_MAILBOXES[to])
      throw new HttpFail(400, "跨品牌转移必须通过品牌 From 白名单");
  }
  const id = nid("kprop");
  const now = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute(`INSERT INTO knowledge_proposals
       (id,kind,skill_id,knowledge_id,from_brand,to_brand,proposed_diff,status,profile,created_by,created_at,reviewed_by,reviewed_at,reject_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','shadow',$8,$9,NULL,NULL,NULL)`, id, kind, String(input.skill_id || ""), String(input.knowledge_id || ""), String(input.from_brand || ""), String(input.to_brand || ""), String(input.proposed_diff || ""), actor, now));
  }));
  (await audit(actor, "knowledge.evolve.propose", { proposal_id: id, kind, profile: "shadow", wrote_skill_md: false }));
  return (await postgresDb().one("SELECT * FROM knowledge_proposals WHERE id=$1", id)) as Json;
}
function assertSkillMdUntouched(): void {
  /* WikiSkill evolve never writes production SKILL.md. Review only records the decision. */
}
export async function reviewProposal(id: string, action: "approve" | "reject", rejectReason = "", actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const row = (await postgresDb().one("SELECT * FROM knowledge_proposals WHERE id=$1", id)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "proposal not found");
  if (String(row.status) !== "pending")
    throw new HttpFail(409, "proposal already reviewed");
  assertSkillMdUntouched();
  const now = nowIso();
  if (action === "reject") {
    (await pgTransaction(async (db) => {
      (await db.execute("UPDATE knowledge_proposals SET status='rejected',reviewed_by=$1,reviewed_at=$2,reject_reason=$3 WHERE id=$4", actor, now, rejectReason || "rejected", id));
    }));
    (await audit(actor, "knowledge.evolve.reject", { proposal_id: id, wrote_skill_md: false }));
    return (await postgresDb().one("SELECT * FROM knowledge_proposals WHERE id=$1", id)) as Json;
  }
  if (String(row.kind) === "brand_transfer") {
    const to = String(row.to_brand || "");
    if (!BRAND_MAILBOXES[to])
      throw new HttpFail(400, "跨品牌转移必须通过品牌 From 白名单");
    const sourceId = String(row.knowledge_id || "");
    if (sourceId) {
      const src = (await knowledgeRow(sourceId));
      (await createKnowledge({
        title: `${src.title} · ${to}`,
        body: String(src.body || ""),
        kind: String(src.kind || "mail_template"),
        // 跨品牌副本继承源条目的库；源库缺失时落默认结构化库（新建必填 base_id）。
        base_id: String(src.base_id || "") || (await defaultStructuredBaseId()),
        skill_id: String(src.skill_id || ""),
        brand: to,
        lang: String(src.lang || "en"),
        subject: String(src.subject || ""),
        body_en: String(src.body_en || ""),
        placeholders: src.placeholders,
        stage_codes: src.stage_codes,
        tags: String(src.tags || ""),
        status: "pending_review",
      }, actor));
    }
  }
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE knowledge_proposals SET status='approved',reviewed_by=$1,reviewed_at=$2 WHERE id=$3", actor, now, id));
  }));
  (await audit(actor, "knowledge.evolve.approve", { proposal_id: id, profile: "shadow", wrote_skill_md: false }));
  return (await postgresDb().one("SELECT * FROM knowledge_proposals WHERE id=$1", id)) as Json;
}
export async function transferBrand(knowledgeId: string, toBrand: string, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  return (await proposeEvolve({
    kind: "brand_transfer",
    knowledge_id: knowledgeId,
    to_brand: toBrand,
    proposed_diff: `transfer brand From whitelist → ${toBrand} ${BRAND_MAILBOXES[toBrand] || ""}`,
  }, actor));
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
async function publishedSnapshot(row: Row, version?: number | null): Promise<Row> {
  const requested = version == null ? Number(row.published_version || 0) : Number(version);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new HttpFail(403, { code: "knowledge_publish_pending", message: "知识没有可用的已发布版本" });
  }
  const snapshot = (await postgresDb().one(`SELECT * FROM knowledge_versions
      WHERE knowledge_id=$1 AND version=$2
        AND status='published'
        AND (note='approve' OR note='create' OR note LIKE 'seed %')`, row.id, requested)) as Row | undefined;
  if (!snapshot) {
    throw new HttpFail(403, { code: "knowledge_publish_pending", message: "知识没有可用的已发布版本" });
  }
  return snapshot;
}
async function effectivePublishedRow(row: Row): Promise<Row> {
  const snapshot = (await publishedSnapshot(row));
  return { ...row, ...Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v != null)), id: row.id, current_version: snapshot.version };
}
async function effectivePublishedRows(rows: Row[]): Promise<Row[]> {
  return (await Promise.all((await Promise.all(rows.map(async (row) => {
    try {
      return [(await effectivePublishedRow(row))];
    }
    catch (e) {
      if (e instanceof HttpFail)
        return [];
      throw e;
    }
  }))))).flat();
}
/** Employee detail always resolves the effective snapshot, including while a newer draft exists. */
export async function employeeKnowledge(row: Row): Promise<Json> {
  if (row.status !== "published")
    throw new HttpFail(403, "未发布知识不可使用");
  const effective = (await effectivePublishedRow(row));
  if (!(await canSeeKnowledge(effective)) || !(await brandMatched(effective)))
    throw new HttpFail(404, "知识不存在或不可访问");
  return (await publicKnowledge(effective));
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
export async function assertMailTemplateSnapshotApplicable(opts: {
  knowledgeId: string;
  version: number;
  skillId?: string | null;
  stageCode?: string | null;
  brand?: string | null;
  userId?: string;
  brands?: string[];
}): Promise<UsableTemplate> {
  const userId = opts.userId || (await knowledgeActorId());
  const brands = opts.brands || (await actorBrands());
  const row = (await postgresDb().one("SELECT * FROM knowledge WHERE id=$1", opts.knowledgeId)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, { code: "knowledge_missing", message: "知识不存在" });
  if (String(row.status) !== "published") {
    throw new HttpFail(403, { code: "knowledge_unapproved", message: "未审批或已归档知识不能进入会话或发送" });
  }
  if (Number(row.in_market) !== 1) {
    throw new HttpFail(403, { code: "knowledge_disabled", message: "已停用知识不能进入会话或发送" });
  }
  const cited = (await postgresDb().one("SELECT 1 FROM knowledge_citations WHERE user_id=$1 AND knowledge_id=$2", userId, opts.knowledgeId));
  if (!cited)
    throw new HttpFail(403, { code: "knowledge_uncited", message: "未启用知识不能进入会话或发送" });
  const dep = (await postgresDb().one("SELECT 1 FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=$2", userId, opts.knowledgeId));
  if (dep)
    throw new HttpFail(403, { code: "knowledge_deprecated", message: "已隐藏知识不能进入会话或发送" });
  const template = templateFromSnapshot(row, (await publishedSnapshot(row, opts.version)));
  if (template.kind !== "mail_template") {
    throw new HttpFail(403, { code: "knowledge_kind", message: "知识不是邮件模板" });
  }
  if (opts.skillId && template.skill_id !== String(opts.skillId)) {
    throw new HttpFail(403, { code: "knowledge_skill", message: "知识模板不适用于当前技能" });
  }
  if (!(await brandMatched({ brand: template.brand }, brands))) {
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
export async function assertUsableKnowledge(knowledgeId: string, userId?: string, brands?: string[]): Promise<UsableTemplate> {
  userId ??= await knowledgeActorId();
  brands ??= await actorBrands();
  const row = (await postgresDb().one("SELECT * FROM knowledge WHERE id=$1", knowledgeId)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, { code: "knowledge_missing", message: "知识不存在" });
  if (String(row.status) !== "published") {
    throw new HttpFail(403, { code: "knowledge_unapproved", message: "未审批知识不能进入会话或 Worker" });
  }
  if (Number(row.in_market) !== 1) {
    throw new HttpFail(403, { code: "knowledge_disabled", message: "已停用知识不能进入会话或 Worker" });
  }
  const cited = (await postgresDb().one("SELECT 1 FROM knowledge_citations WHERE user_id=$1 AND knowledge_id=$2", userId, knowledgeId));
  if (!cited)
    throw new HttpFail(403, { code: "knowledge_uncited", message: "未启用知识不能进入会话" });
  const dep = (await postgresDb().one("SELECT 1 FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=$2", userId, knowledgeId));
  if (dep)
    throw new HttpFail(403, { code: "knowledge_deprecated", message: "已隐藏知识不能进入会话" });
  if (!(await brandMatched(row, brands))) {
    throw new HttpFail(403, { code: "knowledge_brand", message: "知识品牌与当前账号不匹配" });
  }
  // 注入闸门：按键取用的受控条目只允许来自结构化库（非结构化库走检索通道，本批未实现）。
  if ((await baseKindOf(row.base_id)) !== "structured") {
    throw new HttpFail(403, { code: "knowledge_wrong_base_type", message: "只有结构化知识库的条目可以进入会话或 Worker" });
  }
  return templateFromSnapshot(row, (await publishedSnapshot(row)));
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
export async function resolveMailTemplate(opts: {
  knowledgeId?: string | null;
  stageCode?: string | null;
  skillId?: string | null;
  userId?: string;
  brands?: string[];
}): Promise<UsableTemplate | null> {
  const userId = opts.userId || (await knowledgeActorId());
  const brands = opts.brands || (await actorBrands());
  const knowledgeId = String(opts.knowledgeId || "").trim();
  if (knowledgeId)
    return (await assertUsableKnowledge(knowledgeId, userId, brands));
  const skill = String(opts.skillId || "email_compose");
  if (skill && skill !== "email_compose")
    return null;
  const stage = String(opts.stageCode || "").trim();
  const bound = (await resolveForSkill("email_compose", { userId, brands, stageCode: stage, record: true }));
  if (bound.resolved.length)
    return (await assertUsableKnowledge(bound.resolved[0].id, userId, brands));
  const rows = (await composerItems(userId, brands));
  if (!rows.length) {
    (await audit(userId, "knowledge.resolve", { skill_id: "email_compose", source: "legacy", resolved: [], skipped_count: 0 }));
    return null;
  }
  const staged = stage
    ? rows.filter((row) => {
      const codes = Array.isArray(row.stage_codes) ? row.stage_codes.map(String) : [];
      return !codes.length || codes.includes(stage);
    })
    : rows;
  const pick = staged[0];
  (await audit(userId, "knowledge.resolve", {
    skill_id: "email_compose",
    source: "legacy",
    resolved: pick ? [{ id: String(pick.id), version: Number(pick.current_version || 1) }] : [],
    skipped_count: Math.max(0, staged.length - (pick ? 1 : 0)),
  }));
  return pick ? (await assertUsableKnowledge(String(pick.id), userId, brands)) : null;
}
export async function resolveApplicableMailTemplates(opts: {
  knowledgeId?: string | null;
  stageCode?: string | null;
  brand?: string | null;
  skillId?: string | null;
  userId?: string;
  brands?: string[];
}): Promise<UsableTemplate[]> {
  const userId = opts.userId || (await knowledgeActorId());
  const brands = opts.brands || (await actorBrands());
  const skill = String(opts.skillId || "email_compose");
  if (skill !== "email_compose")
    return [];
  const stage = String(opts.stageCode || "").trim();
  const brand = String(opts.brand || "").trim();
  const requested = String(opts.knowledgeId || "").trim();
  const rows = requested
    ? [(await postgresDb().one("SELECT * FROM knowledge WHERE id=$1", requested)) as Row | undefined].filter(Boolean) as Row[]
    : (await postgresDb().many(`SELECT k.* FROM knowledge k
        JOIN knowledge_citations c ON c.knowledge_id=k.id AND c.user_id=$1
       WHERE k.status='published' AND k.kind='mail_template'
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_deprecations d
            WHERE d.knowledge_id=k.id AND d.user_id=$2
         )`, userId, userId)) as Row[];
  const templates: UsableTemplate[] = [];
  for (const row of rows) {
    try {
      const template = (await assertMailTemplateSnapshotApplicable({
        knowledgeId: String(row.id),
        version: Number(row.published_version || 0),
        skillId: skill,
        stageCode: stage || null,
        brand: brand || null,
        userId,
        brands,
      }));
      templates.push(template);
    }
    catch (error) {
      if (requested)
        throw error;
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
/** 同等适用的候选并列返回，由调用方或人来选；任何一方都不得从多个里取第一只。 */
export function preparedTemplateChoice(templates: UsableTemplate[], stage: string, brand: string): UsableTemplate[] {
  if (!templates.length)
    return [];
  const score = (template: UsableTemplate) => (template.brand === brand ? 0 : 2) + (template.stage_codes.includes(stage) ? 0 : 1);
  const best = Math.min(...templates.map(score));
  return templates.filter((template) => score(template) === best);
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
    if (!value)
      continue;
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
  /** 分类过滤，接受 id 或 code（join knowledge_bases / knowledge_domains，不先取全量）。 */
  base?: string | null;
  domain?: string | null;
  family?: string | null;
  limit?: number | null;
  offset?: number | null;
};
function likeEscaped(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
/** 检索与分类过滤的 SQL 子句（调用方负责套上 TAXONOMY_JOIN）。 */
function knowledgeWhereClauses(opts: KnowledgeListOpts, args: unknown[]): string[] {
  const clauses: string[] = [];
  const q = String(opts.q || "").trim();
  if (q) {
    const like = `%${likeEscaped(q)}%`;
    args.push(like, like, like, like, like);
    const first = args.length - 4;
    clauses.push(`(k.title LIKE $${first} ESCAPE '\\' OR k.body LIKE $${first + 1} ESCAPE '\\' OR k.tags LIKE $${first + 2} ESCAPE '\\' OR k.subject LIKE $${first + 3} ESCAPE '\\' OR k.body_en LIKE $${first + 4} ESCAPE '\\')`);
  }
  const kind = String(opts.kind || "").trim();
  if (kind) {
    args.push(kind);
    clauses.push(`k.kind=$${args.length}`);
  }
  const base = String(opts.base || "").trim();
  if (base) {
    args.push(base, base);
    clauses.push(`(b.id=$${args.length - 1} OR b.code=$${args.length})`);
  }
  const domain = String(opts.domain || "").trim();
  if (domain) {
    args.push(domain, domain);
    clauses.push(`(d.id=$${args.length - 1} OR d.code=$${args.length})`);
  }
  const family = String(opts.family || "").trim();
  if (family) {
    args.push(family, family);
    clauses.push(`(f.id=$${args.length - 1} OR f.code=$${args.length})`);
  }
  return clauses;
}
/** id → handle：演示目录优先，真实账号回退 username（mapUser 的 handle 即 username）。 */
async function viewerHandle(userId: string): Promise<string> {
  const me = (await currentUser());
  if (me.id === userId)
    return me.handle;
  const db = postgresDb();
  const dir = (await db.one("SELECT handle FROM directory_users WHERE id=$1", userId)) as {
    handle?: string;
  } | undefined;
  if (dir?.handle)
    return String(dir.handle);
  const user = (await db.one("SELECT username FROM users WHERE id=$1", userId)) as {
    username?: string;
  } | undefined;
  return String(user?.username || userId);
}
/** 列表过滤：范围/授权先于取数；阶段与品牌只收窄，不过滤无授权行的已发布知识。 */
async function knowledgeListFilters(opts: KnowledgeListOpts & {
  inMarket?: boolean;
} = {}): Promise<{
  sql: string;
  args: unknown[];
  filter: (row: Row) => Promise<boolean>;
}> {
  const args: unknown[] = [];
  const clauses = ["k.status='published'"];
  if (opts.inMarket)
    clauses.push("k.in_market=1");
  clauses.push(...knowledgeWhereClauses(opts, args));
  const stage = String(opts.stage || "").trim();
  const brand = String(opts.brand || "").trim();
  const handle = (await currentUser()).handle;
  const filter = async (row: Row): Promise<boolean> => {
    if (!(await canSeeKnowledge(row, handle)))
      return false;
    if (!(await brandMatched(row)))
      return false;
    if (stage) {
      const codes = parseJsonArray(row.stage_codes);
      if (codes.length && !codes.includes(stage))
        return false;
    }
    if (brand) {
      const rowBrand = String(row.brand || "*");
      if (rowBrand !== "*" && rowBrand !== brand)
        return false;
    }
    return true;
  };
  return {
    sql: `SELECT ${KNOWLEDGE_LIST_COLUMNS} FROM knowledge k LEFT JOIN knowledge_versions pv ON pv.id=(SELECT v.id FROM knowledge_versions v WHERE v.knowledge_id=k.id AND v.version=k.published_version AND v.status='published' AND (v.note='approve' OR v.note='create' OR v.note LIKE 'seed %') ORDER BY v.created_at DESC,v.id DESC LIMIT 1)
      ${TAXONOMY_JOIN.replace("b.id=k.base_id", "b.id=COALESCE(pv.base_id,k.base_id)")} WHERE pv.id IS NOT NULL AND ${clauses.map(c => c.replace(/\bk\.(title|body|tags|subject|body_en|kind|in_market)\b/g, "COALESCE(pv.$1,k.$1)")).join(" AND ")} ORDER BY COALESCE(pv.kind,k.kind),COALESCE(pv.title,k.title)`,
    args,
    filter,
  };
}
export async function grantsForKnowledge(id: string): Promise<{
  org: string[];
  team: string[];
  user: string[];
}> {
  (await requireAdmin());
  (await knowledgeRow(id));
  const rows = (await postgresDb().many("SELECT scope, scope_id FROM knowledge_grants WHERE knowledge_id=$1", id)) as {
    scope: string;
    scope_id: string;
  }[];
  const out = { org: [] as string[], team: [] as string[], user: [] as string[] };
  for (const row of rows) {
    if (row.scope === "org")
      out.org.push(row.scope_id);
    if (row.scope === "team")
      out.team.push(row.scope_id);
    if (row.scope === "user")
      out.user.push(row.scope_id);
  }
  return out;
}
export async function setKnowledgeGrants(id: string, patch: {
  org?: string[];
  team?: string[];
  user?: string[];
}, actor?: string): Promise<{
  org: string[];
  team: string[];
  user: string[];
}> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  (await knowledgeRow(id));
  const dir = (await directory());
  const orgOk = new Set(dir.orgs.map((row) => row.id));
  const teamOk = new Set(dir.teams.map((row) => row.id));
  const userOk = new Set(dir.users.map((row) => row.handle));
  const next = {
    org: [...new Set(patch.org || [])],
    team: [...new Set(patch.team || [])],
    user: [...new Set(patch.user || [])],
  };
  for (const scopeId of next.org)
    if (!orgOk.has(scopeId))
      throw new HttpFail(400, "unknown org");
  for (const scopeId of next.team)
    if (!teamOk.has(scopeId))
      throw new HttpFail(400, "unknown team");
  for (const scopeId of next.user)
    if (!userOk.has(scopeId))
      throw new HttpFail(400, "unknown user");
  const now = nowIso();
  await pgTransaction(async (db) => {
    await db.execute("DELETE FROM knowledge_grants WHERE knowledge_id=$1", id);
    for (const scopeId of next.org)
      await db.execute("INSERT INTO knowledge_grants (id,knowledge_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("kgr"), id, "org", scopeId, actor, now);
    for (const scopeId of next.team)
      await db.execute("INSERT INTO knowledge_grants (id,knowledge_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("kgr"), id, "team", scopeId, actor, now);
    for (const scopeId of next.user)
      await db.execute("INSERT INTO knowledge_grants (id,knowledge_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("kgr"), id, "user", scopeId, actor, now);
  });
  (await audit(actor, "knowledge.grant.save", { knowledge_id: id, org: next.org, team: next.team, user: next.user }));
  return (await grantsForKnowledge(id));
}
/** 某条知识出现授权行时按对象收窄；无授权行者维持「已发布即可见」。 */
export async function canSeeKnowledge(row: Row, handle?: string): Promise<boolean> {
  const id = String(row.id || "");
  if (!id)
    return true;
  const rows = (await postgresDb().many("SELECT scope, scope_id FROM knowledge_grants WHERE knowledge_id=$1", id)) as {
    scope: string;
    scope_id: string;
  }[];
  if (!rows.length)
    return true;
  const who = handle || (await currentUser()).handle;
  const mem = (await memberScopeIds(who));
  return rows.some((grant) => (grant.scope === "org" && mem.orgs.includes(grant.scope_id)) ||
    (grant.scope === "team" && mem.teams.includes(grant.scope_id)) ||
    (grant.scope === "user" && grant.scope_id === who));
}
export async function getKnowledgeVersion(id: string, version: number): Promise<Json> {
  (await requireAdmin());
  if (!Number.isFinite(Number(version)))
    throw new HttpFail(404, "version not found");
  (await knowledgeRow(id));
  const row = (await postgresDb().one("SELECT * FROM knowledge_versions WHERE knowledge_id=$1 AND version=$2", id, Number(version))) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "version not found");
  return row;
}
/** 回滚 = 以历史版本内容生成新草稿版本，历史行不动。 */
export async function rollbackKnowledge(id: string, version: number, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  if (!Number.isFinite(Number(version)))
    throw new HttpFail(404, "version not found");
  const prev = (await knowledgeRow(id));
  const snap = (await postgresDb().one("SELECT * FROM knowledge_versions WHERE knowledge_id=$1 AND version=$2", id, Number(version))) as Row | undefined;
  if (!snap)
    throw new HttpFail(404, "version not found");
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
    // 快照四列（tags/in_market/effective_at/expires_at）：回滚即按当版恢复，不再丢字段。
    in_market: snap.in_market == null ? prev.in_market : Number(snap.in_market),
    effective_at: snap.effective_at == null ? prev.effective_at : String(snap.effective_at),
    expires_at: snap.expires_at == null ? prev.expires_at : String(snap.expires_at),
    status: "draft",
    current_version: Number(prev.current_version || 1) + 1,
    updated_at: nowIso(),
  };
  (await pgTransaction(async (db) => {
    (await db.execute(`UPDATE knowledge
          SET title=$1,body=$2,tags=$3,in_market=$4,kind=$5,skill_id=$6,brand=$7,lang=$8,subject=$9,body_en=$10,placeholders=$11,stage_codes=$12,effective_at=$13,expires_at=$14,status=$15,current_version=$16,updated_at=$17
        WHERE id=$18`, next.title, next.body, next.tags, next.in_market, next.kind, next.skill_id, next.brand, next.lang, next.subject, next.body_en, next.placeholders, next.stage_codes, next.effective_at, next.expires_at, next.status, next.current_version, next.updated_at, id));
    (await writeVersion(db, next, `rollback from v${Number(version)}`, actor));
  }));
  (await audit(actor, "knowledge.rollback", { knowledge_id: id, from_version: Number(version), to_version: next.current_version }));
  return (await publicKnowledge((await knowledgeRow(id)), actor));
}
export const BINDING_SELECTOR_KEYS = ["ids", "base_ids", "kinds", "tags", "stage_codes", "brand", "lang"] as const;
export type KnowledgeBindingSelector = {
  ids?: string[];
  base_ids?: string[];
  kinds?: string[];
  tags?: string[];
  stage_codes?: string[];
  brand?: string;
  lang?: string;
};
type StoredBinding = {
  id: string;
  skill_id: string;
  selector: KnowledgeBindingSelector;
};
function stringList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
}
function normalizeSelector(value: unknown): KnowledgeBindingSelector {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "{}");
    }
    catch {
      throw new HttpFail(400, "selector 须为 JSON 对象");
    }
  }
  if (raw == null)
    raw = {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new HttpFail(400, "selector 须为 JSON 对象");
  const input = raw as Json;
  for (const key of Object.keys(input)) {
    if (!(BINDING_SELECTOR_KEYS as readonly string[]).includes(key)) {
      throw new HttpFail(400, `selector 允许键：${BINDING_SELECTOR_KEYS.join(" / ")}`);
    }
  }
  const kinds = stringList(input.kinds);
  for (const kind of kinds) {
    if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
      throw new HttpFail(400, `kind 须为 ${KNOWLEDGE_KIND_HINT}`);
    }
  }
  const selector: KnowledgeBindingSelector = {};
  const ids = stringList(input.ids);
  if (ids.length)
    selector.ids = ids;
  const baseIds = stringList(input.base_ids);
  if (baseIds.length)
    selector.base_ids = baseIds;
  if (kinds.length)
    selector.kinds = kinds;
  const tags = stringList(input.tags);
  if (tags.length)
    selector.tags = tags;
  const stageCodes = stringList(input.stage_codes);
  if (stageCodes.length)
    selector.stage_codes = stageCodes;
  const brand = String(input.brand == null ? "" : input.brand).trim();
  if (brand)
    selector.brand = brand;
  const lang = String(input.lang == null ? "" : input.lang).trim();
  if (lang)
    selector.lang = lang;
  return selector;
}
function parseSelectorStored(value: unknown): KnowledgeBindingSelector {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as KnowledgeBindingSelector;
  }
  catch {
    return {};
  }
}
async function bindingRows(skillId?: string, enabledOnly = false): Promise<Row[]> {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (enabledOnly)
    clauses.push("enabled=1");
  if (skillId) {
    args.push(skillId);
    clauses.push(`skill_id=$${args.length}`);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (await postgresDb().many(`SELECT * FROM knowledge_bindings${where} ORDER BY created_at, id`, ...args)) as Row[];
}
async function storedBindings(skillId?: string, enabledOnly = false): Promise<StoredBinding[]> {
  return (await bindingRows(skillId, enabledOnly)).map((row) => ({
    id: String(row.id),
    skill_id: String(row.skill_id),
    selector: parseSelectorStored(row.selector),
  }));
}
export async function listBindings(): Promise<Json[]> {
  (await requireAdmin());
  return (await bindingRows()).map((row) => ({ ...row, selector: parseSelectorStored(row.selector) }));
}
export async function saveBinding(input: {
  id?: string;
  skill_id?: string;
  selector?: unknown;
  enabled?: boolean | number;
  note?: string;
}, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const id = String(input.id || "").trim();
  const prev = id
    ? (await postgresDb().one("SELECT * FROM knowledge_bindings WHERE id=$1", id)) as Row | undefined
    : undefined;
  if (id && !prev)
    throw new HttpFail(404, "binding not found");
  const skillId = String(input.skill_id == null ? prev?.skill_id ?? "" : input.skill_id).trim();
  if (!skillId)
    throw new HttpFail(400, "skill_id required");
  if ((await postgresDb().one("SELECT 1 FROM skill_knowledge_configs WHERE skill_id=$1 OR skill_id=$2", skillId, String(prev?.skill_id || ''))))
    throw new HttpFail(409, '知识技能的资源依赖请在技能页修改草稿并试算发布；不能从智能体页直接修改共享范围。');
  const selector = input.selector == null ? parseSelectorStored(prev?.selector) : normalizeSelector(input.selector);
  const enabled = input.enabled == null ? (Number(prev?.enabled ?? 1) ? 1 : 0) : (input.enabled ? 1 : 0);
  const note = input.note == null ? String(prev?.note ?? "") : String(input.note);
  const bindingId = id || nid("kbind");
  const now = nowIso();
  try {
    await pgTransaction(async (db) => {
      if (prev) {
        (await db.execute("UPDATE knowledge_bindings SET skill_id=$1,selector=$2,enabled=$3,note=$4,updated_at=$5 WHERE id=$6", skillId, JSON.stringify(selector), enabled, note, now, bindingId));
      }
      else {
        (await db.execute(`INSERT INTO knowledge_bindings (id,skill_id,selector,enabled,note,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, bindingId, skillId, JSON.stringify(selector), enabled, note, actor, now, now));
      }
    });
  }
  catch (error) {
    const failure = error as {
      code?: string;
      message?: string;
    };
    if (failure?.code === "23514" && String(failure.message).includes("knowledge_taxonomy_asset_unavailable"))
      throw new HttpFail(400, { code: "knowledge_selector_unavailable", message: "选择器引用的知识或知识库不存在、已归档或不可用。" });
    throw error;
  }
  (await audit(actor, "knowledge.binding.save", { binding_id: bindingId, skill_id: skillId, enabled }));
  const row = (await postgresDb().one("SELECT * FROM knowledge_bindings WHERE id=$1", bindingId)) as Row;
  return { ...row, selector: parseSelectorStored(row.selector) };
}
export async function deleteBinding(id: string, actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  const row = (await postgresDb().one("SELECT * FROM knowledge_bindings WHERE id=$1", id)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "binding not found");
  if ((await postgresDb().one("SELECT 1 FROM skill_knowledge_configs WHERE skill_id=$1", String(row.skill_id))))
    throw new HttpFail(409, '请在技能页修改知识依赖草稿并发布。');
  (await pgTransaction(async (db) => {
    (await db.execute("DELETE FROM knowledge_bindings WHERE id=$1", id));
  }));
  (await audit(actor, "knowledge.binding.save", {
    binding_id: id,
    skill_id: String(row.skill_id || ""),
    enabled: Number(row.enabled || 0),
    deleted: true,
  }));
  return { ok: true, id };
}
export function bindingMatchesRow(selector: KnowledgeBindingSelector, row: Row): boolean {
  return knowledgeBindingMatchesRow(selector, row);
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
export type KnowledgeResolveSkip = {
  knowledge_id: string;
  title?: string;
  reason: string;
};
export type KnowledgeResolveResult = {
  resolved: KnowledgeResolveItem[];
  skipped: KnowledgeResolveSkip[];
  bound: boolean;
};
function stagePriority(row: Row, stage: string): number {
  const codes = parseJsonArray(row.stage_codes);
  if (stage && codes.includes(stage))
    return 0;
  if (!codes.length)
    return 1;
  return 2;
}
function brandPriority(row: Row): number {
  const brand = String(row.brand || "*");
  return brand && brand !== "*" ? 0 : 1;
}
/** 运行时解析（员工路径可用，不加 requireAdmin）：显式 ids > 阶段精确 > 品牌精确 > 更新时间。 */
export async function resolveForSkill(skillId: string, opts: {
  userId?: string;
  brands?: string[];
  stageCode?: string | null;
  record?: boolean;
} = {}): Promise<KnowledgeResolveResult> {
  const skill = String(skillId || "").trim();
  const bindings = skill ? (await storedBindings(skill, true)) : [];
  if (!bindings.length)
    return { resolved: [], skipped: [], bound: false };
  const userId = opts.userId || (await knowledgeActorId());
  const brands = opts.brands || (await actorBrands());
  const stage = String(opts.stageCode || "").trim();
  const handle = (await viewerHandle(userId));
  const db = postgresDb();
  const published = (await effectivePublishedRows((await db.many("SELECT * FROM knowledge WHERE status='published'")) as Row[]));
  const citedIds = new Set(((await db.many("SELECT knowledge_id FROM knowledge_citations WHERE user_id=$1", userId)) as Row[])
    .map((row) => String(row.knowledge_id)));
  const deprecatedIds = new Set(((await db.many("SELECT knowledge_id FROM knowledge_deprecations WHERE user_id=$1", userId)) as Row[])
    .map((row) => String(row.knowledge_id)));
  const structuredBaseIds = new Set(((await db.many("SELECT id FROM knowledge_bases WHERE kind='structured'")) as Row[])
    .map((row) => String(row.id)));
  const skipped: KnowledgeResolveSkip[] = [];
  const skipKeys = new Set<string>();
  const pushSkip = (entry: KnowledgeResolveSkip): void => {
    const key = `${entry.knowledge_id}:${entry.reason}`;
    if (skipKeys.has(key))
      return;
    skipKeys.add(key);
    skipped.push(entry);
  };
  const gateReason = async (row: Row): Promise<string | null> => {
    if (!(await brandMatched(row, brands)) || !(await canSeeKnowledge(row, handle)))
      return "scope_mismatch";
    if (!citedIds.has(String(row.id)))
      return "not_cited";
    if (deprecatedIds.has(String(row.id)))
      return "deprecated_by_user";
    if (!structuredBaseIds.has(String(row.base_id || "")))
      return "wrong_base_type";
    return null;
  };
  const pinned: string[] = [];
  const candidates = new Map<string, Row>();
  const evaluated = new Set<string>();
  for (const binding of bindings) {
    for (const id of binding.selector.ids || []) {
      let row = (await db.one("SELECT * FROM knowledge WHERE id=$1", id)) as Row | undefined;
      if (!row) {
        pushSkip({ knowledge_id: id, reason: "missing" });
        continue;
      }
      if (!pinned.includes(id))
        pinned.push(id);
      if (evaluated.has(id))
        continue;
      if (String(row.status) !== "published") {
        pushSkip({ knowledge_id: id, title: String(row.title || ""), reason: "not_published" });
        evaluated.add(id);
        continue;
      }
      try {
        row = (await effectivePublishedRow(row));
      }
      catch (e) {
        if (!(e instanceof HttpFail))
          throw e;
        pushSkip({ knowledge_id: id, reason: "not_published" });
        evaluated.add(id);
        continue;
      }
      if (!bindingMatchesRow(binding.selector, row))
        continue;
      const reason = (await gateReason(row));
      if (reason) {
        pushSkip({ knowledge_id: id, title: String(row.title || ""), reason });
        evaluated.add(id);
        continue;
      }
      candidates.set(id, row);
      evaluated.add(id);
    }
    for (const row of published) {
      if (!bindingMatchesRow(binding.selector, row))
        continue;
      const id = String(row.id);
      if (evaluated.has(id))
        continue;
      const reason = (await gateReason(row));
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
    if (ap !== bp)
      return ap - bp;
    const stageDiff = stagePriority(a, stage) - stagePriority(b, stage);
    if (stageDiff)
      return stageDiff;
    const brandDiff = brandPriority(a) - brandPriority(b);
    if (brandDiff)
      return brandDiff;
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
    }
    else {
      seenKinds.add(kind);
    }
  }
  if (opts.record) {
    (await audit(userId, "knowledge.resolve", {
      skill_id: skill,
      source: "binding",
      resolved: resolved.map((item) => ({ id: item.id, version: item.version })),
      skipped_count: skipped.length,
    }));
  }
  return { resolved, skipped, bound: true };
}
export async function resolvePreview(input: {
  skill_id?: string;
  user_id?: string;
  stage_code?: string;
  brand?: string;
}): Promise<Json> {
  (await requireAdmin());
  const skillId = String(input.skill_id || "").trim();
  if (!skillId)
    throw new HttpFail(400, "skill_id required");
  const userId = String(input.user_id || "").trim() || (await knowledgeActorId());
  const brand = String(input.brand || "").trim();
  const result = (await resolveForSkill(skillId, {
    userId,
    brands: brand ? [brand] : (await actorBrands()),
    stageCode: input.stage_code,
    record: false,
  }));
  const bindings: Json[] = (await bindingRows(skillId)).map((row) => ({ ...row, selector: parseSelectorStored(row.selector) }));
  const skipped: KnowledgeResolveSkip[] = [...result.skipped];
  const seen = new Set(skipped.map((entry) => `${entry.knowledge_id}:${entry.reason}`));
  const published = (await effectivePublishedRows((await postgresDb().many("SELECT * FROM knowledge WHERE status='published'")) as Row[]));
  for (const binding of bindings) {
    if (Number(binding.enabled || 0))
      continue;
    const selector = parseSelectorStored(binding.selector);
    for (const row of published) {
      if (!bindingMatchesRow(selector, row))
        continue;
      const id = String(row.id);
      const key = `${id}:binding_disabled`;
      if (seen.has(key))
        continue;
      seen.add(key);
      skipped.push({ knowledge_id: id, title: String(row.title || ""), reason: "binding_disabled" });
    }
  }
  return { resolved: result.resolved, skipped, bindings };
}
export async function listFeedback(): Promise<Json[]> {
  (await requireAdmin());
  return (await postgresDb().many(`SELECT d.user_id, d.knowledge_id, k.title AS title, d.reason, d.reason_note, d.deprecated_at,
              d.handled_at, d.handled_by, d.handle_action, d.handle_note
         FROM knowledge_deprecations d
         LEFT JOIN knowledge k ON k.id = d.knowledge_id
        ORDER BY d.deprecated_at DESC`)) as Json[];
}
export async function handleFeedback(knowledgeId: string, userId: string, action: "to_revision" | "archive" | "ignore", note = "", actor?: string): Promise<Json> {
  actor ??= await knowledgeActorId();
  (await requireAdmin());
  if (!["to_revision", "archive", "ignore"].includes(action)) {
    throw new HttpFail(400, "action 须为 to_revision / archive / ignore");
  }
  const db = postgresDb();
  const owner = String(userId || "").trim();
  const dep = (await db.one("SELECT * FROM knowledge_deprecations WHERE user_id=$1 AND knowledge_id=$2", owner, knowledgeId)) as Row | undefined;
  if (!dep)
    throw new HttpFail(404, "feedback not found");
  if (dep.handled_at)
    throw new HttpFail(409, "feedback already handled");
  const now = nowIso();
  if (action === "to_revision") {
    const prev = (await knowledgeRow(knowledgeId));
    const next: Row = {
      ...prev,
      status: "draft",
      current_version: Number(prev.current_version || 1) + 1,
      updated_at: now,
    };
    (await pgTransaction(async (inner) => {
      (await inner.execute("UPDATE knowledge SET status='draft',current_version=$1,updated_at=$2 WHERE id=$3", next.current_version, next.updated_at, knowledgeId));
      (await writeVersion(inner, next, "feedback to_revision", actor));
    }));
  }
  else if (action === "archive") {
    (await archiveKnowledge(knowledgeId, actor));
  }
  (await pgTransaction(async (inner) => {
    (await inner.execute("UPDATE knowledge_deprecations SET handled_at=$1,handled_by=$2,handle_action=$3,handle_note=$4 WHERE user_id=$5 AND knowledge_id=$6", now, actor, action, String(note || ""), owner, knowledgeId));
  }));
  (await audit(actor, "knowledge.feedback.handle", { knowledge_id: knowledgeId, user_id: owner, action }));
  return (await db.one(`SELECT d.*, k.title AS title FROM knowledge_deprecations d
        LEFT JOIN knowledge k ON k.id = d.knowledge_id
        WHERE d.user_id=$1 AND d.knowledge_id=$2`, owner, knowledgeId)) as Json;
}
export async function adminAssets(): Promise<Json[]> {
  (await requireAdmin());
  const bindings = (await storedBindings(undefined, true));
  return (await adminList()).map((row) => ({
    ...row,
    ref_skills: [...new Set(bindings.filter((binding) => bindingMatchesRow(binding.selector, row)).map((binding) => binding.skill_id))],
  }));
}
export async function seedKnowledge(conn = postgresDb()): Promise<void> {
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
      body_en: "Hi,\n\nWe would love to send a LiTime Mini 12V for a weekend van test. Happy to share the spec sheet whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
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
      body_en: "Hi,\n\nJust a quick follow-up on the LiTime collab kit we mentioned last week. Happy to share the spec sheet or a short unboxing angle whenever you have a slot.\n\nBest,\nLiTime Creator Desk\n",
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
      body_en: "Hi,\n\nPlease find the LiTime collaboration quote at USD [金额USD] per hour.\n\nReply to this thread if this rate works.\n\nBest,\nLiTime Creator Desk\n",
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
      body_en: "Hi,\n\nBefore we can ship the sample, please reply with your recipient name, phone, full address, country, postal code, SKU and quantity.\n\nBest,\nCreator Desk\n",
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
      body_en: "Hi,\n\nChecking in on the family camping power outline. A one-pager with shot list and publish window would help us lock the sample kit.\n\nBest,\nRenogy Creator Desk\n",
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
      body_en: "Hi,\n\nYour sample kit is on the way.\nTracking: [运单号]\nCarrier: [承运商]\n\nBest,\nCreator Desk\n",
      placeholders: ["[运单号]", "[承运商]"],
      stage_codes: ["SHIPPED"],
      tags: "email_compose,mail_template",
    },
  ];
  const questions: Array<{
    id: string;
    slot: QuestionTemplateSlot;
    title: string;
    body: string;
  }> = [
    {
      id: "kb_q_pool_potential",
      slot: "potential",
      title: "公海 · 高潜KOL分析提问模板",
      body: "请基于公开资料分析这些 KOL 的合作潜力，逐条说明判断依据与资料缺口。",
    },
    {
      id: "kb_q_pool_risk",
      slot: "risk",
      title: "公海 · 高风险KOL分析提问模板",
      body: "请基于公开资料分析这些 KOL 的合作风险，逐条说明判断依据与资料缺口。",
    },
    {
      id: "kb_q_pool_completeness",
      slot: "completeness",
      title: "公海 · 资料完整度检查提问模板",
      body: "请检查这些 KOL 的公开资料完整度，列出待补充项与补齐来源。",
    },
    {
      id: "kb_q_pool_score",
      slot: "score",
      title: "公海 · KOL评分提问模板",
      body: "请对这些 KOL 的公开资料做潜力/风险评分，说明口径、依据与置信度。",
    },
  ];
  // 演示语料属于分层迁移前的存量：与历史行一样归入默认结构化库（未分类/未分类/历史知识）。
  const baseId = (await defaultStructuredBaseId());
  const upsertSeed = async (entry: {
    id: string;
    title: string;
    body: string;
    tags: string;
    kind: string;
    skillId: string;
    brand: string;
    subject: string;
    bodyEn: string;
    placeholders: string;
    stageCodes: string;
    sourceBody: string;
  }): Promise<void> => {
    await conn.execute(`INSERT INTO knowledge
          (id,title,body,tags,in_market,kind,skill_id,brand,lang,subject,body_en,placeholders,stage_codes,status,current_version,published_version,created_by,approved_by,approved_at,base_id,source_body,created_at,updated_at)
          VALUES ($1,$2,$3,$4,1,$5,$6,$7,'en',$8,$9,$10,$11,'published',1,1,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id) DO UPDATE SET
            title=EXCLUDED.title,body=EXCLUDED.body,tags=EXCLUDED.tags,in_market=EXCLUDED.in_market,
            kind=EXCLUDED.kind,skill_id=EXCLUDED.skill_id,brand=EXCLUDED.brand,lang=EXCLUDED.lang,
            subject=EXCLUDED.subject,body_en=EXCLUDED.body_en,placeholders=EXCLUDED.placeholders,
            stage_codes=EXCLUDED.stage_codes,status=EXCLUDED.status,published_version=EXCLUDED.published_version,
            approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at,base_id=EXCLUDED.base_id,
            source_body=EXCLUDED.source_body,updated_at=EXCLUDED.updated_at`, entry.id, entry.title, entry.body, entry.tags, entry.kind, entry.skillId, entry.brand, entry.subject, entry.bodyEn, entry.placeholders, entry.stageCodes, actor, actor, now, baseId, entry.sourceBody, now, now);
  };
  const insertSeedVersion = async (entry: {
    id: string;
    title: string;
    body: string;
    subject: string;
    bodyEn: string;
    placeholders: string;
    stageCodes: string;
    skillId: string;
    brand: string;
    kind: string;
    note: string;
  }): Promise<void> => {
    await conn.execute(`INSERT INTO knowledge_versions
          (id,knowledge_id,version,title,body,subject,body_en,placeholders,stage_codes,skill_id,brand,lang,kind,status,created_by,created_at,note)
          VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'en',$11,'published',$12,$13,$14)
          ON CONFLICT DO NOTHING`, `kv_${entry.id}_1`, entry.id, entry.title, entry.body, entry.subject, entry.bodyEn, entry.placeholders, entry.stageCodes, entry.skillId, entry.brand, entry.kind, actor, now, entry.note);
  };
  for (const policy of policies) {
    await upsertSeed({ id: policy.id, title: policy.title, body: policy.body, tags: policy.tags, kind: "policy", skillId: policy.skill_id, brand: "*", subject: "", bodyEn: "", placeholders: "[]", stageCodes: "[]", sourceBody: policy.body });
    await insertSeedVersion({ id: policy.id, title: policy.title, body: policy.body, subject: "", bodyEn: "", placeholders: "[]", stageCodes: "[]", skillId: policy.skill_id, brand: "*", kind: "policy", note: "seed policy v1" });
  }
  for (const mail of mails) {
    const placeholders = JSON.stringify(mail.placeholders), stageCodes = JSON.stringify(mail.stage_codes);
    await upsertSeed({ id: mail.id, title: mail.title, body: mail.body_en, tags: mail.tags, kind: "mail_template", skillId: mail.skill_id, brand: mail.brand, subject: mail.subject, bodyEn: mail.body_en, placeholders, stageCodes, sourceBody: mail.body_en });
    await insertSeedVersion({ id: mail.id, title: mail.title, body: mail.body_en, subject: mail.subject, bodyEn: mail.body_en, placeholders, stageCodes, skillId: mail.skill_id, brand: mail.brand, kind: "mail_template", note: "seed mail_template v1" });
  }
  for (const question of questions) {
    const tags = `${QUESTION_TEMPLATE_TAG_PREFIX}${question.slot},kol-pool`;
    await upsertSeed({ id: question.id, title: question.title, body: question.body, tags, kind: "question_template", skillId: "", brand: "*", subject: "", bodyEn: "", placeholders: "[]", stageCodes: "[]", sourceBody: question.body });
    await insertSeedVersion({ id: question.id, title: question.title, body: question.body, subject: "", bodyEn: "", placeholders: "[]", stageCodes: "[]", skillId: "", brand: "*", kind: "question_template", note: "seed question v1" });
  }
}
