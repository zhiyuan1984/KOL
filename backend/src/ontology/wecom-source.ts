import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  WECOM_ONTOLOGY_DEFAULT_MAX_ROWS,
  WECOM_ONTOLOGY_DEFAULT_PAGE_SIZE,
  WECOM_ONTOLOGY_MAX_PAGES,
  WECOM_ONTOLOGY_MAX_PAGE_SIZE,
  WECOM_ONTOLOGY_MAX_ROWS,
  WECOM_ONTOLOGY_PREVIEW_TTL_MS,
  WECOM_ONTOLOGY_SNAPSHOT_TABLE_VERSION,
  WECOM_ONTOLOGY_SOURCE,
  wecomOntologyFieldBindings,
  wecomOntologyObjectMappings,
  wecomOntologyRuntimeTools,
  type WecomCommitReceipt,
  type WecomCommitRequest,
  type WecomDepartmentRecord,
  type WecomPersonRecord,
  type WecomPreviewRequest,
  type WecomPreviewResponse,
  type WecomRemoteEnvelope,
  type WecomRemotePage,
  type WecomRuntimeBinding,
  type WecomSnapshotPage,
  type WecomSnapshotRow,
  type WecomOntologyObjectCode,
  type WecomSnapshotVersion,
  type WecomSourceRecordKind,
  type WecomSourceWarning,
  type WecomStatusResponse,
  type WecomSyncStatus,
} from "../../../shared/wecom-ontology.js";
import { HttpFail } from "../host/errors.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { PLATFORM_SYNC_AGENT } from "../runtime/platform-principal.js";
import { runPlatformSkillTool } from "../runtime/platform-run.js";
import { ensureRuntimeSchema } from "../runtime/store.js";
import type { TicketPrincipal } from "../ticket-domain/auth.js";
import type { Json } from "../types.js";

type Db = Pick<PoolClient, "query">;
type PreviewRow = QueryResultRow & {
  id: string;
  company_id: string;
  actor_id: string;
  content_hash: string;
  binding_fingerprint: string;
  source_version_json: WecomSnapshotVersion;
  root_department_external_ids: string[];
  payload: { rows: WecomSnapshotRow[]; counts: Record<WecomSourceRecordKind, number>; warnings: WecomSourceWarning[] };
  expires_at: string;
  consumed_at: string | null;
};
type SnapshotRow = QueryResultRow & {
  id: string;
  company_id: string;
  source_version_json: WecomSnapshotVersion;
  root_department_external_ids: string[];
};
type SnapshotCursor = { snapshotId: string; kind: WecomSourceRecordKind | null; offset: number };

type BoundTool = { skillTool: number; policy: number };

