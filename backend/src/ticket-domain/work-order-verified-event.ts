import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json } from "../types.js";
import { FORMAL_BUSINESS_EVENT_TYPE_SET, FORMAL_EVENT_OBJECT_TYPES } from "./event-contracts.js";
import { taskWorkOrderAggregate } from "./task-work-orders.js";

type EventRow = {
  id: string; task_id: string; source_system: string; source_event_id: string; source_version: string; event_type: string;
  occurred_at: Date | string; summary: string; evidence_ref: string; evidence_json: unknown; payload_json: unknown;
  verified_by: string; verified_at: Date | string; created_at: Date | string; idempotency_key: string;
};

type ParsedEvent = {
  source_system: string; source_event_id: string; source_version: string; event_type: string; occurred_at: string;
  summary: string; evidence_ref: string; evidence: Json; payload: Json; idempotency_key: string;
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function required(value: unknown, field: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpFail(422, { code: "verified_event_field_required", field });
  if (text.length > max) throw new HttpFail(422, { code: "verified_event_field_too_long", field, max });
  return text;
}

function optional(value: unknown, field: string, max: number): string {
  if (value == null || String(value).trim() === "") return "";
  return required(value, field, max);
}

function parse(raw: Record<string, unknown>): ParsedEvent {
  const eventType = required(raw.event_type, "event_type", 120);
  if (!FORMAL_BUSINESS_EVENT_TYPE_SET.has(eventType)) {
    throw new HttpFail(422, { code: "event_type_not_in_first_wave", allowed: [...FORMAL_BUSINESS_EVENT_TYPE_SET] });
  }
  const occurred = new Date(required(raw.occurred_at, "occurred_at", 80));
  if (Number.isNaN(occurred.getTime())) throw new HttpFail(422, { code: "verified_event_timestamp_invalid", field: "occurred_at" });
  const evidence = object(raw.evidence);
  if (!Object.keys(evidence).length) throw new HttpFail(422, { code: "verified_event_evidence_required" });
  const key = required(raw.idempotency_key, "idempotency_key", 240);
  if (key.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return {
    source_system: required(raw.source_system, "source_system", 120),
    source_event_id: required(raw.source_event_id, "source_event_id", 240),
    source_version: optional(raw.source_version, "source_version", 240),
    event_type: eventType,
    occurred_at: occurred.toISOString(),
    summary: required(raw.summary, "summary", 1_000),
    evidence_ref: required(raw.evidence_ref, "evidence_ref", 1_000),
    evidence,
    payload: object(raw.payload),
    idempotency_key: key,
  };
}

function publicEvent(row: EventRow, replayed: boolean) {
  return {
    id: row.id, task_id: row.task_id, source_system: row.source_system, source_event_id: row.source_event_id,
    source_version: row.source_version, event_type: row.event_type, occurred_at: new Date(row.occurred_at).toISOString(),
    summary: row.summary, evidence_ref: row.evidence_ref, evidence: object(row.evidence_json), payload: object(row.payload_json),
    verified_by: row.verified_by, verified_at: new Date(row.verified_at).toISOString(), created_at: new Date(row.created_at).toISOString(), replayed,
  };
}

/** Records a first-wave event as immutable evidence before any Jev decision.
 * It authorizes through the parent Task but intentionally does not invoke a
 * model, create a work order, or mutate task stage itself. */
export async function recordVerifiedWorkOrderEvent(
  actorId: string,
  taskId: string,
  raw: Record<string, unknown>,
  options: { isAdmin?: boolean } = {},
): Promise<{ event: Awaited<ReturnType<typeof publicEvent>> }> {
  const event = parse(raw);
  const task = await taskWorkOrderAggregate(actorId, String(taskId || "").trim(), Boolean(options.isAdmin));
  return postgresTransaction(async (client) => {
    const replay = await client.query<EventRow>("SELECT * FROM work_order_verified_events WHERE idempotency_key=$1 FOR UPDATE", [event.idempotency_key]);
    if (replay.rows[0]) {
      const prior = replay.rows[0];
      if (prior.task_id !== task.task.task_id || prior.source_system !== event.source_system || prior.source_event_id !== event.source_event_id || prior.source_version !== event.source_version) {
        throw new HttpFail(409, { code: "idempotency_key_reused" });
      }
      return { event: publicEvent(prior, true) };
    }
    const sameSource = await client.query<{ id: string }>(
      "SELECT id FROM work_order_verified_events WHERE task_id=$1 AND source_system=$2 AND source_event_id=$3 AND source_version=$4 FOR UPDATE",
      [task.task.task_id, event.source_system, event.source_event_id, event.source_version],
    );
    if (sameSource.rows[0]) throw new HttpFail(409, { code: "verified_event_source_already_recorded", event_id: sameSource.rows[0].id });
    const now = new Date();
    const inserted = await client.query<EventRow>(
      `INSERT INTO work_order_verified_events
       (id,task_id,source_system,source_event_id,source_version,event_type,occurred_at,summary,evidence_ref,evidence_json,payload_json,verified_by,verified_at,idempotency_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13)
       RETURNING *`,
      [nid("woe"), task.task.task_id, event.source_system, event.source_event_id, event.source_version, event.event_type, event.occurred_at,
        event.summary, event.evidence_ref, JSON.stringify(event.evidence), JSON.stringify(event.payload), actorId, now, event.idempotency_key],
    );
    if (!inserted.rows[0]) throw new Error("verified work-order event insert failed");
    // 本体统一事件：verified fact 同时落统一业务事件表（PG business_events），
    // 与 email.received 同表；事件码命名唯一真相源为 config/event-catalog.yaml。
    // 同事务写入，幂等键命名空间隔离（woe-be:），重放路径不重复写。
    const verifiedRow = inserted.rows[0];
    // 事实以真正的业务对象关联；没有可追溯对象 ID 的通用核验，诚实关联父任务，
    // 不把 Task id 伪装成邮件/样品/线索 ID。类型候选仍保留在 payload 中供核验。
    const catalogObjectType = FORMAL_EVENT_OBJECT_TYPES[event.event_type as keyof typeof FORMAL_EVENT_OBJECT_TYPES];
    const objectKeys: Record<string, string[]> = {
      creator_candidate: ["lead_id"], collaboration: ["coop_id", "collaboration_id"],
      email: ["email_id", "message_id"], quote: ["quote_id"], contract: ["contract_id"],
      sample: ["sample_id"], content: ["content_id", "deliverable_id"],
      settlement: ["settlement_id", "invoice_id"], risk: ["risk_id"], approval: ["approval_id"],
    };
    const identity = (objectKeys[catalogObjectType] || []).map((key) => event.payload[key] ?? event.evidence[key])
      .find((value) => typeof value === "string" && value.trim());
    const objectType = identity ? catalogObjectType : "follow_task";
    const objectId = typeof identity === "string" ? identity.trim() : task.task.task_id;
    if (objectType === "creator_candidate" || objectType === "collaboration") {
      const linked = objectType === "creator_candidate"
        ? await client.query("SELECT id FROM kol_leads WHERE id=$1 AND followup_task_id=$2", [objectId, task.task.task_id])
        : await client.query("SELECT id FROM kol_cooperations WHERE id=$1 AND project_task_id=$2", [objectId, task.task.task_id]);
      if (!linked.rows[0]) throw new HttpFail(422, { code: "verified_event_object_task_mismatch" });
    }
    await client.query(
      `INSERT INTO business_events
       (id,event_type,object_type,object_id,occurred_at,received_at,source,source_version,actor_type,actor_id,
        payload,evidence,idempotency_key,correlation_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        nid("evt"),
        event.event_type,
        objectType,
        objectId,
        event.occurred_at,
        now.toISOString(),
        "ticket-domain",
        event.source_version || null,
        "human",
        actorId,
        JSON.stringify({ ...event.payload, catalog_object_type: catalogObjectType, verified_event_id: verifiedRow.id, task_id: task.task.task_id }),
        JSON.stringify(event.evidence),
        `woe-be:${event.idempotency_key}`,
        task.task.task_id,
        now.toISOString(),
      ],
    );
    return { event: publicEvent(verifiedRow, false) };
  }, { isolation: "SERIALIZABLE" });
}
