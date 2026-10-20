/**
 * Shared contract for the company-scoped WeCom organizational-directory source.
 *
 * This source is an imported, versioned ontology snapshot only. It never creates
 * or updates application organization units, people, memberships, user accounts,
 * roles, Agent bindings, or HR employment state.
 */

export const WECOM_ONTOLOGY_SOURCE = "wecom" as const;
export const WECOM_ONTOLOGY_SNAPSHOT_TABLE_VERSION = "wecom-ontology-source-snapshot.v1" as const;
export const WECOM_ONTOLOGY_PREVIEW_TTL_MS = 5 * 60_000;
export const WECOM_ONTOLOGY_DEFAULT_PAGE_SIZE = 200;
export const WECOM_ONTOLOGY_MAX_PAGE_SIZE = 200;
export const WECOM_ONTOLOGY_DEFAULT_MAX_ROWS = 1_000;
export const WECOM_ONTOLOGY_MAX_ROWS = 1_000;
export const WECOM_ONTOLOGY_MAX_PAGES = 10;

export const wecomOntologyUrls = {
  status: "/api/ontology/workspace/wecom/status",
  preview: "/api/ontology/workspace/wecom/preview",
  commit: "/api/ontology/workspace/wecom/commit",
  snapshot: "/api/ontology/workspace/wecom/snapshot",
} as const;

/** The remote WeCom MCP tools must be registered/mounted to the platform sync Agent. */
export const wecomOntologyRuntimeTools = {
  syncStatus: "wecom_get_sync_status",
  departments: "wecom_list_departments",
  users: "wecom_list_department_users",
} as const;

export type WecomSourceRecordKind = "department" | "person" | "membership";
export type WecomOntologyObjectCode = "org_unit" | "user" | "membership";
export type WecomSourceWarning = {
  code: string;
  message: string;
  detail?: string;
};

/**
 * These are source-field bindings, not an HR mapping. In particular,
 * `activationStatus` is preserved as an upstream raw value and never changes a
 * local person's active/left status.
 */
export const wecomOntologyFieldBindings = [
  { kind: "department", sourceField: "id", target: "external_id", meaning: "公司与来源范围内的稳定外部引用" },
  { kind: "department", sourceField: "parentId", target: "parent_external_id", meaning: "来源部门上下级证据" },
  { kind: "department", sourceField: "leaderUserIds", target: "leader_person_external_ids", meaning: "来源部门负责人引用，不授予平台权限" },
  { kind: "department", sourceField: "name/nameEn/sortOrder/path/syncedAt", target: "attributes", meaning: "保留来源名称、显示顺序、路径及采集时间" },
  { kind: "person", sourceField: "userId", target: "external_id", meaning: "公司与来源范围内的稳定外部引用" },
  { kind: "person", sourceField: "name/position", target: "attributes", meaning: "通讯录姓名和职位原文，不按姓名合并" },
  { kind: "person", sourceField: "activationStatus", target: "attributes.activationStatus", meaning: "仅保留企业微信激活状态，不作为HR任职状态" },
  { kind: "person", sourceField: "mainDepartmentId", target: "membership.main", meaning: "来源主部门关系，不调整平台主组织" },
  { kind: "person", sourceField: "departments[]", target: "membership.collaborative", meaning: "来源可见部门及协作归属关系" },
  { kind: "person", sourceField: "directLeaderUserIds", target: "direct_leader_external_ids", meaning: "来源直接上级引用，不自动推断审批链" },
] as const;
export type WecomOntologyFieldBinding = typeof wecomOntologyFieldBindings[number];

/** The persisted source rows project these exact registered fields for panel/table display. */
export const wecomOntologyObjectMappings = [
  {
    kind: "department", objectCode: "org_unit",
    properties: ["wecom_department_id", "wecom_name", "wecom_parent_id", "wecom_sort_order", "wecom_leader_user_ids", "wecom_path", "wecom_parent_unavailable", "wecom_source_ref", "wecom_source_version", "wecom_synced_at"],
    relations: ["wecom_parent", "wecom_children", "wecom_members", "wecom_leaders"],
  },
  {
    kind: "person", objectCode: "user",
    properties: ["wecom_user_id", "wecom_name", "wecom_position_text", "wecom_main_department_id", "wecom_activation_status", "wecom_direct_leader_ids", "wecom_departments", "wecom_source_ref", "wecom_source_version", "wecom_synced_at"],
    relations: ["wecom_member_departments", "wecom_main_department", "wecom_direct_leaders", "wecom_direct_reports"],
  },
  {
    kind: "membership", objectCode: "membership",
    properties: ["wecom_member_user_id", "wecom_department_id", "wecom_is_main", "wecom_is_leader", "wecom_membership_order", "wecom_position_text", "wecom_source_ref", "wecom_source_version", "wecom_synced_at"],
    relations: ["wecom_member", "wecom_organization"],
  },
] as const;
export type WecomOntologyObjectMapping = typeof wecomOntologyObjectMappings[number];

export type WecomRemoteEnvelope<T> = {
  source: string;
  version: number;
  lastSyncedAt: number | string | null;
  warnings?: string[];
  data: T | null;
  errorCode: string | null;
  retryable: boolean;
};

