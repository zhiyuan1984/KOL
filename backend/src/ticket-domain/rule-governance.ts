import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

const RULE_TYPES = ["ticket_assignment", "ticket_escalation", "ticket_candidate"] as const;
const TICKET_STATUSES = new Set(["pending", "accepted", "in_progress", "waiting", "waiting_approval", "completed", "cancelled", "failed"]);
const TICKET_PRIORITIES = new Set(["low", "normal", "important", "urgent"]);

type RuleType = typeof RULE_TYPES[number];
type RuleRow = Row & {
  id: string;
  version: number;
  rule_type: string;
  title: string;
  status: string;
  scope_json: unknown;
  definition_json: unknown;
  created_by: string;
  published_by: string | null;
  created_at: string;
  published_at: string | null;
  updated_at: string;
};

type RuleScope = { company_id: string; brand_id?: string; region_id?: string };
type RuleDefinition = {
  execution_mode: "manual_confirmation";
  requires_human_confirmation: true;
  proposed_action: "assignment_suggestion" | "escalation_suggestion" | "candidate_ticket";
  conditions?: {
    ticket_statuses?: string[];
    priorities?: string[];
    business_categories?: string[];
    overdue?: boolean;
  };
};

type SimulationRow = Row & {
  id: string;
  rule_id: string;
  rule_version: number;
  rule_fingerprint: string;
  result_json: unknown;
  sample_count: number;
  matched_count: number;
  data_as_of: string;
  evaluated_by: string;
  created_at: string;
};

function object(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function requiredText(value: unknown, field: string, max = 240): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new HttpFail(422, { code: "rule_field_required", field });
  if (normalized.length > max) throw new HttpFail(422, { code: "rule_field_too_long", field, max });
  return normalized;
}

function idempotencyKey(value: unknown): string {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 240) throw new HttpFail(400, { code: "idempotency_key_required", message: "规则治理写入必须提供长度为 8-240 的 Idempotency-Key" });
  return key;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(ruleType: string, title: string, scope: RuleScope, definition: RuleDefinition): string {
  return createHash("sha256").update(stable({ rule_type: ruleType, title, scope, definition })).digest("hex");
}

function strings(value: unknown, field: string, allowed?: Set<string>): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 30) throw new HttpFail(422, { code: "invalid_rule_condition", field });
  const values = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  if (allowed && values.some((item) => !allowed.has(item))) throw new HttpFail(422, { code: "invalid_rule_condition_value", field });
  return values;
}

function validatedRule(input: Record<string, unknown>): { rule_type: RuleType; title: string; scope: RuleScope; definition: RuleDefinition } {
  const ruleType = requiredText(input.rule_type, "rule_type", 80) as RuleType;
  if (!RULE_TYPES.includes(ruleType)) throw new HttpFail(422, { code: "unsupported_rule_type", allowed: RULE_TYPES });
  const title = requiredText(input.title, "title");
  const rawScope = object(input.scope);
  const scope: RuleScope = { company_id: requiredText(rawScope.company_id, "scope.company_id", 160) };
  if (rawScope.brand_id != null && String(rawScope.brand_id).trim()) scope.brand_id = requiredText(rawScope.brand_id, "scope.brand_id", 160);
  if (rawScope.region_id != null && String(rawScope.region_id).trim()) scope.region_id = requiredText(rawScope.region_id, "scope.region_id", 160);

  const rawDefinition = object(input.definition);
  if (String(rawDefinition.execution_mode || "") !== "manual_confirmation" || rawDefinition.requires_human_confirmation !== true) {
    throw new HttpFail(422, {
      code: "human_confirmation_required",
      message: "当前规则治理只允许 manual_confirmation；不得在未发布业务口径下配置自动执行。",
    });
  }
  const expectedAction: Record<RuleType, RuleDefinition["proposed_action"]> = {
    ticket_assignment: "assignment_suggestion",
    ticket_escalation: "escalation_suggestion",
    ticket_candidate: "candidate_ticket",
  };
  if (String(rawDefinition.proposed_action || "") !== expectedAction[ruleType]) {
    throw new HttpFail(422, { code: "rule_action_mismatch", expected: expectedAction[ruleType] });
  }
  const rawConditions = object(rawDefinition.conditions);
  const conditions: NonNullable<RuleDefinition["conditions"]> = {};
  const statuses = strings(rawConditions.ticket_statuses, "conditions.ticket_statuses", TICKET_STATUSES);
  const priorities = strings(rawConditions.priorities, "conditions.priorities", TICKET_PRIORITIES);
  const categories = strings(rawConditions.business_categories, "conditions.business_categories");
  if (statuses?.length) conditions.ticket_statuses = statuses;
  if (priorities?.length) conditions.priorities = priorities;
  if (categories?.length) conditions.business_categories = categories;
  if (rawConditions.overdue != null && typeof rawConditions.overdue !== "boolean") throw new HttpFail(422, { code: "invalid_rule_condition", field: "conditions.overdue" });
  if (rawConditions.overdue === true) conditions.overdue = true;
  return {
    rule_type: ruleType,
    title,
    scope,
    definition: {
      execution_mode: "manual_confirmation",
      requires_human_confirmation: true,
      proposed_action: expectedAction[ruleType],
      ...(Object.keys(conditions).length ? { conditions } : {}),
    },
  };
}

