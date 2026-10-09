import { postgresPool, postgresTransaction } from './pool.js';
import { normalizeEmail } from '../host/identity.js';
import { isPlaceholderMailbox, firstString } from '../starrykol/mail-fields.js';
import type { Json } from '../types.js';

/** Snapshot evidence only; never claims, changes stages, sends mail or decrypts. */
export async function persistStarryOwnership(profiles: Json[], companyId: string, sourceVersion: string, completeSnapshot=false): Promise<void> {
  if (completeSnapshot) {
    const ids=new Set<string>();
    for(const row of profiles) {
      const uid=firstString(row.kolUid,row.kol_uid);
      if(!uid || ids.has(uid)) throw new Error('starry_ownership_snapshot_identity_invalid');
      ids.add(uid);
      if(!['ownerOpenId','owner_open_id','ownerUserId','owner_user_id','ownerMailbox','owner_mailbox'].some(key=>Object.hasOwn(row,key)))
        throw new Error('starry_ownership_snapshot_owner_capability_missing');
    }
  }
  if (!completeSnapshot && !profiles.some(row=>firstString(row.ownerOpenId,row.owner_open_id,row.ownerUserId,row.owner_user_id,row.ownerMailbox,row.owner_mailbox,row.mailboxEmail))) return;
  await postgresTransaction(async (client) => {
    if (completeSnapshot) {
      // Replace only this derived evidence cache after complete pagination.
      await client.query("DELETE FROM starry_profile_ownership WHERE company_id=$1",[companyId]);
    }
    for (const row of profiles) {
      const uid = firstString(row.kolUid, row.kol_uid);
      const owner = firstString(row.ownerOpenId, row.owner_open_id, row.ownerUserId, row.owner_user_id);
      const mailbox = normalizeEmail(firstString(row.ownerMailbox, row.owner_mailbox, row.mailboxEmail));
      if (!uid || (!completeSnapshot && !owner && (!mailbox || isPlaceholderMailbox(mailbox)))) continue;
      await client.query(`INSERT INTO starry_profile_ownership(company_id,kol_uid,owner_open_id,owner_mailbox,brand,source_version,synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(company_id,kol_uid) DO UPDATE SET
          owner_open_id=EXCLUDED.owner_open_id,owner_mailbox=EXCLUDED.owner_mailbox,
          brand=EXCLUDED.brand,source_version=EXCLUDED.source_version,synced_at=EXCLUDED.synced_at`,
        [companyId,uid,owner,isPlaceholderMailbox(mailbox)?'':mailbox,firstString(row.brandCode,row.brandName),sourceVersion]);
    }
    if(completeSnapshot) await client.query(`INSERT INTO starry_ownership_sync_state(company_id,state,source_version,profile_count,error,updated_at)
      VALUES($1,'ready',$2,$3,NULL,$2) ON CONFLICT(company_id) DO UPDATE SET state='ready',source_version=$2,profile_count=$3,error=NULL,updated_at=$2`,[companyId,sourceVersion,profiles.length]);
  });
}

/** Refresh only an existing user binding from an exact authorized mailbox row. */
export async function verifyExistingStarryBindings(userId: string, mailboxes: Json[]): Promise<number> {
  if (!userId) return 0;
  let updated=0;
  for (const row of mailboxes) {
    const mailbox=normalizeEmail(firstString(row.mailboxEmail,row.mailbox_email));
    const owner=firstString(row.ownerOpenId,row.owner_open_id,row.ownerUserId,row.owner_user_id);
    if (!mailbox || isPlaceholderMailbox(mailbox) || !owner) continue;
    const result=await postgresPool().query(`UPDATE user_starry_bindings SET owner_open_id=$1,owner_verified_at=$2
      WHERE user_id=$3 AND lower(trim(mailbox_email))=$4 AND status='connected'
      AND (COALESCE(mailbox_id,'')='' OR mailbox_id=$5)`,
      [owner,new Date().toISOString(),userId,mailbox,firstString(row.id,row.mailboxId)]);
    updated+=result.rowCount||0;
  }
  return updated;
}

/** Explicit alias correction, not a handoff; does not alter remote ownership. */
export async function repairSriphyFollowIdentity(actor: string): Promise<{ repaired: number; follow_ids: string[] }> {
  return postgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kol:sriphy-identity-repair'))");
    const canonical=(await client.query("SELECT id FROM users WHERE id='sriphy' AND username='sriphy' AND active=1 FOR UPDATE")).rows[0];
    if (!canonical) throw new Error('canonical_sriphy_identity_unverified');
    if ((await client.query("SELECT id FROM users WHERE id='usr_sriphy'")).rows.length) throw new Error('legacy_identity_still_exists');
    const rows=(await client.query("SELECT id,company_id,kol_uid,scope_brand,status FROM kol_follow_index WHERE employee_id='usr_sriphy' FOR UPDATE")).rows;
    if (!rows.length) return {repaired:0,follow_ids:[]};
    const ids=rows.map(r=>String(r.id));
    await client.query("UPDATE kol_follow_index SET employee_id='sriphy',updated_at=$1,data_version=data_version+1 WHERE id=ANY($2::text[])",[new Date().toISOString(),ids]);
    await client.query(`INSERT INTO kol_identity_repairs(repair_key,legacy_user_id,canonical_user_id,follow_ids,actor,repaired_at)
      VALUES($1,'usr_sriphy','sriphy',$2,$3,$4)`,['sriphy-follow:'+ids.sort().join(','),JSON.stringify(ids),actor,new Date().toISOString()]);
    return {repaired:ids.length,follow_ids:ids};
  });
}