export type WecomPublishedBatch = {
  id?: string | number;
  status: "SUCCESS" | string;
  departmentCount?: number;
  userCount?: number;
  relationCount?: number;
};

export type WecomSyncStatusData = {
  initialized: boolean;
  queryEnabled: boolean;
  publishedVersion: number;
  publishedDepartmentBatchId: string | number | null;
  publishedUserBatchId: string | number | null;
  publishedDepartmentBatch: WecomPublishedBatch | null;
  publishedUserBatch: WecomPublishedBatch | null;
  publishedAt?: number | string | null;
};
export type WecomSyncStatus = WecomRemoteEnvelope<WecomSyncStatusData>;

export type WecomRemotePage<T> = {
  records: T[];
  total: number;
  nextCursor: string | null;
};

export type WecomDepartmentRecord = {
  id: string | number;
  parentId: string | number | null;
  name: string;
  nameEn: string | null;
  sortOrder: number | null;
  leaderUserIds: string[];
  syncedAt: number | string | null;
  path: string | null;
  parentUnavailable: boolean;
};

export type WecomPersonDepartment = {
  departmentId: string | number;
  sortOrder: number | null;
  isLeader: number | boolean;
  syncedAt: number | string | null;
};

export type WecomPersonRecord = {
  userId: string;
  name: string;
  position: string | null;
  mainDepartmentId: string | number | null;
  activationStatus: number | string | null;
  directLeaderUserIds: string[];
  syncedAt: number | string | null;
  departments: WecomPersonDepartment[];
};

export type WecomRuntimeBinding = {
  executionPath: "platform-sync-skill";
  agentId: "agent:platform-sync";
  skillId: string;
  connectorId: "wecom-mcp";
  tools: typeof wecomOntologyRuntimeTools;
  bindingFingerprint: string;
  /** Versions are identifiers only; no connector address or credential reference is returned. */
  bindingVersions: {
    agentSkill: number;
    connectorConfig: number;
    connectorBinding: number;
    tools: Record<keyof typeof wecomOntologyRuntimeTools, { skillTool: number; policy: number }>;
  };
};

export type WecomSnapshotVersion = {
  source: string;
  version: number;
  departmentBatchId: string;
  userBatchId: string;
  publishedAt: number | string | null;
  lastSyncedAt: number | string | null;
};

export type WecomExternalReference = {
  externalId: string;
  tenantId: string;
  source: typeof WECOM_ONTOLOGY_SOURCE;
  kind: WecomSourceRecordKind;
  upstreamId: string;
};

export type WecomSnapshotRow = WecomExternalReference & {
  objectCode: WecomOntologyObjectCode;
  /** Registered WeCom properties, projected for the ontology panel; never only opaque JSON. */
  ontologyProperties: Record<string, unknown>;
  attributes: Record<string, unknown>;
  /** Observed references only; unresolved source IDs are not name-matched. */
  relations: Record<string, unknown>;
};

export type WecomPreviewRequest = {
  /** Required: a caller must choose a company instead of receiving an implicit default. */
  companyId: string;
  pageSize?: number;
  maxRows?: number;
};

export type WecomPreviewResponse = {
  previewToken: string;
  companyId: string;
  expiresAt: string;
  contentHash: string;
  bindingFingerprint: string;
  sourceVersion: WecomSnapshotVersion;
  rootDepartmentExternalIds: string[];
  rows: WecomSnapshotRow[];
  counts: Record<WecomSourceRecordKind, number>;
  warnings: WecomSourceWarning[];
  complete: true;
};

export type WecomCommitRequest = {
  companyId: string;
  confirmed: true;
  previewToken: string;
  contentHash: string;
  /** Stable caller-generated key; reusing it with other content is rejected. */
  commandId: string;
  /** Required human reason retained in the import receipt; it is not an HR assertion. */
  reason: string;
};

export type WecomCommitReceipt = {
  receiptId: string;
  snapshotId: string;
  companyId: string;
  source: typeof WECOM_ONTOLOGY_SOURCE;
  sourceVersion: WecomSnapshotVersion;
  contentHash: string;
  reason: string;
  rowCounts: Record<WecomSourceRecordKind, number>;
  createdAt: string;
  replayed?: boolean;
};

export type WecomStatusResponse = {
  source: typeof WECOM_ONTOLOGY_SOURCE;
  companyId: string;
  scope: { explicitCompanyScope: true; requiredRole: "company_admin" };
  runtimeBinding: WecomRuntimeBinding;
  syncStatus: WecomSyncStatus;
  fieldBindings: readonly WecomOntologyFieldBinding[];
  objectMappings: readonly WecomOntologyObjectMapping[];
  importContract: {
    mode: "confirmed_snapshot_only";
    doesNotWrite: readonly ["organization_units", "organization_people", "organization_memberships", "users", "agent_bindings"];
    hrStatus: "not_inferred";
  };
};

export type WecomSnapshotPage = {
  tableVersion: typeof WECOM_ONTOLOGY_SNAPSHOT_TABLE_VERSION;
  snapshotId: string;
  companyId: string;
  sourceVersion: WecomSnapshotVersion;
  rootDepartmentExternalIds: string[];
  rows: WecomSnapshotRow[];
  nextCursor: string | null;
  pageSize: number;
  kind: WecomSourceRecordKind | null;
};