function ruleFrom(row: RuleRow): { id: string; version: number; rule_type: string; title: string; status: string; scope: Json; definition: Json; created_by: string; published_by: string | null; created_at: string; published_at: string | null; updated_at: string; fingerprint: string } {
  const scope = object(row.scope_json) as RuleScope;
  const definition = object(row.definition_json) as RuleDefinition;
  return {
    id: String(row.id), version: Number(row.version), rule_type: String(row.rule_type), title: String(row.title), status: String(row.status),
    scope, definition, created_by: String(row.created_by), published_by: row.published_by || null,
    created_at: String(row.created_at), published_at: row.published_at || null, updated_at: String(row.updated_at),
    fingerprint: fingerprint(String(row.rule_type), String(row.title), scope, definition),
  };
}

function publicSimulation(row: SimulationRow): Json {
  return {
    id: row.id, rule_id: row.rule_id, rule_version: Number(row.rule_version), rule_fingerprint: row.rule_fingerprint,
    result: object(row.result_json), sample_count: Number(row.sample_count), matched_count: Number(row.matched_count),
    data_as_of: row.data_as_of, evaluated_by: row.evaluated_by, created_at: row.created_at,
  };
}

async function receipt(client: PoolClient, key: string, action: string): Promise<Json | undefined> {
  const found = await client.query<{ action: string; result_json: unknown }>(
    "SELECT action,result_json FROM scheduling_rule_command_receipts WHERE idempotency_key=$1", [key],
  );
  if (!found.rows[0]) return undefined;
  if (found.rows[0].action !== action) throw new HttpFail(409, { code: "idempotency_key_reused", message: "同一 Idempotency-Key 不能用于不同规则命令。" });
  return object(found.rows[0].result_json);
}

