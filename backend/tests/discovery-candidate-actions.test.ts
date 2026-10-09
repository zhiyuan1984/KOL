import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, resetConn } from "../src/db.js";
import { postgresPool } from "../src/postgres/pool.js";
import { mapUser, withScopedUser, type AppUser } from "../src/auth.js";
import { setAgentSkill, setSkillConnector, setConnectorConfig, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";
import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import { runtimeCandidateCommand, runtimeCandidateViews } from "../src/crawl/candidate-actions.js";
import { readPublicPoolPage, parsePoolPageOptions } from "../src/postgres/public-pool.js";
import { discoveryResultContext } from "../src/crawl/context.js";
import type { RuntimeContext } from "../src/runtime/execution.js";
import { enqueueCandidateAssessments, scoreDiscoveryCandidate } from "../src/crawl/assessments.js";
import { postgresTransaction } from "../src/postgres/pool.js";
import { setKolJevFetch } from "../src/host/kol-jev-assessment.js";
import { importKolProfilesFromCrawlerConfirmed, lookupImportedKolUid } from "../src/gateway/import-creator.js";

vi.mock("../src/gateway/import-creator.js", () => ({
  importKolProfilesFromCrawlerConfirmed: vi.fn(),
  lookupImportedKolUid: vi.fn(),
  isStarryTimeout: (error: unknown) => /timeout|timed?\s*out/i.test(error instanceof Error ? error.message : String(error)),
  withTimeout: vi.fn(async (operation: Promise<unknown>) => operation),
}));
const COMPANY = "company:amperetime";
const candidate = { id: "stable-channel", name: "Camping channel", platform: "youtube", source_url: "https://youtube.com/channel/stable-channel", followers: 3000000, avg_views_10: null, region: null };
let temp: string;
let users: AppUser[];
const ctx = (id: string): RuntimeContext => ({ agentId: "agent:discovery-test", skillId: "crawler_collect", userId: id, runId: "test", sessionId: `session-${id}` });
const acting = <T>(id: number, action: () => T) => withScopedUser(users[id], action);
async function version(id = 0) { return acting(id, async () => (await runtimeCandidateViews(ctx(users[id].id), `action-${id}`, [candidate]))[0]?.snapshot_version); }
async function command(id: number, verb: string, snapshot: unknown, confirmed = true) {
  return acting(id, () => runtimeCandidateCommand(`action-${id}`, candidate.id, verb, { snapshot_version: snapshot, confirmed }));
}
beforeEach(async () => {
  await freshTestDatabase();
  // 旧模板可能早于线索/公海品牌迁移；只在独立测试库补齐真实 schema。
  const schema = fs.readFileSync(new URL("../scripts/apply-postgres-schema.ts", import.meta.url), "utf8");
  const leadCreate = schema.match(/`(CREATE TABLE IF NOT EXISTS kol_leads \([\s\S]*?\n    \))`/);
  if (!leadCreate) throw new Error("kol_leads schema not found");
  await postgresPool().query(leadCreate[1]);
  await postgresPool().query(fs.readFileSync(new URL("../migrations/029_discovery_dedup_score.sql", import.meta.url), "utf8"));
  await postgresPool().query(fs.readFileSync(new URL("../migrations/030_pool_brand_visibility.sql", import.meta.url), "utf8"));
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-candidate-actions-"));
  process.env.LINGONG_DATA = temp; process.env.AUTH_MODE = "enabled"; process.env.NODE_ENV = "test";
  resetConn();
  const db = getConn();
  for (const skill of ["crawler_collect", "creator_discovery"]) setAgentSkill("agent:discovery-test", skill, true, 0);
  seedPublishedAgent("agent:discovery-test");
  createAgentBinding({ agent_id: "agent:discovery-test", target_type: "organization_unit", target_id: "org:lt_team", company_id: COMPANY, source: "test" });
  const people = db.prepare("SELECT person_ref FROM organization_memberships WHERE org_unit_id='org:lt_team' AND status='active' ORDER BY person_ref LIMIT 2").all() as { person_ref: string }[];
  expect(people.length).toBe(2);
  for (let i = 0; i < 2; i++) {
    db.prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES(?,?,?,'test-password','["employee"]','["LT"]','',1,'now','now')`).run(`employee-${i}`, `employee-${i}`, `employee-${i}`);
    db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref=?").run(`employee-${i}`, people[i].person_ref);
  }
  users = [0, 1].map(i => mapUser(db.prepare("SELECT * FROM users WHERE id=?").get(`employee-${i}`) as never));
  const credential = configureCrawlerFixture("http://crawler.example.test/mcp");
  setSkillConnector("crawler_collect", "claw", true, 0);
  db.prepare(`INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('starrykol','Starry',1,'configured','now')
    ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,enabled=EXCLUDED.enabled,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`).run();
  setSkillConnector("creator_discovery", "starrykol", true, 0);
  setConnectorConfig("starrykol", { url: "http://starry.example.test/mcp", bearer_secret_ref: credential.id }, 0);
  setToolPolicy("starrykol", "importKolProfilesFromCrawler", { enabled: true, risk: "L3", access: "write", schema_hash: "a".repeat(64) }, 0);
  setSkillTool("creator_discovery", "starrykol", "importKolProfilesFromCrawler", true, 0);
  for (let i = 0; i < 2; i++) {
    await postgresPool().query(`INSERT INTO runtime_actions(id,actor_id,session_id,context_json,connector_id,tool_name,args_json,snapshot,proposal_key,state)
      VALUES($1,$2,$3,$4,'claw','start_crawl','{}','test-version',$1,'succeeded')`, [`action-${i}`, users[i].id, ctx(users[i].id).sessionId, JSON.stringify(ctx(users[i].id))]);
    await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state,result_state,result_json)
      VALUES($1,$1,$2,$3,1,'{}',$1,'succeeded','ready',$4)`, [`action-${i}`, users[i].id, JSON.stringify(ctx(users[i].id)), JSON.stringify({ candidates: [candidate], complete: true, captured_at: new Date().toISOString() })]);
  }
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockReset();
  vi.mocked(lookupImportedKolUid).mockReset();
});
afterEach(() => { setKolJevFetch(); delete process.env.OPENROUTER_API_KEY; resetConn(); fs.rmSync(temp, { recursive: true, force: true }); });

