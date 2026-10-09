import { pageKolProfiles } from '../host/starry-connectors.js';
import { firstString } from './mail-fields.js';
import { memoryCompanyId } from '../host/kol-memory.js';
import { persistStarryOwnership } from '../postgres/kol-source-authority.js';
import { postgresPool } from '../postgres/pool.js';
import type { Json } from '../types.js';

/** Complete, capability-validated snapshot; no detail/decryption/write calls. */
export async function syncStarryOwnershipIndex(): Promise<{ count: number }> {
  const rows:Json[]=[];
  const version=new Date().toISOString();
  const company=memoryCompanyId();
  let expected:number|null=null;
  try {
    for(let page=1;page<=40;page++) {
      const data=await pageKolProfiles({pageNo:page,pageSize:50});
      const key=['list','records','rows','items'].find(k=>Array.isArray(data[k]));
      if(!key || !Object.hasOwn(data,'total') || !Number.isInteger(Number(data.total)) || Number(data.total)<0)
        throw new Error('starry_ownership_response_incomplete');
      const total=Number(data.total);
      if(expected!=null && expected!==total)throw new Error('starry_ownership_snapshot_changed_during_pagination');
      expected=total;
      const batch=data[key] as Json[];
      rows.push(...batch);
      if(rows.length>total || (!batch.length&&rows.length<total))throw new Error('starry_ownership_count_mismatch');
      if(rows.length===total) {
        await persistStarryOwnership(rows,company,version,true);
        return {count:rows.length};
      }
    }
    throw new Error('starry_ownership_pagination_incomplete');
  } catch(error) {
    await postgresPool().query(`INSERT INTO starry_ownership_sync_state(company_id,state,source_version,profile_count,error,updated_at)
      VALUES($1,'failed',$2,$3,$4,$2) ON CONFLICT(company_id) DO UPDATE SET state='failed',error=$4,updated_at=$2`,
      [company,version,rows.length,(error instanceof Error?error.message:String(error)).slice(0,500)]);
    throw error;
  }
}