async function recordAudit(client: PoolClient, input: {
  rule_id: string; rule_version: number; action: "draft_created" | "draft_superseded" | "published_superseded" | "simulated" | "published" | "disabled";
  actor_account_id: string; reason?: string | null; request?: Json; result?: Json;
}): Promise<void> {
  await client.query(
    `INSERT INTO scheduling_rule_audit_events
     (id,rule_id,rule_version,action,actor_account_id,reason,request_json,result_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    [nid("sra"), input.rule_id, input.rule_version, input.action, input.actor_account_id, input.reason || null,
      JSON.stringify(input.request || {}), JSON.stringify(input.result || {})],
  );
}

async function recordReceipt(client: PoolClient, input: {
  key: string; rule_id: string; rule_version: number; action: "create_draft" | "simulate" | "publish" | "disable"; actor: string; result: Json;
}): Promise<void> {
  await client.query(
    `INSERT INTO scheduling_rule_command_receipts
     (idempotency_key,rule_id,rule_version,action,actor_account_id,result_json,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [input.key, input.rule_id, input.rule_version, input.action, input.actor, JSON.stringify(input.result)],
  );
}

async function ruleForUpdate(client: PoolClient, ruleId: string, version: number): Promise<RuleRow> {
  const result = await client.query<RuleRow>("SELECT * FROM scheduling_rules WHERE id=$1 AND version=$2 FOR UPDATE", [ruleId, version]);
  if (!result.rows[0]) throw new HttpFail(404, "scheduling rule not found");
  return result.rows[0];
}

function reason(value: unknown): string {
  return requiredText(value, "reason", 1_000);
}

export async function createSchedulingRuleDraft(actorId: string, input: Record<string, unknown>): Promise<Json> {
  const key = idempotencyKey(input.idempotency_key);
  const spec = validatedRule(input);
  const requestedId = input.id == null || String(input.id).trim() === "" ? nid("sgr") : requiredText(input.id, "id", 160);
  const baseVersion = input.base_version == null ? null : Number(input.base_version);
  if (baseVersion != null && (!Number.isInteger(baseVersion) || baseVersion < 1)) throw new HttpFail(400, { code: "invalid_base_version" });
  const why = reason(input.reason);
  return postgresTransaction(async (client) => {
    const replay = await receipt(client, key, "create_draft");
    if (replay) return { ...replay, replayed: true };
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [requestedId]);
    const prior = await client.query<RuleRow>("SELECT * FROM scheduling_rules WHERE id=$1 ORDER BY version DESC FOR UPDATE", [requestedId]);
    const latest = prior.rows[0];
    if (latest && baseVersion !== Number(latest.version)) throw new HttpFail(409, { code: "rule_version_conflict", expected_version: latest.version });
    if (!latest && baseVersion != null) throw new HttpFail(409, { code: "rule_version_conflict", expected_version: null });
    const version = Number(latest?.version || 0) + 1;
    const superseded = await client.query<RuleRow>(
      "UPDATE scheduling_rules SET status='superseded',updated_at=$1 WHERE id=$2 AND status='draft' RETURNING *",
      [new Date().toISOString(), requestedId],
    );
    for (const old of superseded.rows) {
      await recordAudit(client, {
        rule_id: String(old.id), rule_version: Number(old.version), action: "draft_superseded", actor_account_id: actorId,
        reason: "新草稿版本替代旧草稿", result: { replacement_version: version },
      });
    }
    const now = new Date().toISOString();
    const inserted = await client.query<RuleRow>(
      `INSERT INTO scheduling_rules
       (id,version,rule_type,title,status,scope_json,definition_json,created_by,published_by,created_at,published_at,updated_at)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,NULL,$8,NULL,$8) RETURNING *`,
      [requestedId, version, spec.rule_type, spec.title, JSON.stringify(spec.scope), JSON.stringify(spec.definition), actorId, now],
    );
    const rule = ruleFrom(inserted.rows[0]);
    const result: Json = { rule, replayed: false, execution_effect: "none", human_confirmation_required: true };
    await recordAudit(client, {
      rule_id: requestedId, rule_version: version, action: "draft_created", actor_account_id: actorId, reason: why,
      request: { rule_type: spec.rule_type, title: spec.title, scope: spec.scope, definition: spec.definition, base_version: baseVersion }, result,
    });
    await recordReceipt(client, { key, rule_id: requestedId, rule_version: version, action: "create_draft", actor: actorId, result });
    return result;
  }, { isolation: "SERIALIZABLE" });
}

function simulationLimit(value: unknown): number {
  if (value == null || value === "") return 25;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HttpFail(400, { code: "invalid_sample_limit" });
  return limit;
}

