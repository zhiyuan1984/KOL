/**
 * Catalog governance only: active/archived is independent of content publication.
 * CONST-05/06, TECH-BE-01/02/03: current admin, versioned confirmation, atomic audit.
 * The guard migration serializes every relevant writer with these mutations;
 * never enable destructive operations against an older, unprotected schema.
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { requireAdmin } from '../auth.js';
import { postgresTransaction } from '../postgres/pool.js';
import { HttpFail } from '../host/errors.js';
import { knowledgeBindingMatchesRow } from './binding-selector.js';

type Row = Record<string, any>;
export type CatalogConfirmation = { confirmed?: unknown; expected_updated_at?: unknown };
export type DomainPatch = CatalogConfirmation & { name?: string; sort?: number | null; status?: string; note?: string };
export type BasePatch = CatalogConfirmation & { name?: string; description?: string; status?: string; expected_version?: number | null; domain_id?: string; kind?: string };
export type CreateCatalogDomainInput = { code?: unknown; name?: unknown; level?: unknown; parent_id?: unknown; sort?: unknown; note?: unknown };
export type CreateCatalogBaseInput = { code?: unknown; name?: unknown; domain_id?: unknown; kind?: unknown; description?: unknown; settings?: unknown; external_ref?: unknown };
type Blocker = { code: string; message: string; count: number };
const LOCK_KEY = 'knowledge-taxonomy-mutation-v1';
const DOMAIN_CODE_RE = /^[a-z][a-z0-9_]*$/;
const fail = (status: number, code: string, message: string): never => { throw new HttpFail(status, { code, message }); };
const parse = (value: unknown): any => typeof value === 'string' ? JSON.parse(value) : value;
const nextStamp = (previous: string): string => new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
const generated = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value == null || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function uniqueDomainCode(db: PoolClient, parentId: string, input: unknown, prefix: 'family' | 'domain'): Promise<string> {
  const supplied = String(input ?? '').trim();
  if (supplied) {
    if (!DOMAIN_CODE_RE.test(supplied)) fail(400, 'knowledge_domain_code_invalid', 'code 须为小写字母开头的 a-z0-9_ 编码');
    const exists = (await db.query("SELECT 1 FROM knowledge_domains WHERE code=$1 AND COALESCE(parent_id,'')=$2", [supplied, parentId])).rows[0];
    if (exists) fail(409, 'knowledge_domain_code_conflict', '同一父级下编码已存在');
    return supplied;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generated(prefix);
    const exists = (await db.query("SELECT 1 FROM knowledge_domains WHERE code=$1 AND COALESCE(parent_id,'')=$2", [code, parentId])).rows[0];
    if (!exists) return code;
  }
  return fail(409, 'knowledge_domain_code_conflict', '无法生成未占用的主题域编码，请重试');
}

async function uniqueBaseCode(db: PoolClient, input: unknown): Promise<string> {
  const supplied = String(input ?? '').trim();
  if (supplied) {
    const exists = (await db.query('SELECT 1 FROM knowledge_bases WHERE code=$1', [supplied])).rows[0];
    if (exists) fail(409, 'knowledge_base_code_conflict', '知识库编码已存在');
    return supplied;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generated('base');
    const exists = (await db.query('SELECT 1 FROM knowledge_bases WHERE code=$1', [code])).rows[0];
    if (!exists) return code;
  }
  return fail(409, 'knowledge_base_code_conflict', '无法生成未占用的知识库编码，请重试');
}

function confirmation(input: CatalogConfirmation) {
  if (input.confirmed !== true) fail(400, 'knowledge_taxonomy_confirmation_required', '请明确确认本次删除或归档操作');
  if (typeof input.expected_updated_at !== 'string' || !input.expected_updated_at.trim()) {
    fail(400, 'knowledge_taxonomy_version_required', '缺少当前版本，请刷新后重新确认');
  }
}
function version(row: Row, input: CatalogConfirmation) {
  if (input.expected_updated_at !== undefined && input.expected_updated_at !== row.updated_at) {
    fail(409, 'knowledge_taxonomy_version_conflict', '该节点已变更，请刷新并重新确认');
  }
}
async function admin(db: PoolClient, actor: string) {
  const row = (await db.query('SELECT roles FROM users WHERE id=$1 AND active=1 FOR SHARE', [actor])).rows[0];
  let roles: unknown;
  try { roles = parse(row?.roles); } catch { roles = null; }
  if (!Array.isArray(roles) || !roles.includes('admin')) fail(403, 'knowledge_catalog_admin_required', '需要当前有效的知识管理权限');
}
async function lock(db: PoolClient, destructive: boolean) {
  if (destructive) {
    const marker = (await db.query("SELECT to_regprocedure('knowledge_taxonomy_guard_version()') IS NOT NULL AS ready")).rows[0];
    if (!marker?.ready) fail(503, 'knowledge_taxonomy_guard_required', '安全删除与归档尚未启用，请先由运维部署知识分类保护迁移');
    const ready = (await db.query('SELECT knowledge_taxonomy_guard_version() AS version')).rows[0];
    if (Number(ready?.version) !== 1) fail(503, 'knowledge_taxonomy_guard_required', '知识分类保护版本不匹配，请联系运维');
  }
  await db.query("SET LOCAL lock_timeout = '5s'");
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
}
async function rowForUpdate(db: PoolClient, table: 'knowledge_domains' | 'knowledge_bases', id: string): Promise<Row> {
  const row = (await db.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
  if (!row) fail(404, 'knowledge_taxonomy_not_found', '知识分类节点不存在');
  return row;
}
function blocked(kind: 'domain' | 'base', action: 'delete' | 'archive', reasons: Blocker[]) {
  if (!reasons.length) return;
  throw new HttpFail(409, {
    code: `knowledge_${kind}_in_use`,
    message: `${action === 'delete' ? '不能删除' : '不能归档'}：${reasons.map(r => r.message).join('；')}`,
    reasons,
  });
}
async function counts(db: PoolClient, sql: string, id: string): Promise<Blocker[]> {
  return (await db.query(sql, [id])).rows.filter(r => Number(r.count) > 0)
    .map(r => ({ code: String(r.code), message: String(r.message), count: Number(r.count) }));
}
async function domainBlockers(db: PoolClient, id: string): Promise<Blocker[]> {
  return counts(db, `SELECT 'child_domains' AS code,'仍有子主题域（含已归档节点）' AS message,COUNT(*) AS count FROM knowledge_domains WHERE parent_id=$1
    UNION ALL SELECT 'child_bases','仍有知识库（含已归档节点）',COUNT(*) FROM knowledge_bases WHERE domain_id=$1`, id);
}

/** Invalid/unknown selectors cannot be treated as evidence of no dependency. */
function selectorReferences(raw: unknown, id: string, assets: Row[], config: boolean): boolean | null {
  if (raw == null) return false;
  let value: any;
  try { value = parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = config ? ['base_ids', 'document_ids'] : ['ids', 'base_ids', 'kinds', 'tags', 'stage_codes', 'brand', 'lang'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return null;
  for (const key of config ? ['base_ids', 'document_ids'] : ['base_ids', 'ids', 'kinds', 'tags', 'stage_codes']) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].some((v: unknown) => typeof v !== 'string')) return null;
    if (key === 'base_ids' && value[key].includes(id)) return true;
    if (['ids', 'document_ids'].includes(key) && value[key].some((v: string) => assets.some(asset => asset.id === v))) return true;
  }
  if (config) return !Array.isArray(value.base_ids) || !value.base_ids.length ? null : false;
  if (['brand', 'lang'].some(key => value[key] !== undefined && typeof value[key] !== 'string')) return null;
  return assets.some(asset => knowledgeBindingMatchesRow(value, asset));
}
async function baseBlockers(db: PoolClient, row: Row, action: 'delete' | 'archive'): Promise<Blocker[]> {
  const id = String(row.id);
  const assets = (await db.query(`SELECT id,base_id,kind,tags,brand,lang FROM knowledge WHERE base_id=$1
    UNION ALL SELECT knowledge_id AS id,base_id,kind,tags,brand,lang FROM knowledge_versions WHERE base_id=$1
    UNION ALL SELECT id,base_id,'document' AS kind,NULL AS tags,NULL AS brand,NULL AS lang FROM knowledge_documents WHERE base_id=$1`, [id])).rows;
  const reasons = await counts(db, action === 'delete'
    ? `SELECT 'entries' AS code,'仍有知识条目（含草稿和历史条目）' AS message,COUNT(*) AS count FROM knowledge WHERE base_id=$1
      UNION ALL SELECT 'documents','仍有资料（含草稿和已归档资料）',COUNT(*) FROM knowledge_documents WHERE base_id=$1
      UNION ALL SELECT 'versions','仍有知识历史版本引用',COUNT(*) FROM knowledge_versions WHERE base_id=$1
      UNION ALL SELECT 'publication_binding','仍有发布审批流程绑定',COUNT(*) FROM knowledge_publication_bindings WHERE base_id=$1
      UNION ALL SELECT 'publication_requests','仍有发布申请历史引用',COUNT(*) FROM knowledge_publication_requests WHERE snapshot->>'base_id'=$1
      UNION ALL SELECT 'publication_applications','仍有审批发布历史引用',COUNT(*) FROM knowledge_publication_applications
        WHERE snapshot::jsonb->>'baseId'=$1 OR snapshot::jsonb->'fields'->>'base_id'=$1`
    : `SELECT 'published_entries' AS code,'仍有生效知识条目，请先停用条目' AS message,COUNT(*) AS count FROM knowledge
        WHERE base_id=$1 AND (status='published' OR (published_version IS NOT NULL AND status<>'archived'))
      UNION ALL SELECT 'published_versions','仍有生效知识版本引用',COUNT(*) FROM knowledge_versions v JOIN knowledge k ON k.id=v.knowledge_id AND k.published_version=v.version WHERE v.base_id=$1 AND k.status<>'archived'
      UNION ALL SELECT 'published_documents','仍有已发布资料，请先停用资料',COUNT(*) FROM knowledge_documents WHERE base_id=$1 AND status='published'
      UNION ALL SELECT 'publication_binding','仍有发布审批流程绑定',COUNT(*) FROM knowledge_publication_bindings WHERE base_id=$1
      UNION ALL SELECT 'pending_entries','仍有待审批知识条目',COUNT(*) FROM knowledge WHERE base_id=$1 AND status='pending_review'
      UNION ALL SELECT 'pending_documents','仍有加工中或待审批资料',COUNT(*) FROM knowledge_documents WHERE base_id=$1 AND status IN ('normalizing','indexing','pending_review')
      UNION ALL SELECT 'document_jobs','仍有资料加工作业',COUNT(*) FROM knowledge_document_jobs j JOIN knowledge_documents d ON d.id=j.document_id WHERE d.base_id=$1 AND j.status IN ('queued','running')
      UNION ALL SELECT 'publication_applications','仍有待完成或可恢复的发布申请',COUNT(*) FROM knowledge_publication_applications a
        LEFT JOIN knowledge k ON k.id=a.entry_id LEFT JOIN knowledge_documents d ON d.id=a.document_id
        WHERE (k.base_id=$1 OR d.base_id=$1 OR a.snapshot::jsonb->>'baseId'=$1 OR a.snapshot::jsonb->'fields'->>'base_id'=$1) AND a.status IN ('waiting','failed')
      UNION ALL SELECT 'legacy_publications','仍有待完成的审批或发布',COUNT(*) FROM knowledge_publications p JOIN knowledge_documents d ON d.id=p.document_id
        WHERE d.base_id=$1 AND (p.publication_status IN ('queued','publishing','failed','blocked') OR (p.publication_status<>'published' AND p.review_status IN ('reviewing','blocked','awaiting_amendment','approved')))` , id);
  const refs = (await db.query(`SELECT id,selector,NULL AS published_selector,'binding' AS source FROM knowledge_bindings
    UNION ALL SELECT skill_id AS id,selector::text,published_selector::text,'config' AS source FROM skill_knowledge_configs`)).rows;
  let dependent = 0, unknown = 0;
  for (const ref of refs) {
    const matches = [selectorReferences(ref.selector, id, assets, ref.source === 'config'), selectorReferences(ref.published_selector, id, assets, true)];
    if (matches.includes(null)) unknown += 1;
    if (matches.includes(true)) dependent += 1;
  }
  if (dependent) reasons.push({ code: 'skill_dependencies', message: '仍有技能资源依赖（含停用绑定、草稿和已发布配置）', count: dependent });
  if (unknown) reasons.push({ code: 'unresolved_dependencies', message: '存在无法核验的技能选择范围，须先修复后再操作', count: unknown });
  if (row.external_ref != null && String(row.external_ref).trim() && String(row.external_ref).trim() !== 'null') {
    reasons.push({ code: 'external_reference', message: '仍关联外部知识资源，须先核验并解除关联', count: 1 });
  }
  const jobs = await counts(db, `SELECT 'knowledge_jobs' AS code,'仍有知识作业记录引用' AS message,COUNT(*) AS count FROM execution_jobs
    WHERE ((job_type='knowledge.skill.generate' AND payload_json::jsonb->'spec'->'base_ids' ? $1)
      OR (job_type='knowledge.scope' AND payload_json::jsonb->>'document_id' IN (SELECT id FROM knowledge_documents WHERE base_id=$1)))
      ${action === 'archive' ? "AND status IN ('queued','running','retrying','uncertain')" : ''}`, id);
  reasons.push(...jobs);
  return reasons;
}
async function record(db: PoolClient, actor: string, kind: 'domain' | 'base', action: string, before: Row | null, after: Row | null) {
  const summary = (r: Row | null) => r ? ({ id: r.id, code: r.code, name: r.name, level: r.level, parent_id: r.parent_id,
    domain_id: r.domain_id, status: r.status, version: r.version, updated_at: r.updated_at }) : null;
  const target = after || before;
  const result = await db.query(`INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4) RETURNING id`,
    [new Date().toISOString(), actor, `knowledge.${kind}.${action}`, JSON.stringify({ id: target?.id, before: summary(before), after: summary(after), confirmed: ['delete', 'archive'].includes(action), expected_updated_at: before?.updated_at ?? null })]);
  return result.rows[0]?.id;
}
async function mutation<T>(destructive: boolean, fn: (db: PoolClient, actor: string) => Promise<T>): Promise<T> {
  const actor = requireAdmin().id;
  try {
    return await postgresTransaction(async db => {
      await admin(db, actor);
      await lock(db, destructive);
      return fn(db, actor);
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const constraint = (error as { constraint?: string }).constraint;
    const message = error instanceof Error ? error.message : String(error || '');
    if (code === '22P02') fail(409, 'knowledge_taxonomy_unresolved_dependencies', '依赖记录格式无法核验，请先修复后再操作');
    if (code === '23514' && message.includes('knowledge_taxonomy_parent_unavailable')) {
      fail(409, 'knowledge_taxonomy_parent_unavailable', '所属主题域或主题域族不存在或已归档');
    }
    if (code === '23514') fail(409, 'knowledge_taxonomy_dependency_changed', '所属节点或知识依赖已变化，请刷新后重试');
    if (code === '23505' && constraint === 'knowledge_domains_code') fail(409, 'knowledge_domain_code_conflict', '同一父级下编码已存在');
    if (code === '23505' && constraint === 'ux_knowledge_bases_code') fail(409, 'knowledge_base_code_conflict', '知识库编码已存在');
    if (code === '23505') fail(409, 'knowledge_taxonomy_conflict', '知识分类编码已存在，请刷新后重试');
    if (['55P03', '40P01', '40001'].includes(String(code))) fail(409, 'knowledge_taxonomy_busy', '知识分类或依赖正在变更，请刷新后重试');
    throw error;
  }
}

export async function createCatalogDomain(input: CreateCatalogDomainInput) {
  requireAdmin();
  return mutation(false, async (db, actor) => {
    const name = String(input.name ?? '').trim();
    if (!name) fail(400, 'knowledge_taxonomy_invalid', 'name required');
    const level = String(input.level ?? '');
    if (!['family', 'domain'].includes(level)) fail(400, 'knowledge_taxonomy_invalid', 'level 须为 family / domain');
    const parentId = String(input.parent_id ?? '').trim();
    if (level === 'family' && parentId) fail(400, 'knowledge_taxonomy_invalid', '主题域族不能有父级（parent_id）');
    if (level === 'domain') {
      if (!parentId) fail(400, 'knowledge_taxonomy_invalid', '主题域必须给 parent_id（所属族）');
      const parent = (await db.query('SELECT id,level,status FROM knowledge_domains WHERE id=$1 FOR UPDATE', [parentId])).rows[0];
      if (!parent) fail(400, 'knowledge_taxonomy_invalid', '父级主题域不存在');
      if (String(parent.level) !== 'family') fail(400, 'knowledge_taxonomy_invalid', '主题域的父级必须是族（family）');
      if (String(parent.status) !== 'active') fail(409, 'knowledge_taxonomy_parent_unavailable', '所属主题域族不存在或已归档');
    }
    const code = await uniqueDomainCode(db, parentId, input.code, level as 'family' | 'domain');
    const sort = Number.isFinite(Number(input.sort)) ? Number(input.sort) : 0;
    const now = new Date().toISOString();
    const domain = (await db.query(`INSERT INTO knowledge_domains
      (id,code,name,level,parent_id,sort,status,note,created_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$9) RETURNING *`,
    [`kdom_${randomUUID().replaceAll('-', '')}`, code, name, level, level === 'family' ? null : parentId, sort, String(input.note ?? ''), actor, now])).rows[0];
    await record(db, actor, 'domain', 'create', null, domain);
    return { domain };
  });
}

export async function createCatalogBase(input: CreateCatalogBaseInput) {
  requireAdmin();
  return mutation(false, async (db, actor) => {
    const name = String(input.name ?? '').trim();
    if (!name) fail(400, 'knowledge_taxonomy_invalid', 'name required');
    const domainId = String(input.domain_id ?? '').trim();
    if (!domainId) fail(400, 'knowledge_taxonomy_invalid', 'domain_id required');
    const domain = (await db.query('SELECT id,level,status,parent_id FROM knowledge_domains WHERE id=$1 FOR UPDATE', [domainId])).rows[0];
    if (!domain) fail(400, 'knowledge_taxonomy_invalid', '主题域不存在');
    if (String(domain.level) !== 'domain') fail(400, 'knowledge_taxonomy_invalid', '知识库必须挂在主题域（level=domain）下');
    const family = (await db.query('SELECT id,level,status FROM knowledge_domains WHERE id=$1 FOR UPDATE', [domain.parent_id])).rows[0];
    if (String(domain.status) !== 'active' || !family || String(family.level) !== 'family' || String(family.status) !== 'active') {
      fail(409, 'knowledge_taxonomy_parent_unavailable', '所属主题域或主题域族不存在或已归档');
    }
    const kind = String(input.kind ?? '');
    if (!['structured', 'unstructured'].includes(kind)) fail(400, 'knowledge_taxonomy_invalid', 'kind 须为 structured / unstructured');
    const externalRef = input.external_ref == null || input.external_ref === '' ? null : JSON.stringify(input.external_ref);
    if (kind === 'structured' && externalRef) fail(400, 'knowledge_base_external_ref_forbidden', '结构化知识库不能带 external_ref');
    const code = await uniqueBaseCode(db, input.code);
    const now = new Date().toISOString();
    const base = (await db.query(`INSERT INTO knowledge_bases
      (id,code,name,domain_id,kind,description,owner_user_id,status,settings,external_ref,version,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,1,$10,$10) RETURNING *`,
    [`kbase_${randomUUID().replaceAll('-', '')}`, code, name, domainId, kind, String(input.description ?? ''), actor,
      JSON.stringify(jsonObject(input.settings)), externalRef, now])).rows[0];
    await record(db, actor, 'base', 'create', null, base);
    const view = (await db.query(`SELECT b.*,d.name AS domain_name,d.parent_id AS family_id,f.name AS family_name,
      (SELECT COUNT(*) FROM knowledge k WHERE k.base_id=b.id) AS entries FROM knowledge_bases b
      LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id WHERE b.id=$1`, [base.id])).rows[0];
    return { base: { ...view, settings: parse(view.settings || '{}'), external_ref: view.external_ref ? parse(view.external_ref) : null,
      version: Number(view.version), entries: Number(view.entries || 0), description: view.description ?? '', owner_user_id: view.owner_user_id ?? '' } };
  });
}
export async function deleteCatalogDomain(id: string, input: CatalogConfirmation) {
  requireAdmin(); confirmation(input);
  return mutation(true, async (db, actor) => {
    const row = await rowForUpdate(db, 'knowledge_domains', id); version(row, input);
    blocked('domain', 'delete', await domainBlockers(db, id));
    await db.query("SELECT set_config('knowledge.taxonomy_mutation','allowed',true)");
    await db.query('DELETE FROM knowledge_domains WHERE id=$1', [id]);
    const receipt_id = await record(db, actor, 'domain', 'delete', row, null);
    return { ok: true, id, deleted: true, receipt_id };
  });
}
export async function deleteCatalogBase(id: string, input: CatalogConfirmation) {
  requireAdmin(); confirmation(input);
  return mutation(true, async (db, actor) => {
    const row = await rowForUpdate(db, 'knowledge_bases', id); version(row, input);
    blocked('base', 'delete', await baseBlockers(db, row, 'delete'));
    await db.query("SELECT set_config('knowledge.taxonomy_mutation','allowed',true)");
    await db.query('DELETE FROM knowledge_bases WHERE id=$1', [id]);
    const receipt_id = await record(db, actor, 'base', 'delete', row, null);
    return { ok: true, id, deleted: true, receipt_id };
  });
}
export async function editCatalogDomain(id: string, patch: DomainPatch) {
  requireAdmin();
  if (typeof patch.expected_updated_at !== 'string' || !patch.expected_updated_at.trim()) fail(400, 'knowledge_taxonomy_version_required', '缺少当前版本，请刷新后重试');
  const archive = patch.status === 'archived';
  if (archive) confirmation(patch);
  return mutation(archive, async (db, actor) => {
    const row = await rowForUpdate(db, 'knowledge_domains', id); version(row, patch);
    const name = patch.name == null ? row.name : String(patch.name).trim();
    const sort = patch.sort == null ? Number(row.sort) : Number(patch.sort);
    const status = patch.status ?? row.status;
    if (!name || !Number.isFinite(sort) || !['active', 'archived'].includes(status)) fail(400, 'knowledge_taxonomy_invalid', '名称、排序或状态无效');
    if (archive) blocked('domain', 'archive', await domainBlockers(db, id));
    if (status === 'active' && row.parent_id) {
      const parent = (await db.query("SELECT id FROM knowledge_domains WHERE id=$1 AND status='active' AND level='family'", [row.parent_id])).rows[0];
      if (!parent) fail(409, 'knowledge_taxonomy_parent_unavailable', '所属主题域族不存在或已归档');
    }
    await db.query("SELECT set_config('knowledge.taxonomy_mutation','allowed',true)");
    const after = (await db.query(`UPDATE knowledge_domains SET name=$2,sort=$3,status=$4,note=$5,updated_at=$6 WHERE id=$1 RETURNING *`,
      [id, name, sort, status, patch.note ?? row.note, nextStamp(row.updated_at)])).rows[0];
    await record(db, actor, 'domain', archive ? 'archive' : 'save', row, after);
    return { domain: after };
  });
}
export async function editCatalogBase(id: string, patch: BasePatch) {
  requireAdmin();
  const archive = patch.status === 'archived';
  if (archive) confirmation(patch);
  return mutation(archive, async (db, actor) => {
    const row = await rowForUpdate(db, 'knowledge_bases', id); version(row, patch);
    if (patch.expected_version == null || !Number.isFinite(Number(patch.expected_version))) fail(400, 'knowledge_base_version_required', 'expected_version required');
    if (Number(patch.expected_version) !== Number(row.version)) fail(409, 'knowledge_base_version_conflict', '知识库已变更，请刷新后重试');
    if ((patch.domain_id != null && patch.domain_id !== row.domain_id) || (patch.kind != null && patch.kind !== row.kind)) fail(400, 'knowledge_base_immutable', '不允许修改知识库所属主题域或类型');
    const name = patch.name == null ? row.name : String(patch.name).trim(), status = patch.status ?? row.status;
    if (!name || !['active', 'archived'].includes(status)) fail(400, 'knowledge_taxonomy_invalid', '名称或状态无效');
    if (archive) blocked('base', 'archive', await baseBlockers(db, row, 'archive'));
    if (status === 'active') {
      const parent = (await db.query(`SELECT d.id FROM knowledge_domains d JOIN knowledge_domains f ON f.id=d.parent_id
        WHERE d.id=$1 AND d.level='domain' AND d.status='active' AND f.level='family' AND f.status='active'`, [row.domain_id])).rows[0];
      if (!parent) fail(409, 'knowledge_taxonomy_parent_unavailable', '所属主题域或主题域族不存在或已归档');
    }
    await db.query("SELECT set_config('knowledge.taxonomy_mutation','allowed',true)");
    const after = (await db.query(`UPDATE knowledge_bases SET name=$2,description=$3,status=$4,version=version+1,updated_at=$5 WHERE id=$1 RETURNING *`,
      [id, name, patch.description ?? row.description, status, nextStamp(row.updated_at)])).rows[0];
    await record(db, actor, 'base', archive ? 'archive' : 'save', row, after);
    const view = (await db.query(`SELECT b.*,d.name AS domain_name,d.parent_id AS family_id,f.name AS family_name,
      (SELECT COUNT(*) FROM knowledge k WHERE k.base_id=b.id) AS entries FROM knowledge_bases b
      LEFT JOIN knowledge_domains d ON d.id=b.domain_id LEFT JOIN knowledge_domains f ON f.id=d.parent_id WHERE b.id=$1`, [id])).rows[0];
    return { base: { ...view, settings: parse(view.settings || '{}'), external_ref: view.external_ref ? parse(view.external_ref) : null,
      version: Number(view.version), entries: Number(view.entries || 0), description: view.description ?? '', owner_user_id: view.owner_user_id ?? '' } };
  });
}
