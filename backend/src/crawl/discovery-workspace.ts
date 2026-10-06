import { createHash } from "node:crypto";
import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { effectiveSkillTemplate } from "../host/skill-sop.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { assertRuntimeSkill, runtimeAgentForSkill } from "../runtime/execution.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import { DISCOVERY_PLATFORMS, DISCOVERY_REGION_CODES, DISCOVERY_KEYWORD_PACKS,
  MAX_DISCOVERY_DIRECTIONS, MAX_DISCOVERY_TARGET } from "../discovery-template.js";

const invalid = (): never => { throw new HttpFail(422, { code: "discovery_brief_invalid", message: "请核对平台、地区、关键词和筛选范围。" }); };
export function validateWorkspaceBrief(input: unknown): Json {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const b = input as Json;
  if (!Array.isArray(b.platforms) || b.platforms.length !== 1 || !DISCOVERY_PLATFORMS.includes(b.platforms[0] as never)) return invalid();
  if (!DISCOVERY_REGION_CODES.includes(b.region as never)) return invalid();
  if (!Array.isArray(b.directions) || b.directions.length > MAX_DISCOVERY_DIRECTIONS
    || b.directions.some(x => !DISCOVERY_KEYWORD_PACKS.some(pack => pack.id === x))) return invalid();
  if (!Array.isArray(b.keywords) || !b.keywords.length || b.keywords.length > 40
    || b.keywords.some(x => typeof x !== "string" || !x.trim() || x.length > 200)) return invalid();
  for (const key of ["min_followers", "min_avg_plays_10", "expect_count"]) {
    if (!Number.isSafeInteger(b[key]) || Number(b[key]) < 0) return invalid();
  }
  if (b.max_followers != null && (!Number.isSafeInteger(b.max_followers) || Number(b.max_followers) < Number(b.min_followers))) return invalid();
  if (Number(b.expect_count) < 1 || Number(b.expect_count) > MAX_DISCOVERY_TARGET) return invalid();
  b.max_followers = b.max_followers ?? null;
  return Object.fromEntries(["platforms", "region", "directions", "keywords", "min_followers", "max_followers", "min_avg_plays_10", "expect_count"].map(key => [key, b[key]]));
}

/** Prepare a durable task and a pending thinking run. No model or external collection runs here. */
export async function createDiscoveryWorkspace(inputBody: unknown): Promise<Json> {
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  if (!inputBody || typeof inputBody !== "object" || Array.isArray(inputBody)) return invalid();
  const body = inputBody as Json;
  const agentId = runtimeAgentForSkill("crawler_collect", user.id);
  assertRuntimeSkill({ agentId, skillId: "crawler_collect", userId: user.id, runId: "discovery-prepare" });
  const brief = validateWorkspaceBrief(body.brief);
  if (typeof body.request_id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.request_id)) throw new HttpFail(422, { code: "request_id_required" });
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 20000) return invalid();
  const key = createHash("sha256").update(`${user.id}:${body.request_id}`).digest("hex").slice(0, 32);
  const taskId = `wi_discovery_${key}`, sessionId = `ses_discovery_${key}`, runId = `run_discovery_${key}`;
  const template = effectiveSkillTemplate(requireTaskDefinition("crawler_collect"));
  const workspace = { kind: "discovery", version: 1, agent_id: agentId, profile: "lead", brief,
    template, template_version: template.version, brief_version: String(body.version || "discovery-brief.v1"),
    return_to: "/?tab=discovery", submitted_text: body.text };
  // Keep the resolved agent on both the workspace and task input. The message route
  // resolves bound runs from input, so this prevents it from reopening an employee
  // choice after the durable workspace has already selected an eligible agent.
  const input = { prompt: body.text, agent_id: agentId, _skill_template: template, discovery_workspace: workspace };
  const entities = { discovery_brief: brief };
  return postgresTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [taskId]);
    const found = (await client.query("SELECT input,session_id FROM tickets WHERE id=$1 AND owner_user_id=$2", [taskId, user.id])).rows[0];
    if (found) {
      const previous = JSON.parse(found.input).discovery_workspace;
      if (JSON.stringify(previous.brief) !== JSON.stringify(brief) || previous.submitted_text !== body.text) {
        throw new HttpFail(409, { code: "discovery_request_conflict" });
      }
    } else {
      const now = new Date().toISOString();
      const title = `AI发现 · ${(brief.platforms as string[])[0]} · ${(brief.keywords as string[]).join("、").slice(0, 100)}`;
      await client.query(`INSERT INTO sessions(id,title,created_at,updated_at,kind,disabled,owner_user_id)
        VALUES($1,$2,$3,$3,'work',0,$4)`, [sessionId, title, now, user.id]);
      await client.query(`INSERT INTO tickets(id,owner_user_id,task_type,title,skill,profile,session_id,input,entities,created_at,updated_at)
        VALUES($1,$2,'crawler_collect',$3,'crawler_collect','lead',$4,$5,$6,$7,$7)`,
      [taskId, user.id, title, sessionId, JSON.stringify(input), JSON.stringify(entities), now]);
      await client.query(`INSERT INTO task_runs(id,work_item_id,session_id,input,entities,created_at)
        VALUES($1,$2,$3,$4,$5,$6)`, [runId, taskId, sessionId, JSON.stringify(input), JSON.stringify(entities), now]);
    }
    const run = (await client.query("SELECT status FROM task_runs WHERE id=$1", [runId])).rows[0];
    return { task_id: taskId, session_id: sessionId, duplicate: Boolean(found),
      pending: ["pending", "failed"].includes(String(run?.status)) ? { text: body.text, intent: "crawler_collect", task_type: "crawler_collect",
        work_item_id: taskId, run_id: runId, agent_id: agentId, entities } : null };
  });
}

/** Recover the original pending analysis without creating another task or run. */
export async function pendingDiscoveryWorkspace(taskId: string): Promise<Json> {
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  const row = (await postgresPool().query(`SELECT t.input,r.id AS run_id,r.status,t.status AS task_status,t.session_id
    FROM tickets t JOIN task_runs r ON r.work_item_id=t.id
    WHERE t.id=$1 AND t.owner_user_id=$2 ORDER BY r.created_at LIMIT 1`, [taskId, user.id])).rows[0];
  if (!row) throw new HttpFail(404, { code: "discovery_task_not_found" });
  const workspace = JSON.parse(row.input).discovery_workspace;
  if (workspace?.kind !== "discovery") throw new HttpFail(404, { code: "discovery_task_not_found" });
  assertRuntimeSkill({ agentId: workspace.agent_id, skillId: "crawler_collect", userId: user.id, runId: row.run_id });
  const retryable = ["pending", "failed"].includes(String(row.status))
    && ["pending", "failed"].includes(String(row.task_status));
  return { pending: retryable ? { text: workspace.submitted_text, intent: "crawler_collect",
    task_type: "crawler_collect", work_item_id: taskId, run_id: row.run_id, agent_id: workspace.agent_id,
    entities: { discovery_brief: workspace.brief } } : null };
}