it("atomically assigns one employee, hides other employees, and does not repeat a successful import", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "KOLCLAIM001" });
  const versions = await Promise.all([version(0), version(1)]);
  const results = await Promise.allSettled([command(0, "follow", versions[0]), command(1, "follow", versions[1])]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? 0 : 1, loser = 1 - winner;
  expect(await command(winner, "follow", versions[winner])).toMatchObject({ ok: true, reused: true });
  expect(await acting(loser, () => runtimeCandidateViews(ctx(users[loser].id), `action-${loser}`, [candidate]))).toEqual([]);
  expect((await acting(loser, () => discoveryResultContext(ctx(users[loser].id))))[0].candidates).toEqual([]);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
  const follows = (await postgresPool().query("SELECT * FROM kol_follow_index WHERE status='active'")).rows;
  expect(follows).toHaveLength(1); expect(follows[0].last_effective_mail_at).toBeNull(); expect(follows[0].collaboration_id).toBeNull();
  await postgresPool().query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,platform,platform_creator_id,ingest_source,pool_status,created_at,updated_at)
    VALUES('duplicate',$1,'formal-duplicate','youtube',$2,'starry','open','now','now')`, [COMPANY, candidate.id]);
  const pool = await readPublicPoolPage(parsePoolPageOptions({}), COMPANY);
  expect(JSON.stringify(pool)).not.toContain('formal-duplicate');
  await expect(postgresPool().query(`INSERT INTO kol_follow_index(id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,created_at,updated_at)
    VALUES('bypass',$1,'formal-duplicate','OTHER',$2,$2,'active','now','now','now')`, [COMPANY, users[loser].id])).rejects.toMatchObject({ code: "23505" });
});
it("persists task-local ignore/restore and rejects stale/unconfirmed actions", async () => {
  const v = await version();
  await command(0, "ignore", v);
  expect(await acting(0, () => runtimeCandidateViews(ctx(users[0].id), 'action-0', [candidate]))).toEqual([expect.objectContaining({ ignored: true })]);
  expect(await acting(1, () => runtimeCandidateViews(ctx(users[1].id), 'action-1', [candidate]))).toEqual([expect.objectContaining({ ignored: false })]);
  await expect(command(0, "follow", v)).rejects.toMatchObject({ detail: { code: "candidate_ignored" } });
  await command(0, "restore", v);
  await expect(command(0, "follow", "stale")).rejects.toMatchObject({ detail: { code: "candidate_changed" } });
  await expect(command(0, "follow", v, false)).rejects.toMatchObject({ detail: { code: "follow_click_required" } });
  await expect(command(0, "ingest", v, false)).rejects.toMatchObject({ detail: { code: "l3_confirm_required" } });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).not.toHaveBeenCalled();
});
it("imports once with a real returned UID, independently of personal follow", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-001" });
  const v = await version();
  expect(await command(0, "ingest", v)).toMatchObject({ ok: true, in_pool: true, kol_uid: "starry-real-001" });
  expect(await command(0, "ingest", v)).toMatchObject({ reused: true });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
  expect((await postgresPool().query("SELECT * FROM kol_follow_index")).rows).toHaveLength(0);
});
it("reconciles an uncertain import when Starry already has the KOL", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const v = await version();
  await expect(command(0, "ingest", v)).rejects.toThrow("test transport timeout");
  // Starry 侧已写入：第二次真去核对，直接成功，不再派发。
  vi.mocked(lookupImportedKolUid).mockResolvedValue("kol_uid_123");
  const result = await command(0, "ingest", v);
  expect(result).toMatchObject({ ok: true, kol_uid: "kol_uid_123", in_pool: true, reused: true });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
});

it("re-dispatches only after verifying Starry does not have the KOL", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const v = await version();
  await expect(command(0, "ingest", v)).rejects.toThrow("test transport timeout");
  // Starry 侧没有：核对后重新派发（非盲目），仍失败则回到 uncertain。
  vi.mocked(lookupImportedKolUid).mockResolvedValue("");
  await expect(command(0, "ingest", v)).rejects.toThrow("test transport timeout");
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(2);
});

it("stays uncertain when the reconcile lookup itself fails", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const v = await version();
  await expect(command(0, "ingest", v)).rejects.toThrow("test transport timeout");
  // 核对本身失败：不删行、不盲目重试，诚实报核对失败。
  vi.mocked(lookupImportedKolUid).mockRejectedValue(new Error("starry down"));
  await expect(command(0, "ingest", v)).rejects.toMatchObject({ detail: { code: "import_creator_uncertain" } });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
});

async function seedImportRow(state: string, updatedAgoMs = 0) {
  const updatedAt = new Date(Date.now() - updatedAgoMs).toISOString();
  await postgresPool().query(`INSERT INTO discovery_runtime_imports(company_id,platform,creator_id,action_id,actor_id,state,updated_at)
    VALUES($1,'youtube',$2,'action-0',$3,$4,$5)`, [COMPANY, candidate.id, users[0].id, state, updatedAt]);
}
async function importState() {
  return (await postgresPool().query(`SELECT state FROM discovery_runtime_imports WHERE company_id=$1 AND platform='youtube' AND creator_id=$2`, [COMPANY, candidate.id])).rows[0]?.state ?? null;
}

it("follow reconciles an uncertain import when Starry already has the KOL", async () => {
  await seedImportRow("uncertain");
  vi.mocked(lookupImportedKolUid).mockResolvedValue("kol_uid_123");
  const v = await version();
  const result = await command(0, "follow", v);
  expect(result).toMatchObject({ ok: true, followed: true });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).not.toHaveBeenCalled();
  expect(await importState()).toBe("succeeded");
  // 跟进成功后的 Starry 写入复用已核对的行，不再派发。
  expect(result).toMatchObject({ starry_imported: true, starry_kol_uid: "kol_uid_123" });
});

it("follow clears a zombie uncertain import when Starry does not have the KOL", async () => {
  await seedImportRow("uncertain");
  vi.mocked(lookupImportedKolUid).mockResolvedValue("");
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-002" });
  const v = await version();
  const result = await command(0, "follow", v);
  expect(result).toMatchObject({ ok: true, followed: true, starry_imported: true, starry_kol_uid: "starry-real-002" });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  // 僵尸行已删，跟进走本地建档；跟进后的 Starry 写入是全新派发。
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
  expect(await importState()).toBe("succeeded");
  const profile = (await postgresPool().query(`SELECT ingest_source FROM kol_profile_index WHERE company_id=$1 AND platform_creator_id=$2`, [COMPANY, candidate.id])).rows[0];
  expect(profile.ingest_source).toBe("discovery-ingest");
});

it("follow still waits while an import is genuinely dispatching", async () => {
  await seedImportRow("dispatching");
  const v = await version();
  await expect(command(0, "follow", v)).rejects.toMatchObject({ detail: { code: "candidate_import_pending" } });
  expect(vi.mocked(lookupImportedKolUid)).not.toHaveBeenCalled();
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).not.toHaveBeenCalled();
  expect(await importState()).toBe("dispatching");
});

it("follow reconciles an orphaned dispatching import", async () => {
  await seedImportRow("dispatching", 11 * 60_000);
  vi.mocked(lookupImportedKolUid).mockResolvedValue("kol_uid_123");
  const v = await version();
  const result = await command(0, "follow", v);
  expect(result).toMatchObject({ ok: true, followed: true });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(await importState()).toBe("succeeded");
});

it("follow reports pool (not follow) when the post-follow Starry write fails", async () => {
  const { HttpFail } = await import("../src/host/errors.js");
  await seedImportRow("uncertain");
  vi.mocked(lookupImportedKolUid).mockResolvedValue("");
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(
    new HttpFail(502, { code: "import_creator_failed", message: "写入红人档案失败，未加入跟进。请稍后重试。" }));
  const v = await version();
  const result = await command(0, "follow", v);
  // 跟进本身成功，失败的只是写公海：文案不得出现自相矛盾的"未加入跟进"。
  expect(result).toMatchObject({ ok: true, followed: true, starry_imported: false,
    starry_error: expect.stringContaining("未加入公海") });
  expect(String((result as { starry_error?: string }).starry_error || "")).not.toContain("未加入跟进");
});

it("re-follow reconciles uncertain Starry import without creating a second owner", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("first import failed"));
  const v = await version();
  const first = await command(0, "follow", v);
  expect(first).toMatchObject({ followed: true, starry_imported: false });
  vi.mocked(lookupImportedKolUid).mockResolvedValue("KOLRECONCILED001");
  const retried = await command(0, "follow", v);
  expect(retried).toMatchObject({ followed: true, reused: true, starry_imported: true, starry_kol_uid: "KOLRECONCILED001", follow_id: first.follow_id });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  const follows = (await postgresPool().query("SELECT * FROM kol_follow_index WHERE status='active'")).rows;
  expect(follows).toHaveLength(1);
  expect(follows[0].kol_uid).toBe("KOLRECONCILED001");
  expect(await importState()).toBe("succeeded");
});

it("re-follow keeps ownership and uncertain state when Starry reconciliation fails", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("first import failed"));
  const v = await version();
  const first = await command(0, "follow", v);
  vi.mocked(lookupImportedKolUid).mockRejectedValue(new Error("listAll unavailable"));
  const retried = await command(0, "follow", v);
  expect(retried).toMatchObject({ followed: true, reused: true, starry_imported: false, follow_id: first.follow_id });
  expect(await importState()).toBe("uncertain");
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
  const audits = (await postgresPool().query("SELECT payload FROM audit_events WHERE event_type='host.import_creator.reconcile_failed'")).rows;
  expect(audits).toHaveLength(1);
  const payload = typeof audits[0].payload === "string" ? JSON.parse(audits[0].payload) : audits[0].payload;
  expect(payload.error_detail).toBe("listAll unavailable");
});

it("re-follow reconciles with a pre-existing formal profile and links the original follow", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("first failed"));
  const v = await version();
  const first = await command(0, "follow", v);
  await postgresPool().query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,platform,platform_creator_id,ingest_source,pool_status,created_at,updated_at)
    VALUES('formal',$1,'KOLFORMAL001','youtube',$2,'starry','open','now','now')`, [COMPANY, candidate.id]);
  vi.mocked(lookupImportedKolUid).mockResolvedValue("KOLFORMAL001");
  expect(await command(0, "follow", v)).toMatchObject({ followed: true, starry_imported: true, follow_id: first.follow_id });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(await importState()).toBe("succeeded");
  const owners = (await postgresPool().query("SELECT kol_uid FROM kol_follow_index WHERE status='active'")).rows;
  expect(owners).toEqual([{ kol_uid: "KOLFORMAL001" }]);
});

