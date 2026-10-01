import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConn, nowIso, type SqliteConn } from "./db.js";
import { nid } from "./ids.js";
import { MAIN_STAGES } from "./stages.js";
import type { Json, Row } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type BusinessActorType = "human" | "agent" | "system" | "external";

export type BusinessEventInput = {
  eventType: string;
  objectType: string;
  objectId: string;
  occurredAt?: string;
  receivedAt?: string;
  source: string;
  sourceVersion?: string | null;
  actorType: BusinessActorType;
  actorId?: string | null;
  actionRef?: string | null;
  payload?: unknown;
  evidence?: unknown;
  receipt?: unknown;
  diff?: unknown;
  idempotencyKey?: string | null;
  correlationId?: string | null;
};

type CatalogEntry = {
  code: string;
  name: string;
  category: string;
  object_type: string;
  status: string;
  carrier?: string;
  source_ref?: string;
};

type CatalogCache = { file: string; mtime: number; codes: Set<string>; events: CatalogEntry[] };

let cached: CatalogCache | null = null;
const warned = new Set<string>();

export function eventCatalogPath(): string {
  return process.env.EVENT_CATALOG_PATH || path.join(repoRoot, "config", "event-catalog.yaml");
}

export function resetEventCatalogCache(): void {
  cached = null;
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[business-events] ${message}`);
}

export function loadEventCatalog(options: { refresh?: boolean } = {}): { codes: Set<string>; events: CatalogEntry[] } | null {
  const file = eventCatalogPath();
  if (!fs.existsSync(file)) {
    warnOnce("missing", `事件目录不存在：${file}（写入跳过白名单校验）`);
    return null;
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (!options.refresh && cached && cached.file === file && cached.mtime === mtime) {
    return { codes: cached.codes, events: cached.events };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { events?: CatalogEntry[] };
    const events = Array.isArray(raw.events) ? raw.events : [];
    const codes = new Set(events.map((event) => String(event.code)));
    cached = { file, mtime, codes, events };
    return { codes, events };
  } catch (error) {
    warnOnce("invalid", `事件目录解析失败：${file}：${(error as Error).message}（写入跳过白名单校验）`);
    return null;
  }
}

function parseJsonColumn(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function appendBusinessEvent(
  input: BusinessEventInput,
  options: { conn?: SqliteConn; strict?: boolean } = {},
): { id: string; inserted: boolean } {
  const catalog = loadEventCatalog();
  if (catalog && !catalog.codes.has(input.eventType)) {
    const message = `未登记的事件类型：${input.eventType}（目录 ${eventCatalogPath()}）`;
    if (options.strict) throw new Error(message);
    warnOnce(`unknown:${input.eventType}`, message);
  }
  const conn = options.conn || getConn();
  const id = nid("evt");
  const result = conn.prepare(
    `INSERT OR IGNORE INTO business_events
     (id,event_type,object_type,object_id,occurred_at,received_at,source,source_version,actor_type,actor_id,action_ref,
      payload,evidence,receipt,diff,idempotency_key,correlation_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.eventType,
    input.objectType,
    input.objectId,
    input.occurredAt || nowIso(),
    input.receivedAt || nowIso(),
    input.source,
    input.sourceVersion ?? null,
    input.actorType,
    input.actorId ?? null,
    input.actionRef ?? null,
    JSON.stringify(input.payload ?? {}),
    JSON.stringify(input.evidence ?? {}),
    input.receipt === undefined || input.receipt === null ? null : JSON.stringify(input.receipt),
    input.diff === undefined || input.diff === null ? null : JSON.stringify(input.diff),
    input.idempotencyKey ?? null,
    input.correlationId ?? null,
    nowIso(),
  );
  return { id, inserted: result.changes === 1 };
}

export function listBusinessEvents(filters: {
  objectType?: string;
  objectId?: string;
  eventType?: string;
  before?: string;
  limit?: number;
} = {}): Json[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.objectType) {
    clauses.push("object_type=?");
    values.push(filters.objectType);
  }
  if (filters.objectId) {
    clauses.push("object_id=?");
    values.push(filters.objectId);
  }
  if (filters.eventType) {
    clauses.push("event_type=?");
    values.push(filters.eventType);
  }
  if (filters.before) {
    clauses.push("created_at < ?");
    values.push(filters.before);
  }
  const limit = Math.min(Math.max(1, Math.floor(filters.limit ?? 50)), 200);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getConn().prepare(
    `SELECT * FROM business_events ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
  ).all(...values, limit) as Row[];
  return rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    object_type: row.object_type,
    object_id: row.object_id,
    occurred_at: row.occurred_at,
    received_at: row.received_at,
    source: row.source,
    source_version: row.source_version,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    action_ref: row.action_ref,
    payload: parseJsonColumn(row.payload, {}),
    evidence: parseJsonColumn(row.evidence, {}),
    receipt: parseJsonColumn(row.receipt, null),
    diff: parseJsonColumn(row.diff, null),
    idempotency_key: row.idempotency_key,
    correlation_id: row.correlation_id,
    created_at: row.created_at,
  }));
}

const MAIN_INDEX = new Map(MAIN_STAGES.map((stage, index) => [stage.code, index]));
const SIDE_STAGE_CODES = new Set(["PAUSED", "DISPUTED", "LOST", "REJECTED", "CANCELLED", "COMPLETED"]);

/**
 * 阶段转移 → 事件类型（事实句「阶段已前进/已回退/已进入异常/已离开异常/已完成」）。
 * 分类只服务事件账本；正式阶段语义仍以 stage-transitions 与 confirm_stage 为准。
 */
export function stageEventType(fromStage: string, toStage: string): string {
  if (toStage === "COMPLETED") return "stage.completed";
  if (SIDE_STAGE_CODES.has(toStage)) return "stage.exception_entered";
  if (SIDE_STAGE_CODES.has(fromStage)) return "stage.exception_left";
  const from = MAIN_INDEX.get(fromStage);
  const to = MAIN_INDEX.get(toStage);
  if (from !== undefined && to !== undefined) {
    const diff = to - from;
    if (diff > 1) return "stage.forward_skipped";
    if (diff < 0) return "stage.regressed";
    return "stage.advanced";
  }
  return "stage.advanced";
}
