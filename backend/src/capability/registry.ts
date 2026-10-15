/**
 * 技能 / 模型能力注册表（2026-10-07）：索引而非仓库。
 *
 * 不存外部 skill 的源码、不存模型权重，只登记"它能干什么、怎么调、用得怎么样"
 * 的能力画像，供调度层做任务→Skill→模型的匹配。这是知识五类承载中"经验"层的
 * 登记处，也是调度系统的输入。
 *
 * 设计：docs/superpowers/specs/2026-10-07-media-transcribe-capability-registry-design.md §2
 * 表结构：backend/src/db.ts initSchema（SQLite）＋
 * backend/scripts/apply-postgres-schema.ts 增量 20261007_capability_registry（PG）。
 */
import { getConn, nowIso, tx, audit } from "../db.js";
import { nid } from "../ids.js";
import { requireAdmin } from "../auth.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "../host/errors.js";
import { indexModel, chatModel, mediaModel } from "../knowledge-bridge.js";
import { knowledgeActorId } from "../host/knowledge.js";

export const CAPABILITY_KINDS = ["skill", "model", "connector"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export const CAPABILITY_ORIGINS = ["builtin", "manual", "external", "auto"] as const;
export const CAPABILITY_STATUSES = ["active", "deprecated"] as const;

export type CapabilityStats = {
  calls: number;
  ok: number;
  total_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  last_called_at: string | null;
  last_ok: boolean | null;
};

const EMPTY_STATS: CapabilityStats = {
  calls: 0,
  ok: 0,
  total_latency_ms: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  last_called_at: null,
  last_ok: null,
};

function parseJson(text: unknown, fallback: Json): Json {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(String(text)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Json) : fallback;
  } catch {
    return fallback;
  }
}

function parseStats(text: unknown): CapabilityStats {
  const raw = parseJson(text, {}) as Partial<CapabilityStats>;
  return {
    calls: Number(raw.calls) || 0,
    ok: Number(raw.ok) || 0,
    total_latency_ms: Number(raw.total_latency_ms) || 0,
    total_input_tokens: Number(raw.total_input_tokens) || 0,
    total_output_tokens: Number(raw.total_output_tokens) || 0,
    last_called_at: typeof raw.last_called_at === "string" ? raw.last_called_at : null,
    last_ok: typeof raw.last_ok === "boolean" ? raw.last_ok : null,
  };
}