export type WecomOntologyRuntime = {
  captureStatus(): Promise<{ binding: WecomRuntimeBinding; syncStatus: WecomSyncStatus }>;
  listDepartments(binding: WecomRuntimeBinding, args: { pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomDepartmentRecord>>>;
  listUsers(binding: WecomRuntimeBinding, args: { departmentId: number; includeDescendants: true; pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomPersonRecord>>>;
  currentBinding(): Promise<WecomRuntimeBinding>;
};

const sourceKinds = new Set<WecomSourceRecordKind>(["department", "person", "membership"]);
const now = () => new Date().toISOString();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function sha256(value: unknown): string { return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`; }
function nonEmpty(value: unknown, field: string, limit = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new HttpFail(400, { code: "wecom_invalid_input", message: `${field} 无效` });
  }
  return value.trim();
}
function safeInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new HttpFail(502, { code: "wecom_source_contract_invalid", message: `企微来源返回无效 ${field}` });
  }
  return value;
}
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpFail(502, { code: "wecom_source_contract_invalid", message: `企微来源返回无效 ${field}` });
  }
  return value as Record<string, unknown>;
}
function sourceFailure(code: string, message: string, status: 409 | 422 | 502 | 503 = 502): never {
  throw new HttpFail(status, { code, message });
}
function sourceId(value: unknown, field: string): string {
  const result = String(value ?? "").trim();
  if (!result || result.length > 256 || /[\x00-\x1f\x7f]/.test(result)) {
    sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${field}`);
  }
  return result;
}
/** Opaque MCP cursors are not source IDs and must be retained byte-for-byte. */
function opaqueCursor(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.length > 4_096 || /[\x00-\x1f\x7f]/.test(value)) {
    sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${field}`);
  }
  return value;
}
/** Preserve the source string elsewhere; this is only for fields declared numeric by the MCP/schema. */
function sourceInteger(value: string, field: string): number {
  if (!/^[0-9]+$/.test(value)) sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${field}`);
  return parsed;
}
function externalId(companyId: string, source: string, kind: WecomSourceRecordKind, upstreamId: string): string {
  return `tenant:${encodeURIComponent(companyId)}:source:${encodeURIComponent(source)}:${kind}:${encodeURIComponent(upstreamId)}`;
}
function sourceVersion(status: WecomSyncStatus): WecomSnapshotVersion {
  const data = status.data;
  if (!data || !data.initialized || !data.queryEnabled) {
    sourceFailure("wecom_sync_not_ready", "企微组织通讯录同步尚未初始化或未开放查询", 503);
  }
  const version = safeInteger(status.version, "version", 1);
  if (safeInteger(data.publishedVersion, "data.publishedVersion", 1) !== version) {
    sourceFailure("wecom_sync_version_inconsistent", "企微同步版本与已发布版本不一致", 409);
  }
  const departmentBatchId = sourceId(data.publishedDepartmentBatchId, "publishedDepartmentBatchId");
  const userBatchId = sourceId(data.publishedUserBatchId, "publishedUserBatchId");
  if (data.publishedDepartmentBatch?.status !== "SUCCESS" || data.publishedUserBatch?.status !== "SUCCESS") {
    sourceFailure("wecom_sync_batch_not_success", "企微部门或人员批次尚未成功发布", 409);
  }
  return {
    source: sourceId(status.source, "source"),
    version,
    departmentBatchId,
    userBatchId,
    publishedAt: data.publishedAt ?? null,
    lastSyncedAt: status.lastSyncedAt ?? null,
  };
}
function sameSourceVersion(left: WecomSnapshotVersion, right: WecomSnapshotVersion): boolean {
  return left.source === right.source
    && left.version === right.version
    && left.departmentBatchId === right.departmentBatchId
    && left.userBatchId === right.userBatchId;
}
function unwrapRemotePayload(raw: Json): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (record.structuredContent && typeof record.structuredContent === "object" && !Array.isArray(record.structuredContent)) {
      return record.structuredContent as Record<string, unknown>;
    }
    if (typeof record.text === "string") {
      try { return asRecord(JSON.parse(record.text), "MCP text"); } catch { /* fall through */ }
    }
    if ("source" in record && "data" in record) return record;
  }
  sourceFailure("wecom_source_contract_invalid", "企微 MCP 未返回可校验的结构化数据");
}
function remoteEnvelope<T>(raw: Json, label: string, parseData: (value: unknown) => T): WecomRemoteEnvelope<T> {
  const body = unwrapRemotePayload(raw);
  const source = sourceId(body.source, `${label}.source`);
  const version = safeInteger(body.version, `${label}.version`, 1);
  const errorCode = body.errorCode === null || body.errorCode === undefined ? null : sourceId(body.errorCode, `${label}.errorCode`);
  if (errorCode) sourceFailure("wecom_source_error", `企微来源读取失败：${errorCode}`, 502);
  if (typeof body.retryable !== "boolean") sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${label}.retryable`);
  const warnings = body.warnings === undefined ? [] : body.warnings;
  if (!Array.isArray(warnings) || warnings.some((warning) => typeof warning !== "string" || warning.length > 1_000)) {
    sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${label}.warnings`);
  }
  return {
    source,
    version,
    lastSyncedAt: typeof body.lastSyncedAt === "number" || typeof body.lastSyncedAt === "string" ? body.lastSyncedAt : null,
    warnings: warnings as string[],
    data: parseData(body.data),
    errorCode: null,
    retryable: body.retryable,
  };
}
function pageData<T>(value: unknown, label: string, parser: (entry: unknown, index: number) => T): WecomRemotePage<T> {
  const row = asRecord(value, `${label}.data`);
  if (!Array.isArray(row.records)) sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${label}.data.records`);
  const total = safeInteger(row.total, `${label}.data.total`);
  const nextCursor = row.nextCursor === null || row.nextCursor === undefined ? null : opaqueCursor(row.nextCursor, `${label}.data.nextCursor`);
  return { records: row.records.map(parser), total, nextCursor };
}
function parseDepartment(value: unknown, index: number): WecomDepartmentRecord {
  const row = asRecord(value, `departments.records[${index}]`);
  const leaders = row.leaderUserIds;
  if (!Array.isArray(leaders) || leaders.some((id) => typeof id !== "string" || !id.trim())) {
    sourceFailure("wecom_source_contract_invalid", "企微部门负责人字段无效");
  }
  if (typeof row.name !== "string" || !row.name.trim()) sourceFailure("wecom_source_contract_invalid", "企微部门名称无效");
  if (row.parentUnavailable !== true && row.parentUnavailable !== false) sourceFailure("wecom_source_contract_invalid", "企微部门 parentUnavailable 无效");
  return {
    id: sourceId(row.id, "department.id"),
    parentId: row.parentId === null || row.parentId === undefined ? null : sourceId(row.parentId, "department.parentId"),
    name: row.name,
    nameEn: typeof row.nameEn === "string" ? row.nameEn : null,
    sortOrder: typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder) ? row.sortOrder : null,
    leaderUserIds: leaders.map(String),
    syncedAt: typeof row.syncedAt === "number" || typeof row.syncedAt === "string" ? row.syncedAt : null,
    path: typeof row.path === "string" ? row.path : null,
    parentUnavailable: row.parentUnavailable,
  };
}
function parsePerson(value: unknown, index: number): WecomPersonRecord {
  const row = asRecord(value, `users.records[${index}]`);
  const leaders = row.directLeaderUserIds;
  const departments = row.departments;
  if (typeof row.userId !== "string" || !row.userId.trim() || typeof row.name !== "string" || !row.name.trim()) {
    sourceFailure("wecom_source_contract_invalid", "企微人员标识或名称无效");
  }
  if (!Array.isArray(leaders) || leaders.some((id) => typeof id !== "string" || !id.trim()) || !Array.isArray(departments)) {
    sourceFailure("wecom_source_contract_invalid", "企微人员关系字段无效");
  }
  return {
    userId: row.userId,
    name: row.name,
    position: typeof row.position === "string" ? row.position : null,
    mainDepartmentId: row.mainDepartmentId === null || row.mainDepartmentId === undefined ? null : sourceId(row.mainDepartmentId, "person.mainDepartmentId"),
    activationStatus: typeof row.activationStatus === "number" || typeof row.activationStatus === "string" ? row.activationStatus : null,
    directLeaderUserIds: leaders.map(String),
    syncedAt: typeof row.syncedAt === "number" || typeof row.syncedAt === "string" ? row.syncedAt : null,
    departments: departments.map((department, departmentIndex) => {
      const item = asRecord(department, `person.departments[${departmentIndex}]`);
      if (typeof item.isLeader !== "number" && typeof item.isLeader !== "boolean") {
        sourceFailure("wecom_source_contract_invalid", "企微人员部门负责人字段无效");
      }
      return {
        departmentId: sourceId(item.departmentId, "person.departmentId"),
        sortOrder: typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder) ? item.sortOrder : null,
        isLeader: item.isLeader as number | boolean,
        syncedAt: typeof item.syncedAt === "number" || typeof item.syncedAt === "string" ? item.syncedAt : null,
      };
    }),
  };
}
function parseSyncStatus(raw: Json): WecomSyncStatus {
  return remoteEnvelope(raw, "sync_status", (value) => {
    const row = asRecord(value, "sync_status.data");
    if (typeof row.initialized !== "boolean" || typeof row.queryEnabled !== "boolean") {
      sourceFailure("wecom_source_contract_invalid", "企微同步状态字段无效");
    }
    const batch = (value: unknown, field: string) => {
      if (value === null || value === undefined) return null;
      const item = asRecord(value, field);
      if (typeof item.status !== "string") sourceFailure("wecom_source_contract_invalid", `企微来源返回无效 ${field}.status`);
      return {
        ...(item.id === undefined ? {} : { id: item.id as string | number }),
        status: item.status,
        ...(typeof item.departmentCount === "number" ? { departmentCount: item.departmentCount } : {}),
        ...(typeof item.userCount === "number" ? { userCount: item.userCount } : {}),
        ...(typeof item.relationCount === "number" ? { relationCount: item.relationCount } : {}),
      };
    };
    return {
      initialized: row.initialized,
      queryEnabled: row.queryEnabled,
      publishedVersion: safeInteger(row.publishedVersion, "sync_status.data.publishedVersion", 1),
      publishedDepartmentBatchId: row.publishedDepartmentBatchId === null || row.publishedDepartmentBatchId === undefined ? null : sourceId(row.publishedDepartmentBatchId, "publishedDepartmentBatchId"),
      publishedUserBatchId: row.publishedUserBatchId === null || row.publishedUserBatchId === undefined ? null : sourceId(row.publishedUserBatchId, "publishedUserBatchId"),
      publishedDepartmentBatch: batch(row.publishedDepartmentBatch, "publishedDepartmentBatch"),
      publishedUserBatch: batch(row.publishedUserBatch, "publishedUserBatch"),
      publishedAt: typeof row.publishedAt === "number" || typeof row.publishedAt === "string" ? row.publishedAt : null,
    };
  });
}
function parseDepartmentPage(raw: Json): WecomRemoteEnvelope<WecomRemotePage<WecomDepartmentRecord>> {
  return remoteEnvelope(raw, "departments", (data) => pageData(data, "departments", parseDepartment));
}
function parsePersonPage(raw: Json): WecomRemoteEnvelope<WecomRemotePage<WecomPersonRecord>> {
  return remoteEnvelope(raw, "users", (data) => pageData(data, "users", parsePerson));
}

/** Resolve a real, published platform-sync assembly; never build a Host MCP client. */
export async function resolveWecomOntologyRuntimeBinding(db: Db = postgresPool()): Promise<WecomRuntimeBinding> {
  await ensureRuntimeSchema();
  const names = Object.values(wecomOntologyRuntimeTools);
  const result = await db.query<{
    skill_id: string; agent_skill_version: number; connector_config_version: number; connector_binding_version: number;
    tool_name: string; skill_tool_version: number; policy_version: number;
  }>(`SELECT ras.skill_id, ras.version AS agent_skill_version, rcc.version AS connector_config_version,
      rsc.version AS connector_binding_version, rst.tool_name, rst.version AS skill_tool_version, rtp.version AS policy_version
    FROM runtime_agent_skills ras
    JOIN managed_agents agent ON agent.id=ras.agent_id AND agent.status='published'
    JOIN skill_lifecycle lifecycle ON lifecycle.skill_id=ras.skill_id AND lifecycle.stage='published'
    JOIN connectors connector ON connector.id='wecom-mcp' AND connector.enabled=1
    JOIN runtime_connector_config rcc ON rcc.connector_id='wecom-mcp'
    JOIN runtime_skill_connectors rsc ON rsc.skill_id=ras.skill_id AND rsc.connector_id='wecom-mcp' AND rsc.enabled=1
    JOIN runtime_skill_tools rst ON rst.skill_id=ras.skill_id AND rst.connector_id='wecom-mcp' AND rst.enabled=1
    JOIN runtime_tool_policies rtp ON rtp.connector_id='wecom-mcp' AND rtp.tool_name=rst.tool_name
      AND rtp.enabled=1 AND rtp.risk='L1' AND rtp.access='read'
    WHERE ras.agent_id=$1 AND ras.enabled=1 AND rst.tool_name=ANY($2::text[])
    ORDER BY ras.skill_id,rst.tool_name`, [PLATFORM_SYNC_AGENT, names]);
  const bySkill = new Map<string, typeof result.rows>();
  for (const row of result.rows) bySkill.set(row.skill_id, [...(bySkill.get(row.skill_id) || []), row]);
  const matches = [...bySkill.entries()].filter(([, rows]) => new Set(rows.map((row) => row.tool_name)).size === names.length);
  if (matches.length !== 1) {
    sourceFailure("wecom_runtime_binding_required", "企微来源读取需要平台同步 Agent 已发布的只读 skill，并挂载 wecom-mcp.wecom_get_sync_status / wecom_list_departments / wecom_list_department_users；未使用 Host 直连绕过。", 503);
  }
  const [skillId, rows] = matches[0]!;
  const first = rows[0]!;
  const byName = new Map(rows.map((row) => [row.tool_name, row]));
  const tool = (name: string): BoundTool => {
    const row = byName.get(name);
    if (!row) sourceFailure("wecom_runtime_binding_required", "企微来源运行时工具挂载不完整", 503);
    return { skillTool: Number(row.skill_tool_version), policy: Number(row.policy_version) };
  };
  const bindingVersions = {
    agentSkill: Number(first.agent_skill_version),
    connectorConfig: Number(first.connector_config_version),
    connectorBinding: Number(first.connector_binding_version),
    tools: {
      syncStatus: tool(wecomOntologyRuntimeTools.syncStatus),
      departments: tool(wecomOntologyRuntimeTools.departments),
      users: tool(wecomOntologyRuntimeTools.users),
    },
  };
  return {
    executionPath: "platform-sync-skill",
    agentId: PLATFORM_SYNC_AGENT,
    skillId,
    connectorId: "wecom-mcp",
    tools: wecomOntologyRuntimeTools,
    bindingFingerprint: sha256({ executionPath: "platform-sync-skill", agentId: PLATFORM_SYNC_AGENT, skillId, connectorId: "wecom-mcp", bindingVersions }),
    bindingVersions,
  };
}

export const managedWecomOntologyRuntime: WecomOntologyRuntime = {
  async currentBinding() { return resolveWecomOntologyRuntimeBinding(); },
  async captureStatus() {
    const before = await resolveWecomOntologyRuntimeBinding();
    const raw = await runPlatformSkillTool(before.skillId, before.connectorId, before.tools.syncStatus, {});
    const after = await resolveWecomOntologyRuntimeBinding();
    if (after.bindingFingerprint !== before.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微来源读取期间运行时装配已变化，请重新预览", 409);
    }
    return { binding: after, syncStatus: parseSyncStatus(raw) };
  },
  async listDepartments(binding, args) {
    if ((await resolveWecomOntologyRuntimeBinding()).bindingFingerprint !== binding.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微来源读取期间运行时装配已变化，请重新预览", 409);
    }
    const raw = await runPlatformSkillTool(binding.skillId, binding.connectorId, binding.tools.departments, args);
    const after = await resolveWecomOntologyRuntimeBinding();
    if (after.bindingFingerprint !== binding.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微来源读取期间运行时装配已变化，请重新预览", 409);
    }
    return parseDepartmentPage(raw);
  },
  async listUsers(binding, args) {
    if ((await resolveWecomOntologyRuntimeBinding()).bindingFingerprint !== binding.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微来源读取期间运行时装配已变化，请重新预览", 409);
    }
    const raw = await runPlatformSkillTool(binding.skillId, binding.connectorId, binding.tools.users, args);
    const after = await resolveWecomOntologyRuntimeBinding();
    if (after.bindingFingerprint !== binding.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微来源读取期间运行时装配已变化，请重新预览", 409);
    }
    return parsePersonPage(raw);
  },
};

function checkPage<T>(page: WecomRemoteEnvelope<WecomRemotePage<T>>, expected: WecomSnapshotVersion, label: string): WecomRemotePage<T> {
  if (page.source !== expected.source || page.version !== expected.version) {
    sourceFailure("wecom_source_version_changed", `企微${label}分页期间来源版本变化，未保存部分预览`, 409);
  }
  if (!page.data) sourceFailure("wecom_source_contract_invalid", `企微${label}未返回分页数据`);
  return page.data;
}

async function collectPages<T>(
  read: (cursor?: string) => Promise<WecomRemoteEnvelope<WecomRemotePage<T>>>,
  expected: WecomSnapshotVersion,
  label: string,
  limit: number,
): Promise<{ records: T[]; warnings: string[] }> {
  let cursor: string | undefined;
  const cursors = new Set<string>();
  const records: T[] = [];
  const warnings: string[] = [];
  let expectedTotal: number | null = null;
  for (let pageNo = 0; pageNo < WECOM_ONTOLOGY_MAX_PAGES; pageNo += 1) {
    const response = await read(cursor);
    const data = checkPage(response, expected, label);
    if (expectedTotal !== null && data.total !== expectedTotal) {
      sourceFailure("wecom_source_pagination_incomplete", `企微${label}分页总数变化，未保存部分预览`, 502);
    }
    expectedTotal = data.total;
    if (data.total > limit || records.length + data.records.length > limit) {
      sourceFailure("wecom_preview_bounds_exceeded", `企微${label}数量超过单次预览上限 ${limit}，未保存部分预览`, 422);
    }
    records.push(...data.records);
    warnings.push(...(response.warnings || []));
    if (!data.nextCursor) {
      if (records.length !== data.total) {
        sourceFailure("wecom_source_pagination_incomplete", `企微${label}分页总数不一致，未保存部分预览`, 502);
      }
      return { records, warnings };
    }
    if (cursors.has(data.nextCursor)) sourceFailure("wecom_source_pagination_loop", `企微${label}分页游标循环，未保存部分预览`, 502);
    cursors.add(data.nextCursor);
    cursor = data.nextCursor;
  }
  sourceFailure("wecom_preview_bounds_exceeded", `企微${label}分页超过 ${WECOM_ONTOLOGY_MAX_PAGES} 页上限，未保存部分预览`, 422);
}

function rowCounts(rows: WecomSnapshotRow[]): Record<WecomSourceRecordKind, number> {
  return {
    department: rows.filter((row) => row.kind === "department").length,
    person: rows.filter((row) => row.kind === "person").length,
    membership: rows.filter((row) => row.kind === "membership").length,
  };
}

function createSnapshotRows(companyId: string, version: WecomSnapshotVersion, departments: WecomDepartmentRecord[], people: WecomPersonRecord[]): {
  rows: WecomSnapshotRow[]; rootDepartmentExternalIds: string[]; rootDepartmentUpstreamIds: string[]; warnings: WecomSourceWarning[];
} {
  const departmentById = new Map<string, WecomDepartmentRecord>();
  for (const department of departments) {
    const id = sourceId(department.id, "department.id");
    if (departmentById.has(id)) sourceFailure("wecom_duplicate_department_id", "企微来源返回重复部门 ID", 502);
    departmentById.set(id, department);
  }
  const roots = [...departmentById.values()].filter((department) => department.parentId === null || String(department.parentId).trim() === "" || String(department.parentId) === "0");
  if (!roots.length) sourceFailure("wecom_root_department_unresolved", "企微部门快照未提供当前根部门，未保存预览", 422);
  if (roots.length > 20) sourceFailure("wecom_root_department_bounds_exceeded", "企微根部门数超过单次预览上限，未保存预览", 422);
  const parentById = new Map<string, string | null>();
  const warnings: WecomSourceWarning[] = [];
  for (const [id, department] of departmentById) {
    const parent = department.parentId === null || String(department.parentId).trim() === "" || String(department.parentId) === "0"
      ? null : sourceId(department.parentId, "department.parentId");
    if (parent && !departmentById.has(parent)) {
      if (!department.parentUnavailable) sourceFailure("wecom_department_parent_missing", `企微部门 ${id} 的上级部门未出现在同一快照中，未保存预览`, 422);
      warnings.push({ code: "wecom_parent_unavailable", message: "部分部门上级未在来源快照中提供；未按姓名补全关系", detail: id });
      parentById.set(id, null);
    } else parentById.set(id, parent);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) sourceFailure("wecom_department_cycle", "企微部门层级包含循环，未保存预览", 422);
    visiting.add(id);
    const parent = parentById.get(id);
    if (parent) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of departmentById.keys()) visit(id);

  const departmentRef = (id: string) => externalId(companyId, version.source, "department", id);
  const personRef = (id: string) => externalId(companyId, version.source, "person", id);
  const sourceProperties = (externalRef: string, syncedAt: number | string | null) => ({
    wecom_source_ref: externalRef, wecom_source_version: version.version, wecom_synced_at: syncedAt,
  });
  const rows: WecomSnapshotRow[] = [];
  for (const [id, department] of departmentById) {
    const parent = parentById.get(id) || null;
    const ref = departmentRef(id);
    rows.push({
      externalId: ref, tenantId: companyId, source: WECOM_ONTOLOGY_SOURCE, kind: "department", objectCode: "org_unit", upstreamId: id,
      ontologyProperties: {
        wecom_department_id: sourceInteger(id, "department.id"), wecom_name: department.name, wecom_parent_id: department.parentId,
        wecom_sort_order: department.sortOrder, wecom_leader_user_ids: department.leaderUserIds,
        wecom_path: department.path, wecom_parent_unavailable: department.parentUnavailable,
        ...sourceProperties(ref, department.syncedAt),
      },
      attributes: {
        name: department.name, nameEn: department.nameEn, sortOrder: department.sortOrder,
        path: department.path, syncedAt: department.syncedAt, parentUnavailable: department.parentUnavailable,
      },
      relations: {
        ...(parent ? { wecom_parent: departmentRef(parent), parentDepartmentExternalId: departmentRef(parent) } : {}),
        wecom_leaders: department.leaderUserIds.map(personRef), leaderPersonExternalIds: department.leaderUserIds.map(personRef),
      },
    });
  }
  const peopleById = new Map<string, WecomPersonRecord>();
  for (const person of people) {
    const id = sourceId(person.userId, "person.userId");
    if (peopleById.has(id)) sourceFailure("wecom_duplicate_person_id", "企微来源返回重复人员 ID", 502);
    peopleById.set(id, person);
    const mainDepartmentId = person.mainDepartmentId === null ? null : sourceId(person.mainDepartmentId, "person.mainDepartmentId");
    if (mainDepartmentId && !departmentById.has(mainDepartmentId)) {
      sourceFailure("wecom_person_department_missing", `企微人员 ${id} 的主部门未出现在同一快照中，未保存预览`, 422);
    }
    const departmentIds = new Set<string>();
    const departmentMemberships = person.departments.map((membership) => {
      const departmentId = sourceId(membership.departmentId, "person.departments.departmentId");
      if (!departmentById.has(departmentId)) sourceFailure("wecom_person_department_missing", `企微人员 ${id} 的部门未出现在同一快照中，未保存预览`, 422);
      if (departmentIds.has(departmentId)) sourceFailure("wecom_duplicate_membership", "企微来源返回重复人员部门关系", 502);
      departmentIds.add(departmentId);
      return {
        departmentId: sourceInteger(departmentId, "person.departments.departmentId"),
        sortOrder: membership.sortOrder,
        isLeader: membership.isLeader,
        syncedAt: membership.syncedAt,
      };
    });
    if (mainDepartmentId && !departmentIds.has(mainDepartmentId)) {
      sourceFailure("wecom_main_department_relation_missing", `企微人员 ${id} 的主部门不在其部门关系中，未保存预览`, 422);
    }
    const ref = personRef(id);
    rows.push({
      externalId: ref, tenantId: companyId, source: WECOM_ONTOLOGY_SOURCE, kind: "person", objectCode: "user", upstreamId: id,
      // activationStatus is deliberately retained only as an upstream value;
      // no local person status, account, role or HR employment state is derived.
      ontologyProperties: {
        wecom_user_id: id, wecom_name: person.name, wecom_position_text: person.position,
        wecom_main_department_id: mainDepartmentId, wecom_activation_status: person.activationStatus,
        wecom_direct_leader_ids: person.directLeaderUserIds, wecom_departments: departmentMemberships,
        ...sourceProperties(ref, person.syncedAt),
      },
      attributes: { name: person.name, position: person.position, activationStatus: person.activationStatus, syncedAt: person.syncedAt },
      relations: {
        ...(mainDepartmentId ? { wecom_main_department: departmentRef(mainDepartmentId), mainDepartmentExternalId: departmentRef(mainDepartmentId) } : {}),
        wecom_member_departments: [...departmentIds].map(departmentRef), departmentExternalIds: [...departmentIds].map(departmentRef),
        wecom_direct_leaders: person.directLeaderUserIds.map(personRef), directLeaderPersonExternalIds: person.directLeaderUserIds.map(personRef),
      },
    });
    for (const membership of person.departments) {
      const departmentId = sourceId(membership.departmentId, "person.departments.departmentId");
      const membershipRef = externalId(companyId, version.source, "membership", `${id}:${departmentId}`);
      const isMain = mainDepartmentId === departmentId;
      rows.push({
        externalId: membershipRef, tenantId: companyId, source: WECOM_ONTOLOGY_SOURCE, kind: "membership", objectCode: "membership", upstreamId: `${id}:${departmentId}`,
        ontologyProperties: {
          wecom_member_user_id: id, wecom_department_id: departmentId, wecom_is_main: isMain,
          wecom_is_leader: membership.isLeader, wecom_membership_order: membership.sortOrder,
          wecom_position_text: person.position, ...sourceProperties(membershipRef, membership.syncedAt),
        },
        attributes: { sortOrder: membership.sortOrder, isLeader: membership.isLeader, syncedAt: membership.syncedAt },
        relations: {
          wecom_member: ref, wecom_organization: departmentRef(departmentId),
          personExternalId: ref, departmentExternalId: departmentRef(departmentId), role: isMain ? "main" : "collaborative",
        },
      });
    }
  }
  const rootDepartmentUpstreamIds = roots.map((root) => sourceId(root.id, "rootDepartment.id")).sort();
  return { rows, rootDepartmentExternalIds: rootDepartmentUpstreamIds.map(departmentRef), rootDepartmentUpstreamIds, warnings };
}
function validatePreviewRequest(input: WecomPreviewRequest): { companyId: string; pageSize: number; maxRows: number } {
  const companyId = nonEmpty(input.companyId, "companyId");
  const pageSize = input.pageSize === undefined ? WECOM_ONTOLOGY_DEFAULT_PAGE_SIZE : input.pageSize;
  const maxRows = input.maxRows === undefined ? WECOM_ONTOLOGY_DEFAULT_MAX_ROWS : input.maxRows;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > WECOM_ONTOLOGY_MAX_PAGE_SIZE) {
    throw new HttpFail(400, { code: "wecom_page_size_invalid", message: `pageSize 必须为 1–${WECOM_ONTOLOGY_MAX_PAGE_SIZE}` });
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > WECOM_ONTOLOGY_MAX_ROWS) {
    throw new HttpFail(400, { code: "wecom_max_rows_invalid", message: `maxRows 必须为 1–${WECOM_ONTOLOGY_MAX_ROWS}` });
  }
  return { companyId, pageSize, maxRows };
}

export class WecomOntologySourceService {
  constructor(private readonly actor: TicketPrincipal, private readonly runtime: WecomOntologyRuntime = managedWecomOntologyRuntime) {}

  private async assertCompanyAdmin(companyId: string, db: Db = postgresPool()): Promise<void> {
    if (!this.actor.active) throw new HttpFail(403, { code: "wecom_account_inactive", message: "工作台账号已停用" });
    const activeAt = now();
    const result = await db.query<{ allowed: boolean }>(`SELECT EXISTS(
      SELECT 1 FROM organization_people person
      JOIN users user_account ON user_account.id=person.user_id AND user_account.active=1
      JOIN organization_memberships membership ON membership.person_ref=person.person_ref
      JOIN organization_units unit ON unit.id=membership.org_unit_id AND unit.company_id=membership.company_id
      WHERE person.user_id=$1 AND person.status='active' AND membership.company_id=$2 AND membership.status='active'
        AND unit.status='active' AND (membership.effective_from IS NULL OR membership.effective_from<=$3)
        AND (membership.effective_to IS NULL OR membership.effective_to>$3)
        AND (user_account.roles::jsonb ? 'admin' OR user_account.roles::jsonb ? 'company_admin')
    ) AS allowed`, [this.actor.id, companyId, activeAt]);
    if (!result.rows[0]?.allowed) {
      throw new HttpFail(403, { code: "wecom_company_admin_required", message: "仅当前具有有效公司组织范围的公司管理员可管理企微本体来源" });
    }
  }

  /** The shared connector is bound once to an explicit company; membership alone is insufficient. */
  private async assertSourceCompanyBinding(companyId: string, db: Db = postgresPool()): Promise<void> {
    const binding = await db.query<{ company_id: string; connector_id: string }>(
      "SELECT company_id,connector_id FROM ontology_wecom_source_bindings WHERE source=$1",
      [WECOM_ONTOLOGY_SOURCE],
    );
    const row = binding.rows[0];
    if (!row || row.connector_id !== "wecom-mcp") {
      throw new HttpFail(503, { code: "wecom_source_binding_required", message: "企微来源尚未经发布流程绑定到明确公司" });
    }
    if (row.company_id !== companyId) {
      throw new HttpFail(403, { code: "wecom_source_company_mismatch", message: "当前公司不是该企微来源已绑定的公司" });
    }
  }

  private async assertAccess(companyId: string, db: Db = postgresPool()): Promise<void> {
    await this.assertCompanyAdmin(companyId, db);
    await this.assertSourceCompanyBinding(companyId, db);
  }

  async status(companyIdInput: string): Promise<WecomStatusResponse> {
    const companyId = nonEmpty(companyIdInput, "companyId");
    await this.assertAccess(companyId);
    const { binding, syncStatus } = await this.runtime.captureStatus();
    sourceVersion(syncStatus);
    return {
      source: WECOM_ONTOLOGY_SOURCE,
      companyId,
      scope: { explicitCompanyScope: true, requiredRole: "company_admin" },
      runtimeBinding: binding,
      syncStatus,
      fieldBindings: wecomOntologyFieldBindings,
      objectMappings: wecomOntologyObjectMappings,
      importContract: {
        mode: "confirmed_snapshot_only",
        doesNotWrite: ["organization_units", "organization_people", "organization_memberships", "users", "agent_bindings"],
        hrStatus: "not_inferred",
      },
    };
  }

  async preview(input: WecomPreviewRequest): Promise<WecomPreviewResponse> {
    const { companyId, pageSize, maxRows } = validatePreviewRequest(input);
    await this.assertAccess(companyId);
    const started = Date.now();
    const initial = await this.runtime.captureStatus();
    const version = sourceVersion(initial.syncStatus);
    const timeoutCheck = () => {
      if (Date.now() - started > 90_000) sourceFailure("wecom_preview_timeout", "企微预览超过读取时间上限，未保存部分预览", 503);
    };
    const departments = await collectPages(async (cursor) => {
      timeoutCheck();
      return this.runtime.listDepartments(initial.binding, { pageSize, ...(cursor ? { cursor } : {}) });
    }, version, "部门", maxRows);
    timeoutCheck();
    // Roots come from this complete source page (parentId=0/null), never from a
    // company name and never from a hard-coded department id. Multi-root tenants
    // are read once per root; duplicate user IDs must describe identical evidence.
    const departmentGraph = createSnapshotRows(companyId, version, departments.records, []);
    const peopleById = new Map<string, WecomPersonRecord>();
    const peopleWarnings: string[] = [];
    let fetchedPeople = 0;
    for (const rootDepartmentId of departmentGraph.rootDepartmentUpstreamIds) {
      const page = await collectPages(async (cursor) => {
        timeoutCheck();
        return this.runtime.listUsers(initial.binding, { departmentId: sourceInteger(rootDepartmentId, "rootDepartment.id"), includeDescendants: true, pageSize, ...(cursor ? { cursor } : {}) });
      }, version, "人员", maxRows);
      fetchedPeople += page.records.length;
      if (fetchedPeople > maxRows) sourceFailure("wecom_preview_bounds_exceeded", `企微人员数量超过单次预览上限 ${maxRows}，未保存部分预览`, 422);
      peopleWarnings.push(...page.warnings);
      for (const person of page.records) {
        const id = sourceId(person.userId, "person.userId");
        const prior = peopleById.get(id);
        if (prior && canonical(prior) !== canonical(person)) {
          sourceFailure("wecom_cross_root_person_conflict", `企微人员 ${id} 在多个根部门返回冲突内容，未保存预览`, 502);
        }
        peopleById.set(id, person);
      }
    }
    const people = { records: [...peopleById.values()], warnings: peopleWarnings };
    timeoutCheck();
    const final = await this.runtime.captureStatus();
    const finalVersion = sourceVersion(final.syncStatus);
    if (initial.binding.bindingFingerprint !== final.binding.bindingFingerprint) {
      sourceFailure("wecom_runtime_binding_changed", "企微预览期间运行时装配已变化，未保存预览", 409);
    }
    if (!sameSourceVersion(version, finalVersion)) {
      sourceFailure("wecom_source_version_changed", "企微预览期间发布批次或版本已变化，未保存预览", 409);
    }
    const generated = createSnapshotRows(companyId, version, departments.records, people.records);
    const sourceWarnings = [...departments.warnings, ...people.warnings].map((message) => ({ code: "wecom_source_warning", message }));
    const warnings = [...sourceWarnings, ...generated.warnings];
    const counts = rowCounts(generated.rows);
    if (generated.rows.length > maxRows) sourceFailure("wecom_preview_bounds_exceeded", `企微快照行数超过单次预览上限 ${maxRows}，未保存部分预览`, 422);
    const contentHash = sha256({ companyId, sourceVersion: version, rootDepartmentExternalIds: generated.rootDepartmentExternalIds, rows: generated.rows });
    const previewToken = randomUUID();
    const expiresAt = new Date(Date.now() + WECOM_ONTOLOGY_PREVIEW_TTL_MS).toISOString();
    // All provider pages and integrity checks have succeeded. This single insert is
    // the first database write; failures before this point leave no partial preview.
    await postgresTransaction(async (db) => {
      await this.assertAccess(companyId, db);
      await db.query(`INSERT INTO ontology_wecom_source_previews
        (id,company_id,actor_id,content_hash,binding_fingerprint,source_version_json,root_department_external_ids,payload,expires_at,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        previewToken, companyId, this.actor.id, contentHash, initial.binding.bindingFingerprint, JSON.stringify(version),
        JSON.stringify(generated.rootDepartmentExternalIds), JSON.stringify({ rows: generated.rows, counts, warnings }), expiresAt, now(),
      ]);
    });
    return {
      previewToken, companyId, expiresAt, contentHash, bindingFingerprint: initial.binding.bindingFingerprint,
      sourceVersion: version, rootDepartmentExternalIds: generated.rootDepartmentExternalIds, rows: generated.rows, counts, warnings, complete: true,
    };
  }

  private commandHash(input: WecomCommitRequest): string {
    return sha256({ previewToken: input.previewToken, contentHash: input.contentHash, confirmed: input.confirmed, reason: input.reason });
  }

  private async storedReceipt(companyId: string, commandId: string, commandHash: string): Promise<WecomCommitReceipt | null> {
    const found = await postgresPool().query<{ command_hash: string; receipt: WecomCommitReceipt }>(
      "SELECT command_hash,receipt FROM ontology_wecom_source_receipts WHERE company_id=$1 AND actor_id=$2 AND command_id=$3",
      [companyId, this.actor.id, commandId],
    );
    const row = found.rows[0];
    if (!row) return null;
    if (row.command_hash !== commandHash) {
      throw new HttpFail(409, { code: "wecom_idempotency_content_mismatch", message: "幂等标识不能用于不同导入内容" });
    }
    return { ...row.receipt, replayed: true };
  }

  async commit(input: WecomCommitRequest): Promise<WecomCommitReceipt> {
    const companyId = nonEmpty(input.companyId, "companyId");
    const previewToken = nonEmpty(input.previewToken, "previewToken");
    const contentHash = nonEmpty(input.contentHash, "contentHash", 100);
    const commandId = nonEmpty(input.commandId, "commandId");
    const reason = nonEmpty(input.reason, "reason", 2_000);
    if (!/^sha256:[a-f0-9]{64}$/.test(contentHash) || input.confirmed !== true) {
      throw new HttpFail(409, { code: "wecom_confirmation_required", message: "导入必须提交 confirmed=true、预览标识和匹配内容摘要" });
    }
    await this.assertAccess(companyId);
    const commandHash = this.commandHash({ companyId, previewToken, contentHash, commandId, reason, confirmed: true });
    // A replay has no remote read or new write, but cannot bypass a revoked
    // connector, skill lifecycle state, or runtime assembly.
    await this.runtime.currentBinding();
    const existing = await this.storedReceipt(companyId, commandId, commandHash);
    if (existing) return existing;

    // Re-read the remote publication only through the mounted platform-sync skill
    // before any snapshot write. An unavailable/revoked runtime fails closed.
    const current = await this.runtime.captureStatus();
    const currentVersion = sourceVersion(current.syncStatus);
    return postgresTransaction(async (db) => {
      await this.assertAccess(companyId, db);
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["wecom-ontology-command", companyId, this.actor.id, commandId])]);
      const replay = await db.query<{ command_hash: string; receipt: WecomCommitReceipt }>(
        "SELECT command_hash,receipt FROM ontology_wecom_source_receipts WHERE company_id=$1 AND actor_id=$2 AND command_id=$3 FOR UPDATE",
        [companyId, this.actor.id, commandId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].command_hash !== commandHash) {
          throw new HttpFail(409, { code: "wecom_idempotency_content_mismatch", message: "幂等标识不能用于不同导入内容" });
        }
        return { ...replay.rows[0].receipt, replayed: true };
      }
      const previewResult = await db.query<PreviewRow>(
        "SELECT * FROM ontology_wecom_source_previews WHERE id=$1 AND company_id=$2 AND actor_id=$3 FOR UPDATE",
        [previewToken, companyId, this.actor.id],
      );
      const preview = previewResult.rows[0];
      if (!preview || preview.consumed_at || preview.expires_at <= now()) {
        throw new HttpFail(409, { code: "wecom_preview_expired", message: "企微预览已过期或已使用，请重新读取预览" });
      }
      if (preview.content_hash !== contentHash) {
        throw new HttpFail(409, { code: "wecom_preview_content_mismatch", message: "确认内容与预览内容不一致，请重新预览" });
      }
      if (preview.binding_fingerprint !== current.binding.bindingFingerprint) {
        throw new HttpFail(409, { code: "wecom_runtime_binding_changed", message: "企微连接配置或 skill 装配已变化，请重新预览" });
      }
      if (!sameSourceVersion(preview.source_version_json, currentVersion)) {
        throw new HttpFail(409, { code: "wecom_source_version_changed", message: "企微数据版本或发布批次已变化，请重新预览" });
      }
      const rows = preview.payload?.rows;
      if (!Array.isArray(rows) || rows.length > WECOM_ONTOLOGY_MAX_ROWS * 3 || rows.some((row) => !sourceKinds.has(row.kind))) {
        sourceFailure("wecom_preview_corrupt", "已保存的企微预览无法校验，未导入", 409);
      }
      const recomputedContentHash = sha256({
        companyId,
        sourceVersion: preview.source_version_json,
        rootDepartmentExternalIds: preview.root_department_external_ids,
        rows,
      });
      if (recomputedContentHash !== preview.content_hash) {
        sourceFailure("wecom_preview_corrupt", "已保存的企微预览内容摘要不一致，未导入", 409);
      }
      const snapshotId = randomUUID();
      const createdAt = now();
      await db.query(`INSERT INTO ontology_wecom_source_snapshots
        (id,company_id,source,source_version_json,content_hash,binding_fingerprint,root_department_external_ids,imported_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        snapshotId, companyId, WECOM_ONTOLOGY_SOURCE, JSON.stringify(preview.source_version_json), preview.content_hash,
        preview.binding_fingerprint, JSON.stringify(preview.root_department_external_ids), this.actor.id, createdAt,
      ]);
      for (const row of rows) {
        await db.query(`INSERT INTO ontology_wecom_source_external_refs
          (snapshot_id,company_id,source,kind,object_code,external_id,upstream_id,ontology_properties,attributes,relations,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          snapshotId, companyId, WECOM_ONTOLOGY_SOURCE, row.kind, row.objectCode, row.externalId, row.upstreamId,
          JSON.stringify(row.ontologyProperties), JSON.stringify(row.attributes), JSON.stringify(row.relations), createdAt,
        ]);
      }
      await db.query("UPDATE ontology_wecom_source_previews SET consumed_at=$1 WHERE id=$2", [createdAt, previewToken]);
      const receipt: WecomCommitReceipt = {
        receiptId: randomUUID(), snapshotId, companyId, source: WECOM_ONTOLOGY_SOURCE,
        sourceVersion: preview.source_version_json, contentHash: preview.content_hash, reason,
        rowCounts: preview.payload.counts, createdAt,
      };
      await db.query(`INSERT INTO ontology_wecom_source_receipts
        (company_id,actor_id,command_id,command_hash,receipt,created_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [companyId, this.actor.id, commandId, commandHash, JSON.stringify(receipt), createdAt]);
      return receipt;
    });
  }

  /** Read only the caller's own import receipt after current access and binding checks. */
  async receipt(companyIdInput: string, commandIdInput: string): Promise<{ receipt: WecomCommitReceipt | null }> {
    const companyId = nonEmpty(companyIdInput, "companyId");
    const commandId = nonEmpty(commandIdInput, "commandId");
    await this.assertAccess(companyId);
    await this.runtime.currentBinding();
    const found = await postgresPool().query<{ receipt: WecomCommitReceipt }>(
      "SELECT receipt FROM ontology_wecom_source_receipts WHERE company_id=$1 AND actor_id=$2 AND command_id=$3",
      [companyId, this.actor.id, commandId],
    );
    return { receipt: found.rows[0]?.receipt || null };
  }

  async snapshot(input: { companyId: string; snapshotId?: string; kind?: string; cursor?: string; pageSize?: string | number }): Promise<WecomSnapshotPage> {
    const companyId = nonEmpty(input.companyId, "companyId");
    await this.assertAccess(companyId);
    await this.runtime.currentBinding();
    const pageSizeValue = input.pageSize === undefined ? WECOM_ONTOLOGY_DEFAULT_PAGE_SIZE : Number(input.pageSize);
    if (!Number.isSafeInteger(pageSizeValue) || pageSizeValue < 1 || pageSizeValue > WECOM_ONTOLOGY_MAX_PAGE_SIZE) {
      throw new HttpFail(400, { code: "wecom_page_size_invalid", message: `pageSize 必须为 1–${WECOM_ONTOLOGY_MAX_PAGE_SIZE}` });
    }
    const kind = input.kind === undefined || input.kind === "" ? null : input.kind;
    if (kind !== null && !sourceKinds.has(kind as WecomSourceRecordKind)) {
      throw new HttpFail(400, { code: "wecom_snapshot_kind_invalid", message: "kind 必须为 department、person 或 membership" });
    }
    let cursor: SnapshotCursor | null = null;
    if (input.cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as Record<string, unknown>;
        const kindValue = parsed?.kind;
        if (!parsed || typeof parsed.snapshotId !== "string"
          || (kindValue !== null && (typeof kindValue !== "string" || !sourceKinds.has(kindValue as WecomSourceRecordKind)))
          || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error("invalid");
        cursor = { snapshotId: parsed.snapshotId, kind: kindValue === null ? null : kindValue as WecomSourceRecordKind, offset: Number(parsed.offset) };
      } catch {
        throw new HttpFail(400, { code: "wecom_snapshot_cursor_invalid", message: "snapshot cursor 无效" });
      }
    }
    const requestedSnapshotId = nonEmpty(input.snapshotId || cursor?.snapshotId || "latest", "snapshotId");
    if (cursor && (cursor.snapshotId !== requestedSnapshotId || cursor.kind !== kind)) {
      throw new HttpFail(409, { code: "wecom_snapshot_cursor_scope_mismatch", message: "分页游标与当前快照或类型不一致" });
    }
    const snapshot = requestedSnapshotId === "latest"
      ? (await postgresPool().query<SnapshotRow>("SELECT * FROM ontology_wecom_source_snapshots WHERE company_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [companyId])).rows[0]
      : (await postgresPool().query<SnapshotRow>("SELECT * FROM ontology_wecom_source_snapshots WHERE id=$1 AND company_id=$2", [requestedSnapshotId, companyId])).rows[0];
    if (!snapshot) throw new HttpFail(404, { code: "wecom_snapshot_not_found", message: "未找到该公司可见的企微本体快照" });
    const offset = cursor?.offset || 0;
    const result = await postgresPool().query<{
      kind: WecomSourceRecordKind; object_code: WecomOntologyObjectCode; external_id: string; upstream_id: string; ontology_properties: Record<string, unknown>; attributes: Record<string, unknown>; relations: Record<string, unknown>;
    }>(`SELECT kind,object_code,external_id,upstream_id,ontology_properties,attributes,relations FROM ontology_wecom_source_external_refs
       WHERE snapshot_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY kind,external_id LIMIT $3 OFFSET $4`,
      [snapshot.id, kind, pageSizeValue + 1, offset]);
    const selected = result.rows.slice(0, pageSizeValue);
    const rows: WecomSnapshotRow[] = selected.map((row) => ({
      externalId: row.external_id, tenantId: snapshot.company_id, source: WECOM_ONTOLOGY_SOURCE,
      kind: row.kind, objectCode: row.object_code, upstreamId: row.upstream_id, ontologyProperties: row.ontology_properties, attributes: row.attributes, relations: row.relations,
    }));
    const nextCursor = result.rows.length > pageSizeValue
      ? Buffer.from(JSON.stringify({ snapshotId: snapshot.id, kind, offset: offset + pageSizeValue })).toString("base64url") : null;
    return {
      tableVersion: WECOM_ONTOLOGY_SNAPSHOT_TABLE_VERSION, snapshotId: snapshot.id, companyId: snapshot.company_id,
      sourceVersion: snapshot.source_version_json, rootDepartmentExternalIds: snapshot.root_department_external_ids,
      rows, nextCursor, pageSize: pageSizeValue, kind: kind as WecomSourceRecordKind | null,
    };
  }
}
