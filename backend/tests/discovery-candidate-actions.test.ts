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
import { importKolProfilesFromCrawlerConfirmed, lookupImportedKolUid } from "../src/gateway/import-creator.js";

vi.mock("../src/gateway/import-creator.js", () => ({
  importKolProfilesFromCrawlerConfirmed: vi.fn(),
  lookupImportedKolUid: vi.fn(),
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
afterEach(() => { resetConn(); fs.rmSync(temp, { recursive: true, force: true }); });

it("atomically assigns one employee, hides the other employee's model/UI results, and creates no import or collaboration", async () => {
  const versions = await Promise.all([version(0), version(1)]);
  const results = await Promise.allSettled([command(0, "follow", versions[0]), command(1, "follow", versions[1])]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const winner = results[0].status === "fulfilled" ? 0 : 1, loser = 1 - winner;
  expect(await command(winner, "follow", versions[winner])).toMatchObject({ ok: true, reused: true });
  expect(await acting(loser, () => runtimeCandidateViews(ctx(users[loser].id), `action-${loser}`, [candidate]))).toEqual([]);
  expect((await acting(loser, () => discoveryResultContext(ctx(users[loser].id))))[0].candidates).toEqual([]);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).not.toHaveBeenCalled();
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

it("ingest retries the Starry write for your own followed candidate", async () => {
  // 跟进成功但 Starry 写入失败：行 uncertain，本地已跟进。
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const v = await version();
  const followed = await command(0, "follow", v);
  expect(followed).toMatchObject({ ok: true, followed: true, starry_imported: false });
  expect(await importState()).toBe("uncertain");
  // 同一个人点加入公海补入库：先核对（Starry 没有）→ 删僵尸行 → 重新派发成功。
  vi.mocked(lookupImportedKolUid).mockResolvedValue("");
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-003" });
  const retried = await command(0, "ingest", await version());
  expect(retried).toMatchObject({ ok: true, kol_uid: "starry-real-003", in_pool: true });
  expect(vi.mocked(lookupImportedKolUid)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(2);
  expect(await importState()).toBe("succeeded");
});

it("ingest refuses another employee's followed candidate", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockResolvedValue({ kol_uid: "starry-real-004" });
  const v = await version();
  await command(0, "follow", v);
  // user1 看不到该候选（被 user0 跟进），走到 403 而不是 409。
  await expect(command(1, "ingest", v)).rejects.toMatchObject({ detail: { code: "candidate_scope_denied" } });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
});
