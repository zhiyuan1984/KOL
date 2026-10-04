import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { stagePolicyPublicationError } from "./work-order-stage-policy.js";

const AUTOMATION_LEVELS = ["A0", "A1", "A2", "A3", "L3"] as const;
type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];
type TemplateStatus = "draft" | "published" | "disabled" | "retired";

type TemplateRow = {
  id: string; template_code: string; version: number | string; title: string; description: string; status: TemplateStatus;
  automation_level: AutomationLevel; business_category: string | null; trigger_event_types: unknown; input_schema_json: unknown;
  fill_policy_json: unknown; acceptance_criteria_json: unknown; routing_policy_code: string | null; stage_policy_json: unknown;
  created_by: string; published_by: string | null; created_at: Date | string; published_at: Date | string | null; updated_at: Date | string;
};

export type WorkOrderTemplateInput = {
  template_code?: unknown;
  title?: unknown;
  description?: unknown;
  automation_level?: unknown;
  business_category?: unknown;
  trigger_event_types?: unknown;
  input_schema?: unknown;
  fill_policy?: unknown;
  acceptance_criteria?: unknown;
  routing_policy_code?: unknown;
  stage_policy?: unknown;
  idempotency_key?: unknown;
};

export type WorkOrderTemplate = {
  id: string;
  template_code: string;
  version: number;
  title: string;
  description: string;
  status: TemplateStatus;
  automation_level: AutomationLevel;
  business_category: string | null;
  trigger_event_types: string[];
  input_schema: Record<string, unknown>;
  fill_policy: Record<string, unknown>;
  acceptance_criteria: string[];
  routing_policy_code: string | null;
  stage_policy: Record<string, unknown>;
  created_by: string;
  published_by: string | null;
  created_at: string;
  published_at: string | null;
  updated_at: string;
};

function required(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function optional(value: unknown, field: string, max: number): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function object(value: unknown, field: string, maxChars = 20_000): Record<string, unknown> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpFail(422, { code: "field_object_required", field });
  const result = value as Record<string, unknown>;
  if (JSON.stringify(result).length > maxChars) throw new HttpFail(422, { code: "field_too_large", field });
  return result;
}

function stringList(value: unknown, field: string, maxItems: number, maxItemChars: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpFail(422, { code: "field_array_required", field });
  const result = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (result.length > maxItems || result.some((item) => item.length > maxItemChars)) throw new HttpFail(422, { code: "field_array_invalid", field });
  return result;
}

function automationLevel(value: unknown): AutomationLevel {
  const result = required(value, "automation_level", 10) as AutomationLevel;
  if (!AUTOMATION_LEVELS.includes(result)) throw new HttpFail(422, { code: "automation_level_invalid" });
  return result;
}

function templateCode(value: unknown): string {
  const result = required(value, "template_code", 120);
  if (!/^[a-z][a-z0-9_]{2,119}$/.test(result)) throw new HttpFail(422, { code: "template_code_invalid" });
  return result;
}

