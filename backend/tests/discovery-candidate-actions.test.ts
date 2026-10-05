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
import { importKolProfilesFromCrawlerConfirmed } from "../src/gateway/import-creator.js";

vi.mock("../src/gateway/import-creator.js", () => ({ importKolProfilesFromCrawlerConfirmed: vi.fn() }));
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
it("never dispatches again after an uncertain import result", async () => {
  vi.mocked(importKolProfilesFromCrawlerConfirmed).mockRejectedValue(new Error("test transport timeout"));
  const v = await version();
  await expect(command(0, "ingest", v)).rejects.toThrow("test transport timeout");
  await expect(command(0, "ingest", v)).rejects.toMatchObject({ detail: { code: "import_creator_uncertain" } });
  expect(vi.mocked(importKolProfilesFromCrawlerConfirmed)).toHaveBeenCalledTimes(1);
});
