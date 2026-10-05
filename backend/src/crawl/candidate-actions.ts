import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { scopedUser, requireSkill, isAdmin, mapUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { DEFAULT_COMPANY_ID } from "../host/kol-memory.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { authorizeConnector, runtimeAgentForSkill, runtimeHash, type RuntimeContext } from "../runtime/execution.js";
import { runtimeAction } from "../runtime/action-store.js";
import { buildCrawlerImportFile, mapCandidateToCrawlerRow, creatorExternalId } from "../discovery-import.js";
import { importKolProfilesFromCrawlerConfirmed } from "../gateway/import-creator.js";
import type { Json } from "../types.js";
import { getSkillTools, getToolPolicy } from "../runtime/store.js";

function user() {
  const actor = scopedUser();
  if (!actor?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  return actor;
}
const stamp = (row: Json) => runtimeHash(row);
const company = DEFAULT_COMPANY_ID;
const identity = (row: Json) => `${String(row.platform).toLowerCase()}:${String(row.id)}`;
async function lock(client: PoolClient, row: Json) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`discovery:${company}:${identity(row)}`]);
}
async function profile(client: PoolClient, row: Json) {
  return (await client.query(`SELECT * FROM kol_profile_index WHERE company_id=$1
    AND lower(platform)=$2 AND platform_creator_id=$3 ORDER BY CASE WHEN ingest_source='discovery-candidate' THEN 1 ELSE 0 END LIMIT 1`,
  [company, String(row.platform).toLowerCase(), String(row.id)])).rows[0];
}
async function follow(client: PoolClient, row: Json) {
  return (await client.query(`SELECT f.* FROM kol_follow_index f JOIN kol_profile_index p
    ON p.company_id=f.company_id AND p.kol_uid=f.kol_uid WHERE f.company_id=$1 AND f.status='active'
    AND lower(p.platform)=$2 AND p.platform_creator_id=$3 LIMIT 1`,
  [company, String(row.platform).toLowerCase(), String(row.id)])).rows[0];
}
async function audit(client: PoolClient, actor: string, event: string, payload: Json) {
  await client.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)",
    [new Date().toISOString(), actor, event, JSON.stringify(payload)]);
}
async function currentSnapshot(client: PoolClient, actionId: string, row: Json, snapshot: unknown) {
  const job = (await client.query("SELECT result_json FROM runtime_crawl_jobs WHERE id=$1 FOR SHARE", [actionId])).rows[0];
  const current = job?.result_json?.candidates?.find((item: Json) => String(item.id) === String(row.id));
  if (!current || stamp(current) !== snapshot) throw new HttpFail(409, { code: "candidate_changed", message: "候选资料已更新，请刷新后再操作。" });
}

/** Filtering precedes employee output and model input, including saved snapshots. */
export async function runtimeCandidateViews(context: RuntimeContext, actionId: string, candidates: Json[]): Promise<Json[]> {
  authorizeConnector(context, "claw");
  if (scopedUser() && scopedUser()!.id !== context.userId) throw new HttpFail(403, { code: "candidate_scope_denied" });
  const actorRow = (await postgresPool().query("SELECT * FROM users WHERE id=$1 AND active=1", [context.userId])).rows[0];
  if (!actorRow) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  const actor = mapUser(actorRow);
  const client = await postgresPool().connect();
  try {
    const decisions = (await client.query(`SELECT DISTINCT ON (d.candidate_id) d.candidate_id,d.ignored
      FROM discovery_runtime_decisions d JOIN runtime_actions a ON a.id=d.action_id
      WHERE d.actor_id=$1 AND a.actor_id=$1 AND (d.action_id=$2 OR a.session_id=$3)
      ORDER BY d.candidate_id,d.updated_at DESC,d.action_id`, [actor.id, actionId, context.sessionId || null])).rows;
    const ignored = new Set(decisions.filter(row => row.ignored).map(row => row.candidate_id));
    const profiles = (await client.query(`SELECT p.*,f.employee_id,f.id AS follow_id FROM kol_profile_index p
      LEFT JOIN kol_follow_index f ON f.company_id=p.company_id AND f.kol_uid=p.kol_uid AND f.status='active'
      WHERE p.company_id=$1 AND (lower(p.platform),p.platform_creator_id) IN
        (SELECT lower(x.platform),x.id FROM jsonb_to_recordset($2::jsonb) AS x(platform text,id text))`,
      [company, JSON.stringify(candidates.map(row => ({ platform: row.platform, id: String(row.id) })))])).rows;
    const indexed = new Map<string, typeof profiles>();
    for (const p of profiles) {
      const key = `${String(p.platform).toLowerCase()}:${p.platform_creator_id}`;
      indexed.set(key, [...(indexed.get(key) || []), p]);
    }
    const out: Json[] = [];
    for (const row of candidates) {
      const matches = indexed.get(identity(row)) || [];
      const owned = matches.find(p => p.follow_id);
      if (owned && owned.employee_id !== actor.id && !isAdmin(actor)) continue;
      const known = matches.find(p => p.ingest_source !== "discovery-candidate");
      out.push({ ...row, ignored: ignored.has(String(row.id)), followed: owned?.employee_id === actor.id,
        in_pool: Boolean(known && known.ingest_source !== "discovery-candidate" && known.pool_status === "open" && !owned),
        snapshot_version: stamp(row) });
    }
    return out;
  } finally { client.release(); }
}

