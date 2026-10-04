import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";

type TemplateRow = { id: string; template_code: string; version: number | string; status: string; automation_level: string; routing_policy_code: string | null };
type ReleaseRow = { template_id: string; automation_level: "A1" | "A2"; status: "enabled" | "disabled"; minimum_confidence: number | string; routing_policy_code: string | null; enabled_by: string | null; enabled_at: Date | string | null; disabled_by: string | null; disabled_at: Date | string | null; reason: string; created_at: Date | string; updated_at: Date | string };

export type WorkOrderAutomationReleaseInput = {
  action?: unknown;
  minimum_confidence?: unknown;
  routing_policy_code?: unknown;
  reason?: unknown;
  idempotency_key?: unknown;
};

function required(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function releasePublic(row: ReleaseRow) {
  return {
    template_id: row.template_id,
    automation_level: row.automation_level,
    status: row.status,
    minimum_confidence: Number(row.minimum_confidence),
    routing_policy_code: row.routing_policy_code,
    enabled_by: row.enabled_by,
    enabled_at: row.enabled_at == null ? null : new Date(row.enabled_at).toISOString(),
    disabled_by: row.disabled_by,
    disabled_at: row.disabled_at == null ? null : new Date(row.disabled_at).toISOString(),
    reason: row.reason,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

async function receipt(client: PoolClient, key: string) {
  return client.query<{ template_id: string; actor_ref: string; command: string; response_json: unknown }>(
    "SELECT template_id,actor_ref,command,response_json FROM work_order_template_command_receipts WHERE idempotency_key=$1 FOR UPDATE",
    [key],
  );
}

/** Enables/disables a specific published template version. Template publication
 * merely makes it eligible for shadow selection; this release is the second
 * explicit control required before the A1/A2 executor can materialize work. */
export async function setWorkOrderAutomationRelease(actorId: string, templateId: string, raw: WorkOrderAutomationReleaseInput) {
  const action = required(raw.action, "action", 20);
  if (action !== "enabled" && action !== "disabled") throw new HttpFail(422, { code: "automation_release_action_invalid" });
  const reason = required(raw.reason, "reason", 1_000);
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  const confidence = raw.minimum_confidence == null || raw.minimum_confidence === "" ? 0.9 : Number(raw.minimum_confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new HttpFail(422, { code: "automation_release_confidence_invalid" });
  const routingPolicyCode = raw.routing_policy_code == null || String(raw.routing_policy_code).trim() === "" ? null : required(raw.routing_policy_code, "routing_policy_code", 120);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return postgresTransaction(async (client) => {
    const priorReceipt = await receipt(client, idempotencyKey);
    if (priorReceipt.rows[0]) {
      if (priorReceipt.rows[0].template_id !== templateId || priorReceipt.rows[0].actor_ref !== actorId || priorReceipt.rows[0].command !== `automation.release.${action}`) throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { release: priorReceipt.rows[0].response_json, replayed: true };
    }
    const templateResult = await client.query<TemplateRow>("SELECT id,template_code,version,status,automation_level,routing_policy_code FROM work_order_templates WHERE id=$1 FOR UPDATE", [templateId]);
    const template = templateResult.rows[0];
    if (!template) throw new HttpFail(404, { code: "work_order_template_not_found" });
    if (template.status !== "published") throw new HttpFail(409, { code: "automation_release_requires_published_template", status: template.status });
    if (template.automation_level !== "A1" && template.automation_level !== "A2") throw new HttpFail(422, { code: "automation_release_level_not_supported", automation_level: template.automation_level });
    const effectiveRouting = routingPolicyCode || template.routing_policy_code;
    if (template.automation_level === "A2" && effectiveRouting !== "task_owner") {
      throw new HttpFail(422, { code: "automation_release_routing_not_supported", supported: ["task_owner"] });
    }
    const priorRelease = await client.query<ReleaseRow>("SELECT * FROM work_order_automation_releases WHERE template_id=$1 FOR UPDATE", [templateId]);
    const now = new Date();
    const release = await client.query<ReleaseRow>(
      `INSERT INTO work_order_automation_releases
       (template_id,automation_level,status,minimum_confidence,routing_policy_code,enabled_by,enabled_at,disabled_by,disabled_at,reason,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7,$7)
       ON CONFLICT (template_id) DO UPDATE SET
         automation_level=EXCLUDED.automation_level,status=EXCLUDED.status,minimum_confidence=EXCLUDED.minimum_confidence,
         routing_policy_code=EXCLUDED.routing_policy_code,enabled_by=EXCLUDED.enabled_by,enabled_at=EXCLUDED.enabled_at,
         disabled_by=EXCLUDED.disabled_by,disabled_at=EXCLUDED.disabled_at,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [templateId, template.automation_level, action, confidence, effectiveRouting, action === "enabled" ? actorId : null, action === "enabled" ? now : null, action === "disabled" ? actorId : null, action === "disabled" ? now : null, reason],
    );
    const publicRelease = releasePublic(release.rows[0]!);
    await client.query(
      `INSERT INTO work_order_automation_release_events (id,template_id,action,prior_json,current_json,actor_ref,reason,idempotency_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [nid("wore"), templateId, action, JSON.stringify(priorRelease.rows[0] ? releasePublic(priorRelease.rows[0]) : {}), JSON.stringify(publicRelease), actorId, reason, idempotencyKey, now],
    );
    await client.query(
      `INSERT INTO work_order_template_command_receipts (idempotency_key,template_id,actor_ref,command,response_json,created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [idempotencyKey, templateId, actorId, `automation.release.${action}`, JSON.stringify(publicRelease), now],
    );
    return { release: publicRelease, replayed: false };
  }, { isolation: "SERIALIZABLE" });
}

export async function listWorkOrderAutomationReleases() {
  const rows = await postgresPool().query<ReleaseRow>("SELECT * FROM work_order_automation_releases ORDER BY updated_at DESC,template_id");
  return { releases: rows.rows.map(releasePublic) };
}
