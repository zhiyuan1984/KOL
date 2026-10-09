import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { scopedUser, requireSkill, isAdmin, mapUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { DEFAULT_COMPANY_ID } from "../host/kol-memory.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { authorizeConnector, runtimeAgentForSkill, runtimeHash, type RuntimeContext } from "../runtime/execution.js";
import { runtimeAction } from "../runtime/action-store.js";
import { buildCrawlerImportFile, mapCandidateToCrawlerRow, creatorExternalId, isRealKolUid } from "../discovery-import.js";
import { importKolProfilesFromCrawlerConfirmed, isStarryTimeout, lookupImportedKolUid, withTimeout } from "../gateway/import-creator.js";
import { employeeError, isConnectionClassError, sanitizeSecret } from "../discovery-errors.js";
import type { Json } from "../types.js";
import { getSkillTools, getToolPolicy } from "../runtime/store.js";
import { ensureLeadFromDiscoveryCandidate } from "../ticket-domain/kol-event-bridge.js";
import { candidateAssessmentKey, candidateAssessmentView, crawlScoringCriteria, retryCandidateAssessment } from "./assessments.js";

function user() {
  const actor = scopedUser();
  if (!actor?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  return actor;
}
const stamp = (row: Json) => runtimeHash(row);
const company = DEFAULT_COMPANY_ID;
/**
 * 写 Starry 公海失败时的文案纠正：这一步的目标是公海，不是跟进。
 * 上游 "未加入跟进" 是旧流程残留（当年跟进与入库是一步），在此会与前端
 * "已跟进" 拼出自相矛盾的文案，一律纠正为"公海"。
 */
function poolImportMessage(message: string): string {
  return message.replace(/加入跟进/g, "加入公海");
}
function poolImportError(error: unknown): unknown {
  if (error instanceof HttpFail) {
    const detail = (error.detail ?? {}) as Record<string, unknown>;
    if (typeof detail.message === "string" && detail.message.includes("加入跟进")) {
      return new HttpFail(error.status, { ...detail, message: poolImportMessage(detail.message) });
    }
  }
  return error;
}
const identity = (row: Json) => `${String(row.platform).toLowerCase()}:${String(row.id)}`;

/** 总预算覆盖 keyword(20s) + listAll(60s)；核对失败不删行、不盲目重试。 */
const STARRY_RECONCILE_TIMEOUT_MS = 100_000;
/** dispatching 行超过此时长视为孤儿（持有者已死），同样走核对。 */
const STALE_DISPATCHING_MS = 10 * 60_000;

/** Starry 公海导入的授权门禁（抽出供 ingest / follow 复用）。 */
function authorizeStarryImport(action: { context_json: RuntimeContext }, actorId: string): void {
  const importContext = { ...action.context_json, agentId: runtimeAgentForSkill("creator_discovery", actorId), skillId: "creator_discovery" };
  authorizeConnector(importContext, "starrykol");
  const tool = "importKolProfilesFromCrawler";
  const binding = getSkillTools(importContext.skillId, "starrykol").find(item => item.tool_name === tool);
  const policy = getToolPolicy("starrykol", tool);
  if (!binding?.enabled || !policy?.enabled || policy.risk !== "L3" || policy.access !== "write") {
    throw new HttpFail(403, { code: "runtime_tool_not_granted", message: "当前智能体未获准将候选导入正式公海。" });
  }
}

/**
 * 候选导入 Starry 公海（ingest / follow 共用）。
 * - allowFollowed=false（加入公海/补入库）：他人的有效跟进则 409，自己的跟进允许补入库；
 * - allowFollowed=true（跟进顺带入库）：跳过跟进排斥检查，复用已存在的画像行 kol_uid，避免分叉。
 */
async function starryImportCandidate(input: {
  row: Json; actionId: string; actorId: string; sourceBatch: string;
  candidateId: string; snapshotVersion: unknown; allowFollowed: boolean;
}): Promise<{ kol_uid: string; reused: boolean }> {
  const { row, actionId, actorId, sourceBatch, candidateId, allowFollowed } = input;
  const action = await runtimeAction(actionId, actorId);
  authorizeStarryImport(action, actorId);
  const importState = await postgresTransaction(async client => {
    await lock(client, row);
    await currentSnapshot(client, actionId, row, input.snapshotVersion);
    if (!allowFollowed) {
      const owned = await follow(client, row);
      if (owned && owned.employee_id !== actorId) {
        throw new HttpFail(409, { code: "candidate_followed", message: "该红人已被其他员工跟进，不能加入公海。" });
      }
      if (owned) {
        await audit(client, actorId, "discovery.runtime.ingest.follow_retry", { action_id: actionId,
          candidate_id: candidateId, follow_id: owned.id });
      }
    }
    const prior = (await client.query("SELECT * FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id])).rows[0];
    if (prior) {
      if (prior.state === "succeeded") {
        await adoptImportedUid(client, row, String(prior.kol_uid), actorId);
        return { kol_uid: String(prior.kol_uid), reused: true };
      }
      // uncertain：上一次已结束，这次真去 Starry 核对，而不是永远 409。
      // dispatching 超过 10 分钟：视为孤儿（持有者已死），同样核对。
      const orphaned = prior.state === "dispatching" &&
        Date.now() - new Date(prior.updated_at).getTime() > STALE_DISPATCHING_MS;
      if (prior.state !== "uncertain" && !orphaned) {
        throw new HttpFail(409, { code: "import_creator_uncertain", message: "入库请求已提交，正在处理；请稍后再试。" });
      }
      const reconciled = await reconcileUncertainImport(client, {
        row, actionId, actorId, sourceBatch, candidateId, allowFollowed,
      });
      if (reconciled) return reconciled;
      // Starry 侧确实没有：删掉旧行，重新派发（已核对过，非盲目重试）。
      await client.query("DELETE FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3",
        [company, row.platform, row.id]);
      await audit(client, actorId, "discovery.runtime.ingest.reconciled_retry", { action_id: actionId, candidate_id: candidateId,
        source_batch: sourceBatch, prior_state: prior.state });
    }
    const known = await profile(client, row);
    if (known && known.ingest_source !== "discovery-candidate") {
      const owned = (await client.query("SELECT * FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active' FOR UPDATE", [company, known.kol_uid])).rows;
      if (owned.some(item => item.employee_id !== actorId)) throw new HttpFail(409, { code: "follow_conflict", message: "该红人已被其他员工跟进。" });
      if (known.pool_status !== "open" && !owned.some(item => item.employee_id === actorId)) throw new HttpFail(409, { code: "candidate_ownership_unknown", message: "正式档案当前不在公海，请先核对归属。" });
      await adoptImportedUid(client, row, String(known.kol_uid), actorId);
      return { kol_uid: String(known.kol_uid), reused: true };
    }
    await client.query(`INSERT INTO discovery_runtime_imports(company_id,platform,creator_id,action_id,actor_id,state)
      VALUES($1,$2,$3,$4,$5,'dispatching')`, [company, row.platform, row.id, actionId, actorId]);
    await audit(client, actorId, "discovery.runtime.ingest.confirmed", { action_id: actionId, candidate_id: candidateId, source_batch: sourceBatch,
      snapshot_version: input.snapshotVersion, confirmed: true, risk: "L3", via: allowFollowed ? "follow" : "ingest" });
    return null;
  });
  if (importState) return importState;
  try {
    const file = buildCrawlerImportFile([mapCandidateToCrawlerRow({ platform: row.platform, platform_creator_id: row.id,
      nickname: row.name, profile_url: row.source_url })]);
    const receipt = await importKolProfilesFromCrawlerConfirmed({ file, sourceBatch, actor: actorId,
      creatorExternalId: creatorExternalId(row.platform, row.id), candidateId });
    await postgresTransaction(async client => {
      await lock(client, row);
      const now = new Date().toISOString();
      const kolUid = String(receipt.kol_uid);
      await adoptImportedUid(client, row, kolUid, actorId);
      await client.query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,handle,display_name,platform,homepage_url,followers,
        avg_plays,region,ingest_source,pool_status,platform_creator_id,source_batch,source_version,ingested_at,created_at,updated_at,avatar_url,direction)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'discovery-ingest','open',$4,$11,$11,$12,$12,$12,$13,$14)
        ON CONFLICT(company_id,kol_uid) DO UPDATE SET platform_creator_id=EXCLUDED.platform_creator_id,updated_at=EXCLUDED.updated_at`,
      [`profile_${randomUUID()}`, company, kolUid, row.id, row.name, row.platform, row.source_url,
        row.followers == null ? null : String(row.followers), row.avg_views_10 == null ? null : String(row.avg_views_10), row.region, sourceBatch, now, row.avatar_url || null, row.direction || null]);
      await client.query(`UPDATE discovery_runtime_imports SET state='succeeded',kol_uid=$4,receipt=$5,updated_at=now()
        WHERE company_id=$1 AND platform=$2 AND creator_id=$3`, [company, row.platform, row.id, receipt.kol_uid, JSON.stringify(receipt)]);
      await audit(client, actorId, "discovery.runtime.ingested", { action_id: actionId, candidate_id: candidateId, kol_uid: receipt.kol_uid, sent: false, followed: allowFollowed });
    });
    return { kol_uid: String(receipt.kol_uid), reused: false };
  } catch (error) {
    await postgresPool().query("UPDATE discovery_runtime_imports SET state='uncertain',updated_at=now() WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id]);
    throw error;
  }
}
/**
 * 核对 uncertain / 孤儿 dispatching 的入库：真去 Starry 查一次。
 * - Starry 已有 → 补成功落盘，返回 { kol_uid, reused: true }；
 * - Starry 没有 → 返回 null，调用方删掉旧行后重新派发；
 * - 核对本身失败 → 抛 502，不删行、不盲目重试。
 */
async function reconcileUncertainImport(client: PoolClient, input: {
  row: Json; actionId: string; actorId: string; sourceBatch: string; candidateId: string; allowFollowed: boolean;
}): Promise<{ kol_uid: string; reused: boolean } | null> {
  const { row, actionId, actorId, sourceBatch, candidateId, allowFollowed } = input;
  let found: string;
  try {
    found = await withTimeout(
      lookupImportedKolUid({ creatorExternalId: creatorExternalId(row.platform, row.id) }),
      STARRY_RECONCILE_TIMEOUT_MS,
      "pageKolProfiles",
    );
  } catch (error) {
    // 独立落审计，外层业务事务回滚时仍保留核对失败原因。
    await postgresPool().query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)",
      [new Date().toISOString(), actorId, "host.import_creator.reconcile_failed", JSON.stringify({
        action_id: actionId, candidate_id: candidateId, error_detail: sanitizeSecret(error), retried_import: false,
      })]);
    const reason = isStarryTimeout(error)
      ? "达人库无响应"
      : isConnectionClassError(error)
        ? "达人库连接失败"
        : (employeeError(error) || "达人库无响应");
    throw new HttpFail(502, {
      code: "import_creator_uncertain",
      message: `入库状态核对失败（${reason}），请稍后重试；未重复提交。`,
    });
  }
  if (!isRealKolUid(found)) return null;
  const kolUid = String(found);
  await lock(client, row);
  const now = new Date().toISOString();
  try {
    await adoptImportedUid(client, row, kolUid, actorId);
  } catch (error) {
    await postgresPool().query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)",
      [new Date().toISOString(), actorId, "host.import_creator.reconcile_failed", JSON.stringify({
        action_id: actionId, candidate_id: candidateId, error_detail: sanitizeSecret(error), retried_import: false,
      })]);
    throw error;
  }
  await client.query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,handle,display_name,platform,homepage_url,followers,
    avg_plays,region,ingest_source,pool_status,platform_creator_id,source_batch,source_version,ingested_at,created_at,updated_at,avatar_url,direction)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'discovery-ingest','open',$4,$11,$11,$12,$12,$12,$13,$14)
    ON CONFLICT(company_id,kol_uid) DO UPDATE SET platform_creator_id=EXCLUDED.platform_creator_id,updated_at=EXCLUDED.updated_at`,
  [`profile_${randomUUID()}`, company, kolUid, row.id, row.name, row.platform, row.source_url,
    row.followers == null ? null : String(row.followers), row.avg_views_10 == null ? null : String(row.avg_views_10), row.region, sourceBatch, now, row.avatar_url || null, row.direction || null]);
  await client.query(`UPDATE discovery_runtime_imports SET state='succeeded',kol_uid=$4,receipt=$5,updated_at=now()
    WHERE company_id=$1 AND platform=$2 AND creator_id=$3`,
  [company, row.platform, row.id, kolUid, JSON.stringify({ kolUid, reconciled: true, looked_up_after_timeout: true })]);
  await audit(client, actorId, "discovery.runtime.ingested", { action_id: actionId, candidate_id: candidateId,
    kol_uid: kolUid, sent: false, followed: allowFollowed, reconciled: true });
  return { kol_uid: kolUid, reused: true };
}
/** 保留同一 follow_id；真实编号已有归属或身份冲突时拒绝合并。 */
async function adoptImportedUid(client: PoolClient, row: Json, kolUid: string, actorId: string) {
  await client.query(`UPDATE kol_candidate_assessments SET kol_uid=$4
    WHERE company_id=$1 AND platform=$2 AND creator_id=$3`, [company, String(row.platform).toLowerCase(), row.id, kolUid]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`discovery-uid:${company}:${kolUid}`]);
  const formal = (await client.query("SELECT * FROM kol_profile_index WHERE company_id=$1 AND kol_uid=$2 FOR UPDATE", [company, kolUid])).rows[0];
  if (formal && (String(formal.platform).toLowerCase() !== String(row.platform).toLowerCase() ||
    (formal.platform_creator_id && String(formal.platform_creator_id) !== String(row.id)))) {
    throw new HttpFail(409, { code: "candidate_identity_conflict", message: "正式档案的平台身份不一致，请核对后重试。" });
  }
  const targets = (await client.query("SELECT * FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active' FOR UPDATE", [company, kolUid])).rows;
  const existing = (await client.query("SELECT * FROM kol_profile_index WHERE company_id=$1 AND lower(platform)=$2 AND platform_creator_id=$3 AND ingest_source='discovery-candidate' FOR UPDATE",
    [company, String(row.platform).toLowerCase(), String(row.id)])).rows;
  for (const source of existing) {
    if (source.kol_uid === kolUid) continue;
    const owners = (await client.query("SELECT * FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active' FOR UPDATE", [company, source.kol_uid])).rows;
    if (owners.some(item => item.employee_id !== actorId) || (owners.length && targets.length)) {
      throw new HttpFail(409, { code: "follow_conflict", message: "正式档案已有有效跟进关系，未改动原归属。" });
    }
    if (!formal) await client.query("UPDATE kol_profile_index SET kol_uid=$3,ingest_source='discovery-ingest',updated_at=now()::text WHERE company_id=$1 AND kol_uid=$2",
      [company, source.kol_uid, kolUid]);
    await client.query("UPDATE kol_follow_index SET kol_uid=$3,updated_at=now()::text WHERE company_id=$1 AND kol_uid=$2 AND status='active'",
      [company, source.kol_uid, kolUid]);
    if (formal) await client.query("UPDATE kol_profile_index SET pool_status='closed',updated_at=now()::text WHERE id=$1", [source.id]);
  }
  if (targets.some(item => item.employee_id !== actorId)) throw new HttpFail(409, { code: "follow_conflict", message: "该红人已被其他员工跟进。" });
  if ((await client.query("SELECT id FROM kol_follow_index WHERE company_id=$1 AND kol_uid=$2 AND status='active'", [company, kolUid])).rowCount) {
    await client.query("UPDATE kol_profile_index SET pool_status='claimed' WHERE company_id=$1 AND kol_uid=$2", [company, kolUid]);
  }
}
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
    const criteria = await crawlScoringCriteria(actionId, client);
    const assessments = (await client.query(`SELECT a.* FROM kol_candidate_assessments a
      JOIN jsonb_to_recordset($2::jsonb) AS x(platform text,id text,key text)
      ON a.platform=lower(x.platform) AND a.creator_id=x.id AND a.assessment_key=x.key
      WHERE a.company_id=$1`, [company, JSON.stringify(candidates.map(row => ({ platform: row.platform,
        id: String(row.id), key: candidateAssessmentKey(row, criteria) })))])).rows;
    const scores = new Map(assessments.map(a => [`${a.platform}:${a.creator_id}`, a]));
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
        assessment: candidateAssessmentView(scores.get(identity(row))),
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
  if (verb === "score") {
    await retryCandidateAssessment(actionId, action.context_json, row);
    return { ok: true, assessment_state: "scoring" };
  }
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
    const result = await postgresTransaction(async client => {
      await lock(client, row);
      authorizeConnector(action.context_json, "claw");
      await currentSnapshot(client, actionId, row, input.snapshot_version);
      const existing = await follow(client, row);
      if (existing) {
        if (existing.employee_id !== actor.id) throw new HttpFail(409, { code: "follow_conflict", message: "该红人已被其他员工跟进。" });
        const importing = (await client.query("SELECT state FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id])).rows[0];
        return { ok: true, followed: true, reused: true, follow_id: existing.id,
          retry_starry_import: Boolean(importing && importing.state !== "succeeded") };
      }
      const importing = (await client.query("SELECT * FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3", [company, row.platform, row.id])).rows[0];
      if (importing && importing.state !== "succeeded") {
        const orphaned = importing.state === "dispatching" &&
          Date.now() - new Date(importing.updated_at).getTime() > STALE_DISPATCHING_MS;
        if (importing.state === "dispatching" && !orphaned) {
          throw new HttpFail(409, { code: "candidate_import_pending", message: "该红人正在入库，请稍后再跟进。" });
        }
        // uncertain / 孤儿 dispatching：跟进前真去 Starry 核对一次，不再永远 409。
        // Starry 已有 → 补成功落盘后继续跟进；没有 → 删掉僵尸行，跟进走本地建档，
        // 跟进成功后的 Starry 写入会重新入库；核对本身失败 → 502 诚实报错。
        const reconciled = await reconcileUncertainImport(client, {
          row, actionId, actorId: actor.id, sourceBatch: `runtime:${actionId}`, candidateId, allowFollowed: true,
        });
        if (!reconciled) {
          await client.query("DELETE FROM discovery_runtime_imports WHERE company_id=$1 AND platform=$2 AND creator_id=$3",
            [company, row.platform, row.id]);
          await audit(client, actor.id, "discovery.runtime.import.zombie_cleared", { action_id: actionId,
            candidate_id: candidateId, prior_state: importing.state });
        }
      }
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
    // 跟进成功后建档为线索（去重：平台+账号已存在则复用）。桥接失败不破坏跟进主动作。
    let followed: Record<string, unknown> = result as unknown as Record<string, unknown>;
    if (result.followed && !result.reused) {
      try {
        const bridged = await ensureLeadFromDiscoveryCandidate(actor.id, isAdmin(actor), {
          platform: row.platform, account_handle: row.id, display_name: row.name,
          account_url: row.source_url, follower_count: row.followers,
          category: row.direction, candidate_id: candidateId,
        });
        followed = { ...result, lead_id: bridged.lead_id, lead_created: bridged.created };
      } catch (error) {
        console.error("kol lead bridge failed after discovery follow", { candidate_id: candidateId, error: error instanceof Error ? error.message : error });
      }
    }
    // 需求变更（2026-10-08 qiyou）：跟进成功后写 Starry 公海。失败不破坏跟进，如实返回状态。
    if (followed.followed && (!followed.reused || followed.retry_starry_import)) {
      try {
        const imported = await starryImportCandidate({ row, actionId, actorId: actor.id,
          sourceBatch: `runtime:${actionId}`, candidateId,
          snapshotVersion: input.snapshot_version, allowFollowed: true });
        return { ...followed, starry_imported: true, starry_kol_uid: imported.kol_uid };
      } catch (error) {
        const rawMessage = error instanceof HttpFail
          ? String((error.detail as { message?: string } | undefined)?.message || error.message)
          : "Starry 入库失败";
        const message = poolImportMessage(rawMessage);
        console.error("starry import failed after discovery follow", { candidate_id: candidateId, error: message });
        return { ...followed, starry_imported: false, starry_error: message };
      }
    }
    return followed;
  }
  if (verb !== "ingest") throw new HttpFail(404, { code: "candidate_action_unknown" });
  requireSkill("creator_discovery");
  authorizeStarryImport(action, actor.id);
  if (input.confirmed !== true) throw new HttpFail(422, { code: "l3_confirm_required", message: "加入公海需要确认。" });
  const sourceBatch = `runtime:${actionId}`;
  let imported;
  try {
    imported = await starryImportCandidate({ row, actionId, actorId: actor.id, sourceBatch,
      candidateId, snapshotVersion: input.snapshot_version, allowFollowed: false });
  } catch (error) {
    throw poolImportError(error);
  }
  return { ok: true, kol_uid: imported.kol_uid, in_pool: true, reused: imported.reused };
}