function rowToView(row: Row): Json {
  return {
    id: String(row.id),
    kind: String(row.kind),
    ref_id: String(row.ref_id),
    origin: String(row.origin),
    capability: parseJson(row.capability, {}),
    constraints: parseJson(row.constraints, {}),
    version: row.version == null ? null : String(row.version),
    version_pinned: row.version_pinned == null ? null : String(row.version_pinned),
    stats: parseStats(row.stats),
    notes: row.notes == null ? null : String(row.notes),
    status: String(row.status),
    created_by: row.created_by == null ? null : String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** 内置三档模型画像（P1 手工登记值；stats 由运行自动补）。
 * 同一模型承担多档时合并为一条画像（roles 数组），UNIQUE(kind, ref_id) 去重。 */
function builtinProfiles(): Array<{ ref_id: string; capability: Json }> {
  const defs = [
    {
      ref_id: indexModel(), role: "建树索引",
      description: "便宜档：索引阶段对质量影响小，选成本优先的模型",
      strengths: ["文档结构解析"], cost_tier: "low",
    },
    {
      ref_id: chatModel(), role: "检索问答",
      description: "能力档：检索问答质量随模型能力上升",
      strengths: ["中文问答", "引用定位"], cost_tier: "medium",
    },
    {
      ref_id: mediaModel(), role: "多模态规整",
      description: "多模态档：需支持图像 / 音频输入（扫描件 OCR、音视频转写）",
      strengths: ["扫描件 OCR", "音频转写", "图片理解"], cost_tier: "high",
    },
  ];
  const tierRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const merged = new Map<string, { roles: string[]; descriptions: string[]; strengths: string[]; cost_tier: string }>();
  for (const def of defs) {
    const entry = merged.get(def.ref_id) || { roles: [], descriptions: [], strengths: [], cost_tier: "low" };
    entry.roles.push(def.role);
    entry.descriptions.push(`${def.role}：${def.description}`);
    for (const s of def.strengths) if (!entry.strengths.includes(s)) entry.strengths.push(s);
    if ((tierRank[def.cost_tier] || 0) > (tierRank[entry.cost_tier] || 0)) entry.cost_tier = def.cost_tier;
    merged.set(def.ref_id, entry);
  }
  return [...merged.entries()].map(([ref_id, entry]) => ({
    ref_id,
    capability: {
      roles: entry.roles,
      role: entry.roles.join(" / "),
      description: entry.descriptions.join("；"),
      strengths: entry.strengths,
      cost_tier: entry.cost_tier,
    },
  }));
}

let builtinsSeeded = false;

/** 首次使用时幂等写入内置画像（INSERT … ON CONFLICT DO NOTHING，双引擎通用）。 */
async function ensureBuiltinProfiles(): Promise<Awaited<void>> {
  if (builtinsSeeded) return;
  builtinsSeeded = true;
  const now = nowIso();
  (await tx(async (db) => {
    for (const profile of builtinProfiles()) {
      (await db.query("INSERT INTO capability_registry\n           (id, kind, ref_id, origin, capability, constraints, stats, status, created_by, created_at, updated_at)\n         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)\n         ON CONFLICT(kind, ref_id) DO NOTHING",[nid("cap"),"model",profile.ref_id,"builtin",JSON.stringify(profile.capability),JSON.stringify({}),JSON.stringify(EMPTY_STATS),"active","system",now,now]));
    }
  }));
}

export async function listCapabilities(filter: { kind?: string; status?: string; q?: string } = {}): Promise<Awaited<Json[]>> {
  (await ensureBuiltinProfiles());
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filter.kind && (CAPABILITY_KINDS as readonly string[]).includes(filter.kind)) {
    clauses.push(`kind=$${args.length + 1}`);
    args.push(filter.kind);
  }
  if (filter.status && (CAPABILITY_STATUSES as readonly string[]).includes(filter.status)) {
    clauses.push(`status=$${args.length + 1}`);
    args.push(filter.status);
  }
  if (filter.q) {
    clauses.push(`(ref_id ILIKE $${args.length + 1} OR notes ILIKE $${args.length + 1})`);
    args.push(`%${filter.q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await getConn().query<Row>(
    `SELECT * FROM capability_registry ${where} ORDER BY kind, ref_id`,
    args,
  )).rows;
  return rows.map(rowToView);
}

/** 调度层只读查询：按 (kind, ref_id) 取能力画像；不存在返回 null（不抛错）。 */
export async function resolveCapability(kind: string, refId: string): Promise<Awaited<Json | null>> {
  (await ensureBuiltinProfiles());
  const row = (await getConn().query("SELECT * FROM capability_registry WHERE kind=$1 AND ref_id=$2",[kind,refId])).rows[0] as Row | undefined;
  return row ? rowToView(row) : null;
}

export async function registerCapability(input: {
  kind?: string;
  ref_id?: string;
  origin?: string;
  capability?: unknown;
  constraints?: unknown;
  version?: string | null;
  version_pinned?: string | null;
  notes?: string | null;
}, actor?: Awaited<ReturnType<typeof knowledgeActorId>>): Promise<Awaited<Json>> {
if (actor === undefined) actor = (await knowledgeActorId());

  requireAdmin();
  (await ensureBuiltinProfiles());
  const kind = String(input.kind || "");
  if (!(CAPABILITY_KINDS as readonly string[]).includes(kind)) {
    throw new HttpFail(400, { code: "capability_kind_invalid", message: "kind 必须是 skill / model / connector" });
  }
  const refId = String(input.ref_id || "").trim();
  if (!refId) throw new HttpFail(400, { code: "capability_ref_required", message: "ref_id 必填" });
  const origin = String(input.origin || "manual");
  if (!(CAPABILITY_ORIGINS as readonly string[]).includes(origin)) {
    throw new HttpFail(400, { code: "capability_origin_invalid", message: "origin 非法" });
  }
  const now = nowIso();
  const capability = JSON.stringify(input.capability && typeof input.capability === "object" ? input.capability : {});
  const constraints = JSON.stringify(input.constraints && typeof input.constraints === "object" ? input.constraints : {});
  const id = nid("cap");
  (await getConn().query("INSERT INTO capability_registry\n       (id, kind, ref_id, origin, capability, constraints, version, version_pinned, stats, notes, status, created_by, created_at, updated_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)\n     ON CONFLICT(kind, ref_id) DO UPDATE SET\n       origin=excluded.origin, capability=excluded.capability, constraints=excluded.constraints,\n       version=excluded.version, version_pinned=excluded.version_pinned, notes=excluded.notes,\n       status='active', updated_at=excluded.updated_at",[id,kind,refId,origin,capability,constraints,input.version ?? null,input.version_pinned ?? null,JSON.stringify(EMPTY_STATS),input.notes ?? null,"active",actor,now,now]));
  (await audit(actor, "capability.register", { kind, ref_id: refId, origin }));
  const row = (await getConn().query("SELECT * FROM capability_registry WHERE kind=$1 AND ref_id=$2",[kind,refId])).rows[0] as Row;
  return rowToView(row);
}

export async function updateCapability(id: string, patch: {
  capability?: unknown;
  constraints?: unknown;
  version_pinned?: string | null;
  notes?: string | null;
  status?: string;
}, actor?: Awaited<ReturnType<typeof knowledgeActorId>>): Promise<Awaited<Json>> {
if (actor === undefined) actor = (await knowledgeActorId());

  requireAdmin();
  (await ensureBuiltinProfiles());
  const row = (await getConn().query("SELECT * FROM capability_registry WHERE id=$1",[String(id)])).rows[0] as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "capability_missing", message: "能力登记不存在" });
  return (await tx(async (db) => {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.capability !== undefined && typeof patch.capability === "object") {
      sets.push(`capability=$${args.length + 1}`);
      args.push(JSON.stringify(patch.capability));
    }
    if (patch.constraints !== undefined && typeof patch.constraints === "object") {
      sets.push(`constraints=$${args.length + 1}`);
      args.push(JSON.stringify(patch.constraints));
    }
    if (patch.version_pinned !== undefined) {
      sets.push(`version_pinned=$${args.length + 1}`);
      args.push(patch.version_pinned);
    }
    if (patch.notes !== undefined) {
      sets.push(`notes=$${args.length + 1}`);
      args.push(patch.notes);
    }
    if (patch.status !== undefined) {
      if (!(CAPABILITY_STATUSES as readonly string[]).includes(patch.status)) {
        throw new HttpFail(400, { code: "capability_status_invalid", message: "status 非法" });
      }
      sets.push(`status=$${args.length + 1}`);
      args.push(patch.status);
    }
    if (!sets.length) throw new HttpFail(400, { code: "capability_nothing_to_update", message: "没有可更新的字段" });
    sets.push(`updated_at=$${args.length + 1}`);
    args.push(nowIso());
    args.push(String(id));
    await db.query(`UPDATE capability_registry SET ${sets.join(", ")} WHERE id=$${args.length}`, args);
    await audit(actor, "capability.update", { id: String(id), kind: String(row.kind), ref_id: String(row.ref_id) }, db);
    const updated = (await db.query<Row>("SELECT * FROM capability_registry WHERE id=$1", [String(id)])).rows[0] as Row;
    return rowToView(updated);
  })) as Awaited<Json>;
}

/**
 * 运行自动写回（P1 只做计数器）：只记聚合数字（次数/成功率/耗时/token），
 * 不记 prompt 与业务内容。未知 (kind, ref_id) 自动建 origin='auto' 行。
 */
export async function recordCapabilityCall(call: {
  kind: string;
  ref_id: string;
  ok: boolean;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<Awaited<void>> {
  const kind = String(call.kind || "");
  const refId = String(call.ref_id || "").trim();
  if (!(CAPABILITY_KINDS as readonly string[]).includes(kind) || !refId) return;
  try {
    (await ensureBuiltinProfiles());
    const now = nowIso();
    (await tx(async (db) => {
      const existing = (await db.query("SELECT * FROM capability_registry WHERE kind=$1 AND ref_id=$2",[kind,refId])).rows[0] as Row | undefined;
      if (!existing) {
        (await db.query("INSERT INTO capability_registry\n             (id, kind, ref_id, origin, capability, stats, status, created_by, created_at, updated_at)\n           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[nid("cap"),kind,refId,"auto",JSON.stringify({}),JSON.stringify(EMPTY_STATS),"active","system",now,now]));
      }
      const row = (await db.query("SELECT stats FROM capability_registry WHERE kind=$1 AND ref_id=$2",[kind,refId])).rows[0] as Row;
      const stats = parseStats(row.stats);
      stats.calls += 1;
      if (call.ok) stats.ok += 1;
      if (Number.isFinite(Number(call.latencyMs))) stats.total_latency_ms += Number(call.latencyMs);
      if (Number.isFinite(Number(call.inputTokens))) stats.total_input_tokens += Number(call.inputTokens);
      if (Number.isFinite(Number(call.outputTokens))) stats.total_output_tokens += Number(call.outputTokens);
      stats.last_called_at = now;
      stats.last_ok = Boolean(call.ok);
      (await db.query("UPDATE capability_registry SET stats=$1, updated_at=$2 WHERE kind=$3 AND ref_id=$4",[JSON.stringify(stats),now,kind,refId]));
    }));
  } catch {
    // 统计写回永不阻塞主流程。
  }
}
