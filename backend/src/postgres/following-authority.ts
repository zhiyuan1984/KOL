import { postgresPool } from './pool.js';
import { followClock, memoryCompanyId } from '../host/kol-memory.js';
import { normalizeStage, label } from '../stages.js';
import type { Json, Row } from '../types.js';

/** The only employee follow-list composition boundary. Names never authorize rows. */
export async function readFollowingAuthority(employeeId: string, companyId=memoryCompanyId()): Promise<Json[]> {
  const indexed:Json[]=await readLocalFollowing(employeeId,companyId);
  const rows=(await postgresPool().query<Row>(`
    SELECT DISTINCT ON (c.kol_uid) c.id,c.kol_uid,c.handle,c.display_name,c.platform,c.brand,
      c.followers,c.avg_views_10,c.engagement_rate,c.audience_geo,c.stage_code,c.days_in_stage,c.owner_name,
      p.homepage_url,p.avatar_url,p.direction,p.style,p.ingest_source,p.ingested_at,
      p.potential_score,p.risk_score,p.assessed_at,p.platform_creator_id
    FROM collaborations c
    LEFT JOIN kol_profile_index p ON p.company_id=$1 AND p.kol_uid=c.kol_uid
    LEFT JOIN starry_profile_ownership o ON o.company_id=$1 AND o.kol_uid=c.kol_uid
    WHERE EXISTS (SELECT 1 FROM starry_ownership_sync_state health WHERE health.company_id=$1 AND health.state='ready') AND c.source='starry' AND NULLIF(c.kol_uid,'') IS NOT NULL
      AND EXISTS (SELECT 1 FROM user_starry_bindings b WHERE b.user_id=$2 AND b.status='connected' AND
        ((NULLIF(o.owner_open_id,'')=NULLIF(b.owner_open_id,'') AND b.owner_verified_at IS NOT NULL)
          OR (COALESCE(o.owner_open_id,'')='' AND lower(trim(b.mailbox_email)) NOT LIKE '%.example' AND lower(trim(b.mailbox_email)) NOT LIKE '%.invalid'
            AND lower(trim(b.mailbox_email))=lower(trim(o.owner_mailbox)))))
      AND NOT EXISTS (SELECT 1 FROM kol_follow_index f LEFT JOIN kol_profile_index owned
        ON owned.company_id=f.company_id AND owned.kol_uid=f.kol_uid
        WHERE f.company_id=$1 AND f.status='active' AND (f.employee_id<>$2 OR f.kol_uid<>c.kol_uid)
          AND (f.kol_uid=c.kol_uid OR (lower(owned.platform)=lower(p.platform)
            AND NULLIF(owned.platform_creator_id,'')=NULLIF(p.platform_creator_id,''))))
      AND NOT EXISTS (SELECT 1 FROM kol_follow_index f WHERE f.company_id=$1 AND f.employee_id=$2
        AND f.kol_uid=c.kol_uid AND f.status='released')
    ORDER BY c.kol_uid,c.id`,[companyId,employeeId])).rows;
  const seen=new Set(indexed.map(r=>String(r.kol_uid)));
  const ids=rows.filter(r=>!seen.has(String(r.kol_uid))).map(r=>String(r.id));
  const threads=ids.length?(await postgresPool().query<Row>(`SELECT t.collaboration_id,t.conversation_id,t.subject,t.unread_count,t.last_snippet,t.last_at,t.last_direction
    FROM kol_mail_threads t WHERE t.collaboration_id=ANY($1::text[]) AND EXISTS
      (SELECT 1 FROM user_starry_bindings b WHERE b.user_id=$2 AND b.status='connected'
        AND lower(trim(t.mailbox))=lower(trim(b.mailbox_email))) ORDER BY t.last_at DESC NULLS LAST`,[ids,employeeId])).rows:[];
  const legacy=rows.filter(r=>!seen.has(String(r.kol_uid))).map(r=>{
    const stage=normalizeStage(String(r.stage_code||'INITIAL_CONTACT'));
    const ownThreads=threads.filter(t=>t.collaboration_id===r.id).slice(0,20);
    return {...r,id:r.kol_uid,collaboration_id:r.id,source_kind:'starry_binding',status:'active',creator_status:'active',
      unbound:false,employee_id:employeeId,stage_code:stage,stage_label:label(stage),stage:{code:stage,label:label(stage)},
      avg_plays:r.avg_views_10,engagement:r.engagement_rate,region:r.audience_geo,mail_threads:ownThreads,
      unread_count:ownThreads.reduce((n,t)=>n+Number(t.unread_count||0),0),
      latest_correspondence:{valid:ownThreads.length>0,summary:ownThreads[0]?.last_snippet||'尚未同步有效往来',at:ownThreads[0]?.last_at||null,thread_id:ownThreads[0]?.conversation_id||''},
      clock_14d:{countdown:false,cron_eligible:false,release_scheduler:false,last_effective_mail_at:null,days_since_interaction:null,days_remaining:null,near:false,label:'尚未核验有效往来'}};
  });
  return [...indexed,...legacy];
}