async function simulationMatches(client: PoolClient, rule: ReturnType<typeof ruleFrom>, limit: number): Promise<Json[]> {
  const scope = rule.scope as RuleScope;
  const definition = rule.definition as RuleDefinition;
  const conditions = definition.conditions || {};
  const params: unknown[] = [scope.company_id];
  const where = [
    "t.task_type='manual_ticket'", "t.profile='ticket-workbench'", "os.company_id=$1",
  ];
  if (conditions.ticket_statuses?.length) {
    params.push(conditions.ticket_statuses);
    where.push(`t.status = ANY($${params.length}::text[])`);
  }
  if (conditions.priorities?.length) {
    params.push(conditions.priorities);
    where.push(`t.priority = ANY($${params.length}::text[])`);
  }
  if (conditions.business_categories?.length) {
    params.push(conditions.business_categories);
    where.push(`COALESCE(t.business_category,'') = ANY($${params.length}::text[])`);
  }
  if (conditions.overdue) where.push("NULLIF(t.due_at,'')::timestamptz < now()");
  params.push(limit);
  const rows = await client.query<Row>(
    `SELECT t.id,t.title,t.status,t.priority,t.business_category,t.stage_code,t.due_at,t.updated_at,
            os.company_id,os.assignee_unit_id
       FROM tickets t JOIN ticket_org_scopes os ON os.ticket_id=t.id
      WHERE ${where.join(" AND ")}
      ORDER BY t.updated_at DESC,t.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.rows.map((row) => ({
    ticket_id: String(row.id), title: String(row.title), status: String(row.status), priority: String(row.priority),
    business_category: row.business_category || null, stage_code: row.stage_code || null, due_at: row.due_at || null,
    updated_at: row.updated_at, company_id: row.company_id, assignee_unit_id: row.assignee_unit_id,
    proposed_action: definition.proposed_action, requires_human_confirmation: true,
  }));
}

export async function simulateSchedulingRule(actorId: string, ruleId: string, version: number, input: Record<string, unknown>): Promise<Json> {
  const key = idempotencyKey(input.idempotency_key);
  const limit = simulationLimit(input.sample_limit);
  const why = reason(input.reason);
  return postgresTransaction(async (client) => {
    const replay = await receipt(client, key, "simulate");
    if (replay) return { ...replay, replayed: true };
    const row = await ruleForUpdate(client, ruleId, version);
    if (!["draft", "published"].includes(String(row.status))) throw new HttpFail(409, { code: "rule_not_simulatable", status: row.status });
    const rule = ruleFrom(row);
    const matches = await simulationMatches(client, rule, limit);
    const now = new Date().toISOString();
    const result: Json = {
      simulation_version: "scheduling-rule-simulation.v1", valid: true, execution_effect: "none",
      human_confirmation_required: true, matched_count: matches.length, sample_limit: limit,
      truncated: matches.length === limit, tickets: matches,
    };
    const simulationId = nid("rsim");
    await client.query(
      `INSERT INTO scheduling_rule_simulations
       (id,rule_id,rule_version,rule_fingerprint,input_json,result_json,sample_count,matched_count,data_as_of,evaluated_by,idempotency_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$9)`,
      [simulationId, rule.id, rule.version, rule.fingerprint, JSON.stringify({ sample_limit: limit, reason: why }), JSON.stringify(result),
        matches.length, matches.length, now, actorId, key],
    );
    const response: Json = { simulation_id: simulationId, rule, ...result, replayed: false, data_as_of: now };
    await recordAudit(client, {
      rule_id: rule.id, rule_version: rule.version, action: "simulated", actor_account_id: actorId, reason: why,
      request: { sample_limit: limit }, result: response,
    });
    await recordReceipt(client, { key, rule_id: rule.id, rule_version: rule.version, action: "simulate", actor: actorId, result: response });
    return response;
  }, { isolation: "SERIALIZABLE" });
}

async function ruleMutationReceipt(
  action: "publish" | "disable", actorId: string, ruleId: string, version: number, input: Record<string, unknown>,
): Promise<Json> {
  const key = idempotencyKey(input.idempotency_key);
  const expectedVersion = Number(input.expected_version);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== version) throw new HttpFail(409, { code: "rule_version_conflict", expected_version: version });
  const why = reason(input.reason);
  return postgresTransaction(async (client) => {
    const replay = await receipt(client, key, action);
    if (replay) return { ...replay, replayed: true };
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ruleId]);
    const row = await ruleForUpdate(client, ruleId, version);
    const rule = ruleFrom(row);
    if (action === "publish") {
      if (row.status !== "draft") throw new HttpFail(409, { code: "rule_not_publishable", status: row.status });
      const simulationId = requiredText(input.simulation_id, "simulation_id", 160);
      const simulation = await client.query<SimulationRow>(
        `SELECT * FROM scheduling_rule_simulations
          WHERE id=$1 AND rule_id=$2 AND rule_version=$3 AND rule_fingerprint=$4
          FOR UPDATE`,
        [simulationId, ruleId, version, rule.fingerprint],
      );
      if (!simulation.rows[0] || object(simulation.rows[0].result_json).valid !== true) {
        throw new HttpFail(409, { code: "rule_simulation_required", message: "发布前必须引用当前版本、当前内容指纹的成功模拟。" });
      }
      const oldPublished = await client.query<RuleRow>(
        "UPDATE scheduling_rules SET status='superseded',updated_at=$1 WHERE id=$2 AND status='published' RETURNING *",
        [new Date().toISOString(), ruleId],
      );
      for (const old of oldPublished.rows) {
        await recordAudit(client, {
          rule_id: String(old.id), rule_version: Number(old.version), action: "published_superseded", actor_account_id: actorId,
          reason: "新版本已发布", result: { replacement_version: version },
        });
      }
      const now = new Date().toISOString();
      const published = await client.query<RuleRow>(
        `UPDATE scheduling_rules SET status='published',published_by=$1,published_at=$2,updated_at=$2
          WHERE id=$3 AND version=$4 AND status='draft' RETURNING *`,
        [actorId, now, ruleId, version],
      );
      if (!published.rows[0]) throw new HttpFail(409, { code: "rule_publish_race" });
      const output: Json = {
        rule: ruleFrom(published.rows[0]), replayed: false, execution_effect: "none",
        manual_confirmation_only: true, simulation_id: simulationId,
      };
      await recordAudit(client, {
        rule_id: ruleId, rule_version: version, action: "published", actor_account_id: actorId, reason: why,
        request: { expected_version: expectedVersion, simulation_id: simulationId }, result: output,
      });
      await recordReceipt(client, { key, rule_id: ruleId, rule_version: version, action, actor: actorId, result: output });
      return output;
    }
    if (!["draft", "published"].includes(String(row.status))) throw new HttpFail(409, { code: "rule_not_disableable", status: row.status });
    const disabled = await client.query<RuleRow>(
      "UPDATE scheduling_rules SET status='disabled',updated_at=$1 WHERE id=$2 AND version=$3 RETURNING *",
      [new Date().toISOString(), ruleId, version],
    );
    const output: Json = { rule: ruleFrom(disabled.rows[0]), replayed: false, execution_effect: "none" };
    await recordAudit(client, {
      rule_id: ruleId, rule_version: version, action: "disabled", actor_account_id: actorId, reason: why,
      request: { expected_version: expectedVersion }, result: output,
    });
    await recordReceipt(client, { key, rule_id: ruleId, rule_version: version, action, actor: actorId, result: output });
    return output;
  }, { isolation: "SERIALIZABLE" });
}

export function publishSchedulingRule(actorId: string, ruleId: string, version: number, input: Record<string, unknown>): Promise<Json> {
  return ruleMutationReceipt("publish", actorId, ruleId, version, input);
}

export function disableSchedulingRule(actorId: string, ruleId: string, version: number, input: Record<string, unknown>): Promise<Json> {
  return ruleMutationReceipt("disable", actorId, ruleId, version, input);
}

export async function schedulingRuleDetail(ruleId: string, version?: number): Promise<Json> {
  const params: unknown[] = [ruleId];
  const where = ["id=$1"];
  if (version != null) { params.push(version); where.push(`version=$${params.length}`); }
  const found = await postgresPool().query<RuleRow>(
    `SELECT * FROM scheduling_rules WHERE ${where.join(" AND ")} ORDER BY version DESC LIMIT 1`, params,
  );
  if (!found.rows[0]) throw new HttpFail(404, "scheduling rule not found");
  const rule = ruleFrom(found.rows[0]);
  const [simulations, audit] = await Promise.all([
    postgresPool().query<SimulationRow>(
      "SELECT * FROM scheduling_rule_simulations WHERE rule_id=$1 AND rule_version=$2 ORDER BY created_at DESC LIMIT 20", [rule.id, rule.version],
    ),
    postgresPool().query<Row>(
      "SELECT id,action,actor_account_id,reason,request_json,result_json,created_at FROM scheduling_rule_audit_events WHERE rule_id=$1 AND rule_version=$2 ORDER BY created_at DESC LIMIT 50", [rule.id, rule.version],
    ),
  ]);
  return {
    rule,
    simulations: simulations.rows.map(publicSimulation),
    audit_events: audit.rows.map((row) => ({
      id: row.id, action: row.action, actor_account_id: row.actor_account_id, reason: row.reason || null,
      request: object(row.request_json), result: object(row.result_json), created_at: row.created_at,
    })),
  };
}

export async function listSchedulingRules(limit = 100): Promise<Json> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = await postgresPool().query<RuleRow>(
    `SELECT * FROM scheduling_rules
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,updated_at DESC LIMIT $1`,
    [bounded],
  );
  return {
    rules: rows.rows.map(ruleFrom),
    policy: {
      automation: "disabled",
      execution_effect: "none",
      requirement: "发布规则仅登记人工确认建议；未接入派单、升级、建单或状态变更执行器。",
    },
    as_of: new Date().toISOString(),
  };
}
