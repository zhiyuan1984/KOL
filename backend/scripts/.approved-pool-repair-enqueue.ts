import { pathToFileURL } from 'node:url';
export async function recoverApprovedPoolRun(anchor:string){
 const { postgresTransaction }=await import('../src/postgres/pool.js');
 const { pgEnqueueManualCronRun }=await import('../src/cron/postgres-store.js');
 const { assertJobRunnable,assertHandlerGates }=await import('../src/cron/authz.js');
 const operation='pool-native-schema-repair-eoouUIToH5RDLTOFEXhUsN-20261015';
 if(!anchor)throw new Error('release_anchor_required');
 const started=Date.now();
 for(;;){
  const result=await postgresTransaction(async client=>{
   const job=(await client.query("SELECT * FROM cron_jobs WHERE job_key=$1 AND handler_key=$1 FOR UPDATE",['kol-pool-sync'])).rows[0];
   if(!job||job.status!=='published'||job.owner_account_id!==null)throw new Error('published_system_pool_job_required');
   assertJobRunnable(job);assertHandlerGates(String(job.handler_key));
   const before=JSON.stringify(job);
   const previous=(await client.query("SELECT payload FROM audit_events WHERE event_type=$1 AND payload::jsonb->>'operation_id'=$2 ORDER BY id DESC LIMIT 1",['cron.run.requested',operation])).rows[0];
   if(previous){const p=JSON.parse(String(previous.payload));return{run_id:p.run_id,duplicate:true,already_audited:true,manual_enqueued:p.manual_enqueued===true};}
   const failed=(await client.query("SELECT id,status,error_code FROM cron_runs WHERE job_id=$1 AND status='failed' AND strpos(COALESCE(error_summary,''),'kol_pool_sync_runs')>0 ORDER BY created_at DESC LIMIT 1 FOR SHARE",[job.id])).rows[0];
   if(!failed)throw new Error('known_missing_pool_schema_failure_required');
   const natural=(await client.query("SELECT id,status FROM cron_runs WHERE job_id=$1 AND trigger='schedule' AND created_at::timestamptz>=$2::timestamptz ORDER BY created_at DESC LIMIT 1",[job.id,anchor])).rows[0];
   const due=(await client.query("SELECT next_run_at IS NOT NULL AND next_run_at::timestamptz<=now() AS due FROM cron_jobs WHERE id=$1",[job.id])).rows[0].due;
   if(!natural&&due)return{waiting_for_natural_tick:true};
   const queued=natural?{run_id:String(natural.id),duplicate:true}:await pgEnqueueManualCronRun(String(job.id),operation);
   const after=(await client.query('SELECT * FROM cron_jobs WHERE id=$1',[job.id])).rows[0];
   if(JSON.stringify(after)!==before)throw new Error('pool_job_schedule_or_scope_changed');
   const manualEnqueued=!natural;
   const now=new Date().toISOString();
   await client.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[now,'manus:user-approved-production-operator','cron.run.requested',JSON.stringify({operation_id:operation,authorization:'explicit_user_starry_enable_and_continue_recovery_2026-10-15T12:45:14Z',job_id:job.id,handler_key:'kol-pool-sync',run_id:queued.run_id,previous_failed_run_id:failed.id,trigger:natural?'schedule_recovery_reused':'manual_repair_enqueue',manual_enqueued:manualEnqueued,reason:'formal_native_schema_repaired',schedule_unchanged:true,scope_unchanged:true,handler_called_directly:false,mail_or_ownership_triggered:false})]);
   return{...queued,manual_enqueued:manualEnqueued,natural_recovery_reused:!!natural,previous_failed_run_id:failed.id,handler_key:'kol-pool-sync',schedule_unchanged:true,scope_unchanged:true,handler_called_directly:false,mail_or_ownership_triggered:false};
  },{isolation:'SERIALIZABLE'});
  if(!('waiting_for_natural_tick' in result))return result;
  if(Date.now()-started>30_000)throw new Error('native_ticker_did_not_enqueue_due_pool');
  console.error('[pool-recovery]',JSON.stringify({waiting_for_natural_tick:true,elapsed_seconds:Math.floor((Date.now()-started)/1000)}));
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
}
async function main(){
 process.loadEnvFile('/home/ecs-user/kol/.env');
 const { closePostgresPool }=await import('../src/postgres/pool.js');
 try{console.log(JSON.stringify(await recoverApprovedPoolRun(String(process.env.CRON_RUN_CREATED_AFTER||''))));}
 catch(error){console.error(JSON.stringify({error_code:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'pool_repair_enqueue_failed'}));process.exitCode=2;}
 finally{await closePostgresPool();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void main();