export async function runtimeCandidateCommand(actionId: string, candidateId: string, verb: string, input: Json): Promise<Json> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpFail(422, { code: "candidate_input_invalid" });
  const actor = user();
  const action = await runtimeAction(actionId, actor.id);
  if (action.tool_name !== "start_crawl") throw new HttpFail(404, { code: "candidate_not_found" });
  authorizeConnector(action.context_json, "claw");
  const job = (await postgresPool().query("SELECT result_json FROM runtime_crawl_jobs WHERE id=$1 AND actor_id=$2", [actionId, actor.id])).rows[0];
  const row = job?.result_json?.candidates?.find((item: Json) => String(item.id) === candidateId) as Json | undefined;
  if (!row) throw new HttpFail(404, { code: "candidate_not_found" });
  if (input.snapshot_version !== stamp(row)) throw new HttpFail(409, { code: "candidate_changed", message: "候选资料已更新，请刷新后再操作。" });
  const checked = await runtimeCandidateViews(action.context_json, actionId, [row]);
  if (!checked.length) throw new HttpFail(403, { code: "candidate_scope_denied", message: "该红人已有有效跟进关系，当前不可操作。" });
  if (verb === "ignore" || verb === "restore") {
    await postgresTransaction(async client => {
      await lock(client, row);
      authorizeConnector(action.context_json, "claw");
      await currentSnapshot(client, actionId, row, input.snapshot_version);
      const owned = await follow(client, row);
      if (owned && owned.employee_id !== actor.id && !isAdmin(actor)) throw new HttpFail(403, { code: "candidate_scope_denied" });
      await client.query(`INSERT INTO discovery_runtime_decisions(actor_id,action_id,candidate_id,ignored) VALUES($1,$2,$3,$4)
        ON CONFLICT(actor_id,action_id,candidate_id) DO UPDATE SET ignored=EXCLUDED.ignored,updated_at=now()`,
      [actor.id, actionId, candidateId, verb === "ignore"]);
      await audit(client, actor.id, `discovery.candidate.${verb}`, { action_id: actionId, candidate_id: candidateId });
    });
    return { ok: true, ignored: verb === "ignore" };
  }
  if (checked[0].ignored) throw new HttpFail(409, { code: "candidate_ignored", message: "请先恢复考虑该红人。" });
  if (verb === "follow") {
    if (input.confirmed !== true) throw new HttpFail(422, { code: "follow_click_required" });
    return postgresTransaction(async client => {
      await lock(client, row);
      authorizeConnector(action.context_json, "claw");
      await currentSnapshot(client, actionId, row, input.snapshot_version);
      const existing = await follow(client, row);
      if (existing) {
        if (existing.employee_id !== actor.id) throw new HttpFail(409, { code: "follow_conflict", message: "该红人已被其他员工跟进。" });
        return { ok: true, followed: true, reused: true, follow_id: existing.id };
      }
      const importing = (await client.query("SELECT state FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id])).rows[0];
      if (importing && importing.state !== "succeeded") throw new HttpFail(409, { code: "candidate_import_pending", message: "该红人的入库结果正在核对，请稍后再跟进。" });
      const known = await profile(client, row);
      if (known && known.ingest_source !== "discovery-candidate" && known.pool_status !== "open") {
        throw new HttpFail(409, { code: "candidate_ownership_unknown", message: "正式档案当前不在公海，请先核对归属。" });
      }
      const uid = known?.kol_uid || `candidate:${identity(row)}`;
      const now = new Date().toISOString();
      if (!known) await client.query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,handle,display_name,platform,homepage_url,
        followers,avg_plays,region,ingest_source,pool_status,platform_creator_id,source_version,created_at,updated_at,avatar_url,direction)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'discovery-candidate','claimed',$4,$11,$12,$12,$13,$14)`,
      [`profile_${randomUUID()}`, company, uid, row.id, row.name, row.platform, row.source_url,
        row.followers == null ? null : String(row.followers), row.avg_views_10 == null ? null : String(row.avg_views_10), row.region, actionId, now, row.avatar_url || null, row.direction || null]);
      const followId = `follow_${randomUUID()}`;
      const brand = actor.brands[0];
      if (!brand) throw new HttpFail(403, { code: "follow_brand_required", message: "当前账号没有可跟进的品牌范围。" });
      await client.query(`INSERT INTO kol_follow_index(id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,
        claimed_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$7,$7)`,
      [followId, company, uid, brand, actor.id, actor.name, now]);
      await client.query(`INSERT INTO discovery_runtime_ownership(company_id,platform,creator_id,follow_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(company_id,platform,creator_id) DO UPDATE SET follow_id=EXCLUDED.follow_id`,
        [company, String(row.platform).toLowerCase(), row.id, followId]);
      await client.query("UPDATE kol_profile_index SET pool_status='claimed',updated_at=$3 WHERE company_id=$1 AND kol_uid=$2", [company, uid, now]);
      await audit(client, actor.id, "discovery.candidate.followed", { action_id: actionId, candidate_id: candidateId, follow_id: followId,
        snapshot_version: input.snapshot_version, confirmed: true, risk: "L3", claimed_at_not_effective: true, imported: false, sent: false, stage_changed: false });
      return { ok: true, followed: true, follow_id: followId, kol_uid: uid, imported: false };
    });
  }
  if (verb !== "ingest") throw new HttpFail(404, { code: "candidate_action_unknown" });
  requireSkill("creator_discovery");
  const importContext = { ...action.context_json, agentId: runtimeAgentForSkill("creator_discovery", actor.id), skillId: "creator_discovery" };
  const authorizeImport = () => {
    authorizeConnector(importContext, "starrykol");
    const tool = "importKolProfilesFromCrawler";
    const binding = getSkillTools(importContext.skillId, "starrykol").find(item => item.tool_name === tool);
    const policy = getToolPolicy("starrykol", tool);
    if (!binding?.enabled || !policy?.enabled || policy.risk !== "L3" || policy.access !== "write") {
      throw new HttpFail(403, { code: "runtime_tool_not_granted", message: "当前智能体未获准将候选导入正式公海。" });
    }
  };
  authorizeImport();
  if (input.confirmed !== true) throw new HttpFail(422, { code: "l3_confirm_required", message: "加入公海需要确认。" });
  const sourceBatch = `runtime:${actionId}`;
  const importState = await postgresTransaction(async client => {
    await lock(client, row);
    authorizeImport();
    await currentSnapshot(client, actionId, row, input.snapshot_version);
    if (await follow(client, row)) throw new HttpFail(409, { code: "candidate_followed", message: "该红人已有有效跟进关系，不能加入公海。" });
    const known = await profile(client, row);
    if (known && known.ingest_source !== "discovery-candidate") {
      if (known.pool_status !== "open") throw new HttpFail(409, { code: "candidate_ownership_unknown", message: "正式档案当前不在公海，请先核对归属。" });
      return { ok: true, kol_uid: known.kol_uid, reused: true };
    }
    const prior = (await client.query("SELECT * FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id])).rows[0];
    if (prior) {
      if (prior.state === "succeeded") return { ok: true, kol_uid: prior.kol_uid, reused: true };
      throw new HttpFail(409, { code: "import_creator_uncertain", message: "入库请求已提交，正在核对结果；请勿重复提交。" });
    }
    await client.query(`INSERT INTO discovery_runtime_imports(company_id,platform,creator_id,action_id,actor_id,state)
      VALUES($1,$2,$3,$4,$5,'dispatching')`, [company, row.platform, row.id, actionId, actor.id]);
    await audit(client, actor.id, "discovery.runtime.ingest.confirmed", { action_id: actionId, candidate_id: candidateId, source_batch: sourceBatch,
      snapshot_version: input.snapshot_version, confirmed: true, risk: "L3" });
    return null;
  });
  if (importState) return importState;
  try {
    authorizeImport();
    const file = buildCrawlerImportFile([mapCandidateToCrawlerRow({ platform: row.platform, platform_creator_id: row.id,
      nickname: row.name, profile_url: row.source_url })]);
    const receipt = await importKolProfilesFromCrawlerConfirmed({ file, sourceBatch, actor: actor.id,
      creatorExternalId: creatorExternalId(row.platform, row.id), candidateId });
    await postgresTransaction(async client => {
      await lock(client, row);
      const now = new Date().toISOString();
      await client.query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,handle,display_name,platform,homepage_url,followers,
        avg_plays,region,ingest_source,pool_status,platform_creator_id,source_batch,source_version,ingested_at,created_at,updated_at,avatar_url,direction)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'discovery-ingest','open',$4,$11,$11,$12,$12,$12,$13,$14)
        ON CONFLICT(company_id,kol_uid) DO UPDATE SET platform_creator_id=EXCLUDED.platform_creator_id,updated_at=EXCLUDED.updated_at`,
      [`profile_${randomUUID()}`, company, receipt.kol_uid, row.id, row.name, row.platform, row.source_url,
        row.followers == null ? null : String(row.followers), row.avg_views_10 == null ? null : String(row.avg_views_10), row.region, sourceBatch, now, row.avatar_url || null, row.direction || null]);
      await client.query(`UPDATE discovery_runtime_imports SET state='succeeded',kol_uid=$4,receipt=$5,updated_at=now()
        WHERE company_id=$1 AND platform=$2 AND creator_id=$3`, [company, row.platform, row.id, receipt.kol_uid, JSON.stringify(receipt)]);
      await audit(client, actor.id, "discovery.runtime.ingested", { action_id: actionId, candidate_id: candidateId, kol_uid: receipt.kol_uid, sent: false, followed: false });
    });
    return { ok: true, kol_uid: receipt.kol_uid, in_pool: true };
  } catch (error) {
    await postgresPool().query("UPDATE discovery_runtime_imports SET state='uncertain',updated_at=now() WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id]);
    throw error;
  }
}
