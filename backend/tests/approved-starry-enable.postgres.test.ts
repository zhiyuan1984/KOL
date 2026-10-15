import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { postgresPool, closePostgresPool } from "../src/postgres/pool.js";
import { createCredential } from "../src/runtime/credentials.js";
import { applyApprovedStarryEnable, readonlyStarryEnablePreflight } from "../scripts/approved-starry-enable.js";

const ID="starrykol";
const OP="starry-enable-eoouUIToH5RDLTOFEXhUsN-20261015";
let expected:{version:number;hash:string};
async function state(){return (await postgresPool().query("SELECT enabled,status FROM connectors WHERE id=$1",[ID])).rows[0];}
async function hashes(){return (await postgresPool().query("SELECT id,md5(to_jsonb(t)::text) AS hash FROM runtime_credentials t ORDER BY id")).rows;}
async function auditCount(){return Number((await postgresPool().query("SELECT count(*) AS n FROM audit_events WHERE payload::jsonb->>'operation_id'=$1",[OP])).rows[0].n);}

beforeEach(async()=>{
 process.env.RUNTIME_CREDENTIAL_MASTER_KEY="f0".repeat(32);
 const db=postgresPool();
 await db.query("DROP TRIGGER IF EXISTS ops_enable_fail ON audit_events");
 await db.query("DROP FUNCTION IF EXISTS ops_enable_fail()");
 await db.query("DELETE FROM audit_events WHERE payload::jsonb->>'operation_id'=$1",[OP]);
 await db.query("DELETE FROM runtime_connector_probes WHERE connector_id=$1",[ID]);
 await db.query("DELETE FROM runtime_skill_tools WHERE connector_id=$1",[ID]);
 await db.query("DELETE FROM runtime_skill_connectors WHERE connector_id=$1",[ID]);
 await db.query("DELETE FROM runtime_connector_config WHERE connector_id=$1",[ID]);
 await db.query("DELETE FROM runtime_credentials WHERE id=ANY($1::text[])",[["cred_ops_fixture_key","cred_ops_fixture_bearer"]]);
 await db.query("INSERT INTO connectors(id,label,purpose,enabled,status,updated_at) VALUES($1,$2,$3,0,'verified',$4) ON CONFLICT(id) DO UPDATE SET enabled=0,status='verified'",[ID,"synthetic-org-connector","owned PG fixture",new Date().toISOString()]);
 await createCredential({id:"cred_ops_fixture_key",type:"organization_secret",secret:"synthetic-key-not-production"},"test_operator");
 await createCredential({id:"cred_ops_fixture_bearer",type:"organization_secret",secret:"synthetic-bearer-not-production"},"test_operator");
 const cfg=JSON.stringify({protocol:"mcp",url:"https://synthetic.invalid/mcp",headers_secret_refs:{"X-API-Key":"cred_ops_fixture_key",Authorization:"cred_ops_fixture_bearer"}});
 const now=new Date().toISOString();
 await db.query("INSERT INTO runtime_connector_config(connector_id,config_json,version,updated_at) VALUES($1,$2,1,$3)",[ID,cfg,now]);
 await db.query("INSERT INTO runtime_connector_probes(connector_id,config_version,actor_id,checked_at,status,probe_kind,tool_count,duration_ms,error_code) VALUES($1,1,$2,$3,'succeeded','mcp_tools_list',1,1,NULL)",[ID,"test_operator",now]);
 await db.query("INSERT INTO runtime_skill_connectors(skill_id,connector_id,enabled,version,updated_at) VALUES($1,$2,1,1,$3)",["creator_library_sync",ID,now]);
 await db.query("INSERT INTO runtime_skill_tools(skill_id,connector_id,tool_name,enabled,version,updated_at) VALUES($1,$2,$3,1,1,$4)",["creator_library_sync",ID,"synthetic_read",now]);
 const basis=await readonlyStarryEnablePreflight();expected={version:basis.config_version,hash:basis.config_hash};
});
afterAll(async()=>{await closePostgresPool();});

describe("approved Starry native control-plane enable",()=>{
 it("readonly has no writes, enables only existing flag, preserves credentials and permissions, and is idempotent",async()=>{
  const before=await hashes();expect(Number((await state()).enabled)).toBe(0);expect(await auditCount()).toBe(0);
  await readonlyStarryEnablePreflight();expect(Number((await state()).enabled)).toBe(0);expect(await auditCount()).toBe(0);
  const result=await applyApprovedStarryEnable(expected);expect(result.changed).toBe(true);expect(result).toMatchObject({credentials_unchanged:true,permissions_unchanged:true});
  expect(Number((await state()).enabled)).toBe(1);expect((await state()).status).toBe("verified");expect(await hashes()).toEqual(before);expect(await auditCount()).toBe(1);
  const repeated=await applyApprovedStarryEnable(expected);expect(repeated).toMatchObject({changed:false,already_applied:true});expect(await auditCount()).toBe(1);
 });
 it("rejects changed configuration version/hash without enabling or auditing",async()=>{
  await expect(applyApprovedStarryEnable({...expected,version:expected.version+1})).rejects.toThrow("starry_config_changed_since_approval_basis");
  await expect(applyApprovedStarryEnable({...expected,hash:"a".repeat(32)})).rejects.toThrow("starry_config_changed_since_approval_basis");
  expect(Number((await state()).enabled)).toBe(0);expect(await auditCount()).toBe(0);
 });
 it("retains actual verified/current-probe/mount gates rather than using an operator bypass",async()=>{
  const db=postgresPool();await db.query("UPDATE connectors SET status='draft' WHERE id=$1",[ID]);await expect(applyApprovedStarryEnable(expected)).rejects.toThrow();
  await db.query("UPDATE connectors SET status='verified' WHERE id=$1",[ID]);await db.query("UPDATE runtime_connector_probes SET config_version=2 WHERE connector_id=$1",[ID]);await expect(applyApprovedStarryEnable(expected)).rejects.toThrow();
  await db.query("UPDATE runtime_connector_probes SET config_version=1,status='failed' WHERE connector_id=$1",[ID]);await expect(applyApprovedStarryEnable(expected)).rejects.toThrow();
  await db.query("UPDATE runtime_connector_probes SET status='succeeded' WHERE connector_id=$1",[ID]);await db.query("UPDATE runtime_skill_tools SET enabled=0 WHERE connector_id=$1",[ID]);await expect(applyApprovedStarryEnable(expected)).rejects.toThrow();
  expect(Number((await state()).enabled)).toBe(0);expect(await auditCount()).toBe(0);
 });
 it("rolls back flag and audit together if audit fails; no credentials change",async()=>{
  const db=postgresPool();const before=await hashes();
  await db.query("CREATE FUNCTION ops_enable_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='admin.connector.update' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
  await db.query("CREATE TRIGGER ops_enable_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ops_enable_fail()");
  await expect(applyApprovedStarryEnable(expected)).rejects.toThrow("synthetic audit failure");
  expect(Number((await state()).enabled)).toBe(0);expect(await auditCount()).toBe(0);expect(await hashes()).toEqual(before);
 });
});