it("never migrates a placeholder follow over another employee's target UID ownership", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("first failed"));
  const v = await version();
  await command(0, "follow", v);
  // 历史正式档案尚未记录平台 ID，但其真实 UID 已有另一员工的有效跟进。
  await postgresPool().query(`INSERT INTO kol_profile_index(id,company_id,kol_uid,platform,ingest_source,pool_status,created_at,updated_at)
    VALUES('formal',$1,'KOLTAKEN001','youtube','starry','claimed','now','now')`, [COMPANY]);
  await postgresPool().query(`INSERT INTO kol_follow_index(id,company_id,kol_uid,scope_brand,employee_id,employee_name,status,claimed_at,created_at,updated_at)
    VALUES('other-owner',$1,'KOLTAKEN001','LT',$2,$2,'active','now','now','now')`, [COMPANY, users[1].id]);
  vi.mocked(lookupImportedKolUid).mockResolvedValue("KOLTAKEN001");
  expect(await command(0, "follow", v)).toMatchObject({ followed: true, starry_imported: false });
  expect(await importState()).toBe("uncertain");
  expect((await postgresPool().query("SELECT employee_id FROM kol_follow_index WHERE id='other-owner'")).rows[0].employee_id).toBe(users[1].id);
  expect((await postgresPool().query("SELECT kol_uid FROM kol_follow_index WHERE employee_id=$1 AND status='active'", [users[0].id])).rows[0].kol_uid).toBe(`candidate:youtube:${candidate.id}`);
});