function publicTemplate(row: TemplateRow): WorkOrderTemplate {
  return {
    id: row.id,
    template_code: row.template_code,
    version: Number(row.version),
    title: row.title,
    description: row.description,
    status: row.status,
    automation_level: row.automation_level,
    business_category: row.business_category,
    trigger_event_types: Array.isArray(row.trigger_event_types) ? row.trigger_event_types.map(String) : [],
    input_schema: row.input_schema_json && typeof row.input_schema_json === "object" && !Array.isArray(row.input_schema_json) ? row.input_schema_json as Record<string, unknown> : {},
    fill_policy: row.fill_policy_json && typeof row.fill_policy_json === "object" && !Array.isArray(row.fill_policy_json) ? row.fill_policy_json as Record<string, unknown> : {},
    acceptance_criteria: Array.isArray(row.acceptance_criteria_json) ? row.acceptance_criteria_json.map(String) : [],
    routing_policy_code: row.routing_policy_code,
    stage_policy: row.stage_policy_json && typeof row.stage_policy_json === "object" && !Array.isArray(row.stage_policy_json) ? row.stage_policy_json as Record<string, unknown> : {},
    created_by: row.created_by,
    published_by: row.published_by,
    created_at: new Date(row.created_at).toISOString(),
    published_at: row.published_at == null ? null : new Date(row.published_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

function parseDraft(raw: WorkOrderTemplateInput) {
  const level = automationLevel(raw.automation_level);
  const stagePolicy = object(raw.stage_policy, "stage_policy");
  const criteria = stringList(raw.acceptance_criteria, "acceptance_criteria", 20, 500);
  const triggerEvents = stringList(raw.trigger_event_types, "trigger_event_types", 30, 120);
  return {
    templateCode: templateCode(raw.template_code),
    title: required(raw.title, "title", 200),
    description: optional(raw.description, "description", 2_000) || "",
    automationLevel: level,
    businessCategory: optional(raw.business_category, "business_category", 80),
    triggerEvents,
    inputSchema: object(raw.input_schema, "input_schema"),
    fillPolicy: object(raw.fill_policy, "fill_policy"),
    acceptanceCriteria: criteria,
    routingPolicyCode: optional(raw.routing_policy_code, "routing_policy_code", 120),
    stagePolicy,
    idempotencyKey: required(raw.idempotency_key, "idempotency_key", 240),
  };
}

function validatePublication(row: TemplateRow): void {
  if (!Array.isArray(row.acceptance_criteria_json) || row.acceptance_criteria_json.length === 0) {
    throw new HttpFail(422, { code: "template_acceptance_criteria_required" });
  }
  if (["A1", "A2", "A3"].includes(row.automation_level) && (!Array.isArray(row.trigger_event_types) || row.trigger_event_types.length === 0)) {
    throw new HttpFail(422, { code: "template_trigger_events_required" });
  }
  if (["A2", "A3"].includes(row.automation_level) && !row.routing_policy_code) {
    throw new HttpFail(422, { code: "template_routing_policy_required" });
  }
  if (row.automation_level === "A3") {
    const policyError = stagePolicyPublicationError(row.stage_policy_json, row.trigger_event_types);
    if (policyError) throw new HttpFail(422, { code: policyError });
  }
}

async function receipt(client: Parameters<typeof postgresTransaction>[0] extends (client: infer T) => Promise<unknown> ? T : never, key: string) {
  return client.query<{ template_id: string; actor_ref: string; command: string; response_json: unknown }>(
    "SELECT template_id,actor_ref,command,response_json FROM work_order_template_command_receipts WHERE idempotency_key=$1 FOR UPDATE",
    [key],
  );
}

/** Creates a new immutable template version as a draft. Draft contents are not
 * executable; publication validates automation boundaries below. */
export async function createWorkOrderTemplateDraft(actorId: string, raw: WorkOrderTemplateInput) {
  const input = parseDraft(raw);
  if (input.idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return postgresTransaction(async (client) => {
    const prior = await receipt(client, input.idempotencyKey);
    if (prior.rows[0]) {
      if (prior.rows[0].actor_ref !== actorId || prior.rows[0].command !== "template.create_draft") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { template: prior.rows[0].response_json as WorkOrderTemplate, replayed: true };
    }
    const versionRows = await client.query<{ version: number }>(
      "SELECT version FROM work_order_templates WHERE template_code=$1 ORDER BY version DESC FOR UPDATE",
      [input.templateCode],
    );
    const nextVersion = Math.max(0, ...versionRows.rows.map((row) => Number(row.version))) + 1;
    const now = new Date();
    const inserted = await client.query<TemplateRow>(
      `INSERT INTO work_order_templates
       (id,template_code,version,title,description,status,automation_level,business_category,trigger_event_types,input_schema_json,fill_policy_json,
        acceptance_criteria_json,routing_policy_code,stage_policy_json,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       RETURNING *`,
      [nid("wot"), input.templateCode, nextVersion, input.title, input.description, input.automationLevel,
        input.businessCategory, JSON.stringify(input.triggerEvents), JSON.stringify(input.inputSchema), JSON.stringify(input.fillPolicy), JSON.stringify(input.acceptanceCriteria),
        input.routingPolicyCode, JSON.stringify(input.stagePolicy), actorId, now],
    );
    if (!inserted.rows[0]) throw new Error("work-order template draft insert failed");
    const template = publicTemplate(inserted.rows[0]);
    await client.query(
      `INSERT INTO work_order_template_command_receipts (idempotency_key,template_id,actor_ref,command,response_json,created_at)
       VALUES ($1,$2,$3,'template.create_draft',$4,$5)`,
      [input.idempotencyKey, template.id, actorId, JSON.stringify(template), now],
    );
    return { template, replayed: false };
  }, { isolation: "SERIALIZABLE" });
}

async function templateForUpdate(client: Parameters<typeof postgresTransaction>[0] extends (client: infer T) => Promise<unknown> ? T : never, templateId: string): Promise<TemplateRow> {
  const result = await client.query<TemplateRow>("SELECT * FROM work_order_templates WHERE id=$1 FOR UPDATE", [templateId]);
  if (!result.rows[0]) throw new HttpFail(404, { code: "work_order_template_not_found" });
  return result.rows[0];
}

export async function publishWorkOrderTemplate(actorId: string, templateId: string, raw: { idempotency_key?: unknown; expected_version?: unknown }) {
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  const expectedVersion = Number(raw.expected_version);
  if (idempotencyKey.length < 8 || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new HttpFail(422, { code: "template_publish_input_invalid" });
  return postgresTransaction(async (client) => {
    const prior = await receipt(client, idempotencyKey);
    if (prior.rows[0]) {
      if (prior.rows[0].actor_ref !== actorId || prior.rows[0].template_id !== templateId || prior.rows[0].command !== "template.publish") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { template: prior.rows[0].response_json as WorkOrderTemplate, replayed: true };
    }
    const template = await templateForUpdate(client, templateId);
    if (Number(template.version) !== expectedVersion) throw new HttpFail(409, { code: "template_version_conflict", current_version: Number(template.version) });
    if (template.status !== "draft") throw new HttpFail(409, { code: "template_not_publishable", status: template.status });
    validatePublication(template);
    const now = new Date();
    await client.query(
      "UPDATE work_order_templates SET status='retired',updated_at=$1 WHERE template_code=$2 AND status='published'",
      [now, template.template_code],
    );
    const published = await client.query<TemplateRow>(
      "UPDATE work_order_templates SET status='published',published_by=$1,published_at=$2,updated_at=$2 WHERE id=$3 RETURNING *",
      [actorId, now, templateId],
    );
    const publicRow = publicTemplate(published.rows[0]!);
    await client.query(
      `INSERT INTO work_order_template_command_receipts (idempotency_key,template_id,actor_ref,command,response_json,created_at)
       VALUES ($1,$2,$3,'template.publish',$4,$5)`,
      [idempotencyKey, templateId, actorId, JSON.stringify(publicRow), now],
    );
    return { template: publicRow, replayed: false };
  }, { isolation: "SERIALIZABLE" });
}

export async function disableWorkOrderTemplate(actorId: string, templateId: string, raw: { idempotency_key?: unknown; reason?: unknown }) {
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  const reason = required(raw.reason, "reason", 1_000);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return postgresTransaction(async (client) => {
    const prior = await receipt(client, idempotencyKey);
    if (prior.rows[0]) {
      if (prior.rows[0].actor_ref !== actorId || prior.rows[0].template_id !== templateId || prior.rows[0].command !== "template.disable") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { template: prior.rows[0].response_json as WorkOrderTemplate & { disable_reason?: string }, replayed: true };
    }
    const template = await templateForUpdate(client, templateId);
    if (template.status === "retired") throw new HttpFail(409, { code: "template_retired" });
    const now = new Date();
    const disabled = await client.query<TemplateRow>(
      "UPDATE work_order_templates SET status='disabled',updated_at=$1 WHERE id=$2 RETURNING *",
      [now, templateId],
    );
    const publicRow = { ...publicTemplate(disabled.rows[0]!), disable_reason: reason };
    await client.query(
      `INSERT INTO work_order_template_command_receipts (idempotency_key,template_id,actor_ref,command,response_json,created_at)
       VALUES ($1,$2,$3,'template.disable',$4,$5)`,
      [idempotencyKey, templateId, actorId, JSON.stringify(publicRow), now],
    );
    return { template: publicRow, replayed: false };
  }, { isolation: "SERIALIZABLE" });
}

export async function listWorkOrderTemplates(limit = 100, status?: string) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await postgresPool().query<TemplateRow>(
    `SELECT * FROM work_order_templates
      WHERE ($1::text IS NULL OR status=$1)
      ORDER BY template_code,version DESC LIMIT $2`,
    [status || null, safeLimit],
  );
  return { templates: rows.rows.map(publicTemplate) };
}
