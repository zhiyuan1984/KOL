import { beforeEach,afterEach,describe,expect,it } from 'vitest';
import { freshTestDatabase } from './support/pg.js';
import { postgresPool } from '../src/postgres/pool.js';
import { pgEnsureSystemCronJobs,pgTickCronDue } from '../src/cron/postgres-store.js';
import { recoverApprovedPoolRun } from '../scripts/.approved-pool-repair-enqueue.js';
const anchor=()=>new Date().toISOString();
let poolJobId:string;
beforeEach(async()=>{
 await freshTestDatabase();
 await pgEnsureSystemCronJobs();
 const db=postgresPool();
 await db.query("UPDATE cron_jobs SET status='disabled' WHERE job_key<>'kol-pool-sync'");
 await db.query("UPDATE cron_jobs SET next_run_at=$1,status='published' WHERE job_key='kol-pool-sync'",[new Date(Date.now()+3600000).toISOString()]);
 poolJobId=String((await db.query("SELECT id FROM cron_jobs WHERE job_key='kol-pool-sync'")).rows[0].id);
 await db.query(`INSERT INTO cron_runs(id,job_id,trigger,status,scheduled_for,error_code,error_summary,created_at)
  VALUES($1,$2,'schedule','failed',$3,'handler_error',$4,$5)`,['synthetic-historical-schema-failure',poolJobId,'synthetic-old-slot','relation kol_pool_sync_runs does not exist',new Date(Date.now()-60000).toISOString()]);
});
afterEach(async()=>{await postgresPool().query('DROP TRIGGER IF EXISTS synthetic_recovery_audit_fail ON audit_events; DROP FUNCTION IF EXISTS synthetic_recovery_audit_fail()');});
async function counts(){const db=postgresPool();return{
 runs:Number((await db.query("SELECT count(*) AS n FROM cron_runs WHERE id<>'synthetic-historical-schema-failure'")).rows[0].n),
 jobs:Number((await db.query('SELECT count(*) AS n FROM execution_jobs')).rows[0].n),
 outbox:Number((await db.query('SELECT count(*) AS n FROM execution_outbox')).rows[0].n),
 audits:Number((await db.query("SELECT count(*) AS n FROM audit_events WHERE event_type='cron.run.requested'")).rows[0].n)
};}
describe('approved native pool recovery operational boundary',()=>{
 it('enqueues exactly once and atomically audits without changing scope, clock or historical failure',async()=>{
  const db=postgresPool(),before=(await db.query("SELECT * FROM cron_jobs WHERE job_key='kol-pool-sync'")).rows[0];
  const result=await recoverApprovedPoolRun(anchor());
  expect(result).toMatchObject({manual_enqueued:true,natural_recovery_reused:false,schedule_unchanged:true,scope_unchanged:true,handler_called_directly:false,mail_or_ownership_triggered:false});
  expect(await counts()).toEqual({runs:1,jobs:1,outbox:1,audits:1});
  expect((await db.query("SELECT * FROM cron_jobs WHERE job_key='kol-pool-sync'")).rows[0]).toEqual(before);
  expect((await db.query("SELECT status FROM cron_runs WHERE id='synthetic-historical-schema-failure'")).rows[0].status).toBe('failed');
  expect(await recoverApprovedPoolRun(anchor())).toMatchObject({run_id:result.run_id,already_audited:true});
  expect(await counts()).toEqual({runs:1,jobs:1,outbox:1,audits:1});
 });
 it('reuses the actual resident schedule dispatch instead of creating a second manual run',async()=>{
  const at=anchor(),db=postgresPool();
  await db.query("UPDATE cron_jobs SET next_run_at=$1 WHERE job_key='kol-pool-sync'",[new Date(Date.now()-1000).toISOString()]);
  const due=await pgTickCronDue(new Date(),{missed_run_policy:'coalesce',ensure_system_jobs:false});
  expect(due.claimed).toHaveLength(1);
  const result=await recoverApprovedPoolRun(at);
  expect(result).toMatchObject({run_id:due.claimed[0],manual_enqueued:false,natural_recovery_reused:true});
  expect(await counts()).toEqual({runs:1,jobs:1,outbox:1,audits:1});
  expect((await db.query('SELECT trigger FROM cron_runs WHERE id=$1',[result.run_id])).rows[0].trigger).toBe('schedule');
 });
 it('rolls back the Cron run, Execution job and Outbox if audit persistence fails',async()=>{
  await postgresPool().query(`CREATE FUNCTION synthetic_recovery_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.event_type='cron.run.requested' THEN RAISE EXCEPTION 'synthetic recovery audit failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER synthetic_recovery_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION synthetic_recovery_audit_fail()`);
  await expect(recoverApprovedPoolRun(anchor())).rejects.toThrow('synthetic recovery audit failure');
  expect(await counts()).toEqual({runs:0,jobs:0,outbox:0,audits:0});
 });
 it('does not turn a disabled system job on or enqueue it',async()=>{
  await postgresPool().query("UPDATE cron_jobs SET status='disabled' WHERE job_key='kol-pool-sync'");
  await expect(recoverApprovedPoolRun(anchor())).rejects.toThrow('published_system_pool_job_required');
  expect(await counts()).toEqual({runs:0,jobs:0,outbox:0,audits:0});
 });
 it('keeps a real new schedule failure as a failure instead of blindly retrying it',async()=>{
  const at=anchor();
  await postgresPool().query(`INSERT INTO cron_runs(id,job_id,trigger,status,scheduled_for,error_code,error_summary,created_at)
   VALUES('synthetic-new-source-failure',$1,'schedule','failed','synthetic-new-slot','provider_forbidden','synthetic provider forbidden',$2)`,[poolJobId,new Date(Date.now()+1).toISOString()]);
  const result=await recoverApprovedPoolRun(at);
  expect(result).toMatchObject({run_id:'synthetic-new-source-failure',manual_enqueued:false,natural_recovery_reused:true});
  expect(await counts()).toEqual({runs:1,jobs:0,outbox:0,audits:1});
  expect((await postgresPool().query("SELECT status FROM cron_runs WHERE id='synthetic-new-source-failure'")).rows[0].status).toBe('failed');
 });
});