async function enqueueScore() {
  await acting(0, () => postgresTransaction(client => enqueueCandidateAssessments("action-0", ctx(users[0].id), [candidate], client)));
  return (await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='discovery.score' ORDER BY created_at DESC")).rows[0];
}
const assessment = { potential_score: 83, risk_score: 25, potential_confidence: 0.8, risk_confidence: 0.9,
  potential_probabilities: '{"high_potential":0.66,"watch":0.34}', risk_probabilities: '{"normal":0.9,"watch":0.1}',
  model: "jev-1.13", version: "jev-kol-v1", assessed_at: "2026-10-09T01:01:00Z", criteria_summary: "关键词 camping" };

it("deduplicates scoring, persists before import, and reuses the same score after import and reconnect", async () => {
  const job = await enqueueScore(); await enqueueScore();
  expect((await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='discovery.score'")).rows).toHaveLength(1);
  expect((await postgresPool().query("SELECT * FROM kol_candidate_assessments")).rows).toHaveLength(1);
  expect((await acting(0, () => runtimeCandidateViews(ctx(users[0].id), "action-0", [candidate])))[0].assessment).toMatchObject({ state: "scoring", execution_state: "queued", potential_score: null });
  const snapshot = await version();
  await Promise.all([command(0, "score", snapshot), command(0, "score", snapshot)]);
  expect((await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='discovery.score'")).rows).toHaveLength(1);
  const scorer = vi.fn().mockResolvedValue(assessment);
  await scoreDiscoveryCandidate({ ...job, attempts: 1 }, async () => {}, scorer);
  await scoreDiscoveryCandidate({ ...job, attempts: 1 }, async () => {}, scorer);
  expect(scorer).toHaveBeenCalledTimes(1);
  await command(0, "score", snapshot);
  expect((await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='discovery.score'")).rows).toHaveLength(1);
  expect(scorer.mock.calls[0][0].avg_plays).toBeNull();
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-scored" });
  await command(0, "ingest", await version());
  resetConn();
  const view = (await acting(0, () => runtimeCandidateViews(ctx(users[0].id), "action-0", [candidate])))[0];
  expect(view.assessment).toMatchObject({ state: "scored", execution_state: "scored", potential_score: 83, version: "jev-kol-v1" });
  const pool = await readPublicPoolPage(parsePoolPageOptions({}), COMPANY);
  expect(pool.items.find(row => row.kol_uid === "starry-scored")).toMatchObject({ potential_score: 83, risk_score: 25,
    assessment_state: "scored", assessed_at: assessment.assessed_at, assessment_criteria: assessment.criteria_summary });
  expect((await postgresPool().query("SELECT kol_uid FROM kol_candidate_assessments")).rows[0].kol_uid).toBe("starry-scored");
});

it("records scoring failure without a zero, supports explicit retry, and never overwrites a success on replay", async () => {
  const job = await enqueueScore();
  await expect(scoreDiscoveryCandidate({ ...job, attempts: 3, max_attempts: 3 }, async () => {}, vi.fn().mockRejectedValue(new Error("secret transport body")))).rejects.toThrow("Candidate assessment failed");
  const failed = (await acting(0, () => runtimeCandidateViews(ctx(users[0].id), "action-0", [candidate])))[0].assessment as Record<string, unknown>;
  expect(failed).toMatchObject({ state: "failed", potential_score: null }); expect(JSON.stringify(failed)).not.toContain("secret");
  await command(0, "score", await version());
  expect((await postgresPool().query("SELECT state FROM kol_candidate_assessments")).rows[0].state).toBe("queued");
  const retry = (await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='discovery.score' ORDER BY created_at DESC")).rows[0];
  await scoreDiscoveryCandidate({ ...retry, attempts: 1 }, async () => {}, vi.fn().mockResolvedValue(assessment));
  await enqueueScore();
  expect((await postgresPool().query("SELECT state FROM kol_candidate_assessments")).rows[0].state).toBe("scored");
});

it("rechecks ownership before scoring and refuses another employee's candidate", async () => {
  const job = await enqueueScore();
  await command(1, "follow", await version(1));
  const scorer = vi.fn().mockResolvedValue(assessment);
  await expect(scoreDiscoveryCandidate({ ...job, attempts: 3, max_attempts: 3 }, async () => {}, scorer)).rejects.toThrow("Candidate assessment failed");
  expect(scorer).not.toHaveBeenCalled();
});

it("dispatches the durable job through the existing JEV SDK with this task's conditions and preserves zero confidence", async () => {
  const db = postgresPool();
  for (const [session, keyword] of [[ctx(users[0].id).sessionId, "camping"], ["unrelated-session", "unrelated-keyword"]]) {
    await db.query("INSERT INTO sessions(id,title,created_at,updated_at) VALUES($1,'discovery','now','now')", [session]);
    await db.query(`INSERT INTO tickets(id,owner_user_id,task_type,title,skill,profile,session_id,input,created_at,updated_at)
      VALUES($1,$2,'discovery','Discovery','crawler_collect','lead',$1,$3,'now','now')`,
    [session, users[0].id, JSON.stringify({ discovery_workspace: { brief: { platforms: ["youtube"],
      region: "global_en", keywords: [keyword], min_followers: 10000, min_avg_plays_10: 5000 } } })]);
  }
  process.env.OPENROUTER_API_KEY = "test-only-key";
  const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { state: { public_profile: string; target_criteria: string } };
    const profile = JSON.parse(body.state.public_profile).public_profile;
    expect(profile).toMatchObject({ handle: candidate.id, average_plays: "未提供" });
    expect(body.state.target_criteria).toContain("camping");
    expect(body.state.target_criteria).not.toContain("unrelated-keyword");
    return new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {
      potential: { type: "choice", choice: "high_potential", confidence: 0, probabilities: { high_potential: 0.66, watch: 0.34 } },
      risk: { type: "choice", choice: "normal", confidence: 0.9 },
    } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  setKolJevFetch(fetcher);
  const job = await enqueueScore();
  const { processExecutionJobById } = await import("../src/execution-jobs/dispatcher.js");
  expect(await processExecutionJobById(job.id, "score-test-worker")).toMatchObject({ handled: true, outcome: "processed" });
  expect(await processExecutionJobById(job.id, "score-test-worker")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const view = (await acting(0, () => runtimeCandidateViews(ctx(users[0].id), "action-0", [candidate])))[0];
  expect(view.assessment).toMatchObject({ state: "scored", potential_score: 83, potential_confidence: 0,
    risk_score: 20, criteria_summary: expect.stringContaining("camping") });
  expect((await db.query("SELECT status FROM execution_jobs WHERE id=$1", [job.id])).rows[0].status).toBe("succeeded");
});

it("rejects an invalid JEV probability response and keeps the score empty", async () => {
  process.env.OPENROUTER_API_KEY = "test-only-key";
  setKolJevFetch(async () => new Response(JSON.stringify({ answers: {
    potential: { type: "choice", choice: "high_potential", confidence: 0.9, probabilities: { invented_choice: 1 } },
    risk: { type: "choice", choice: "normal", confidence: 0.9 },
  } }), { status: 200, headers: { "content-type": "application/json" } }));
  const job = await enqueueScore();
  await expect(scoreDiscoveryCandidate({ ...job, attempts: 3, max_attempts: 3 }, async () => {})).rejects.toThrow("Candidate assessment failed");
  const view = (await acting(0, () => runtimeCandidateViews(ctx(users[0].id), "action-0", [candidate])))[0];
  expect(view.assessment).toMatchObject({ state: "failed", potential_score: null, risk_score: null });
});

it("ingest retries the Starry write for your own followed candidate without duplicating ownership", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const first = await command(0, "follow", await version());
  expect(first).toMatchObject({ ok: true, followed: true, starry_imported: false });
  expect(await importState()).toBe("uncertain");
  vi.mocked(lookupImportedKolUid).mockResolvedValue("");
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-003" });
  expect(await command(0, "ingest", await version())).toMatchObject({ ok: true, kol_uid: "starry-real-003", in_pool: true });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(2);
  expect(await importState()).toBe("succeeded");
  const follows = (await postgresPool().query("SELECT id,kol_uid FROM kol_follow_index WHERE status='active'")).rows;
  expect(follows).toEqual([{ id: first.follow_id, kol_uid: "starry-real-003" }]);
  expect((await postgresPool().query("SELECT payload FROM audit_events WHERE event_type='discovery.runtime.ingest.follow_retry'")).rows).toHaveLength(1);
});

it("ingest refuses another employee's followed candidate", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-004" });
  const v = await version();
  await command(0, "follow", v);
  await expect(command(1, "ingest", v)).rejects.toMatchObject({ detail: { code: "candidate_scope_denied" } });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
});

it.each([
  ["pageKolProfiles request timed out", "达人库无响应"],
  ["HTTP 503 token=private https://private.example/mcp", "达人库连接失败"],
  ["查询条件无效", "查询条件无效"],
])("reports the employee-safe reconcile failure for %s without re-importing", async (message, reason) => {
  await seedImportRow("uncertain");
  vi.mocked(lookupImportedKolUid).mockRejectedValue(new Error(message));
  await expect(command(0, "ingest", await version())).rejects.toMatchObject({ detail: {
    code: "import_creator_uncertain", message: `入库状态核对失败（${reason}），请稍后重试；未重复提交。`,
  } });
  expect(await importState()).toBe("uncertain");
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).not.toHaveBeenCalled();
});