async function readLocalFollowing(employeeId:string,companyId:string):Promise<Json[]> {
  const follows=(await postgresPool().query<Row>(`SELECT f.*,p.id AS profile_id,p.handle,p.display_name,p.platform,p.homepage_url,p.avatar_url,
    p.followers,p.avg_plays,p.engagement,p.engagement_source,p.direction,p.region,p.style,p.ingest_source,p.ingested_at,
    p.public_stage,p.idle,p.pool_status,p.potential_score,p.potential_probabilities,p.potential_confidence,p.risk_score,p.risk_probabilities,p.risk_confidence,p.assessment_model,p.assessment_version,p.assessed_at,
    p.assessment_criteria,p.assessment_error,c.stage_code,c.days_in_stage
    FROM kol_follow_index f LEFT JOIN kol_profile_index p ON p.company_id=f.company_id AND p.kol_uid=f.kol_uid
    LEFT JOIN collaborations c ON c.id=f.collaboration_id
    WHERE f.company_id=$1 AND f.employee_id=$2 AND f.status='active' ORDER BY f.claimed_at DESC`,[companyId,employeeId])).rows;
  if(!follows.length)return [];
  const summaries=(await postgresPool().query<Row>(`SELECT follow_id,conversation_id,subject,last_at,effective,key_agreements,0 AS unread_count
    FROM kol_thread_summary WHERE company_id=$1 AND follow_id=ANY($2::text[]) ORDER BY last_at DESC NULLS LAST`,[companyId,follows.map(f=>f.id)])).rows;
  const ids=follows.map(f=>f.collaboration_id).filter(Boolean);
  const threads=ids.length?(await postgresPool().query<Row>(`SELECT t.collaboration_id,t.conversation_id,t.subject,t.last_snippet,t.last_at,t.unread_count,t.last_direction
    FROM kol_mail_threads t WHERE t.collaboration_id=ANY($1::text[]) AND EXISTS
      (SELECT 1 FROM user_starry_bindings b WHERE b.user_id=$2 AND b.status='connected' AND lower(trim(b.mailbox_email))=lower(trim(t.mailbox)))
    ORDER BY t.last_at DESC NULLS LAST`,[ids,employeeId])).rows:[];
  return follows.map(f=>{
    const clock=followClock(f.last_effective_mail_at?String(f.last_effective_mail_at):null);
    const seen=new Set<string>();
    const mails:Row[]=[...summaries.filter(t=>t.follow_id===f.id).map((t):Row=>({...t,last_snippet:t.key_agreements})),...threads.filter(t=>t.collaboration_id===f.collaboration_id)]
      .sort((a,b)=>String(b.last_at||'').localeCompare(String(a.last_at||''))).filter(t=>{const id=String(t.conversation_id||'');if(seen.has(id))return false;seen.add(id);return true;}).slice(0,20);
    const stage=normalizeStage(String(f.stage_code||'INITIAL_CONTACT'));
    const near=clock.days_since_interaction!=null&&clock.days_since_interaction>=11;
    const summary=String(mails[0]?.last_snippet||(clock.countdown?'已有有效往来':'尚未有效往来'));
    const refused=/refus|拒绝|拒信/i.test(summary);
    return {...f,id:f.profile_id||f.kol_uid,follow_id:f.id,source_kind:'local_follow',status:'active',
      stage:{code:stage,label:label(stage)},dwell:{days:f.days_in_stage??null},
      latest_correspondence:{valid:mails.length>0||clock.countdown,summary,at:mails[0]?.last_at||clock.last_effective_mail_at,thread_id:mails[0]?.conversation_id||'',refused},
      ...clock,last_interaction_at:clock.last_effective_mail_at,
      clock_14d:{...clock,days_remaining:clock.days_since_interaction==null?null:Math.max(0,14-clock.days_since_interaction),release_scheduler:false,near,label:clock.countdown?'14日跟进':'尚未有效往来'},
      risk:{chips:[...(near?[{id:'near-14d',label:'临近14日'}]:[]),...(refused?[{id:'refused',label:'拒信'}]:[])],refused,exception:false,high_risk:refused},
      mail_threads:mails.map(m=>({...m,unread_count:threads.filter(t=>t.collaboration_id===f.collaboration_id&&t.conversation_id===m.conversation_id).reduce((n,t)=>n+Number(t.unread_count||0),0)})),unread_count:threads.filter(t=>t.collaboration_id===f.collaboration_id).reduce((n,t)=>n+Number(t.unread_count||0),0)};
  });
}
