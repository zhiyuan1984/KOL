import { postgresPool, closePostgresPool } from '../src/postgres/pool.js';
import { repairSriphyFollowIdentity } from '../src/postgres/kol-source-authority.js';

// DATABASE_URL must be supplied by the controlled deployment environment.
const apply=process.argv.includes('--apply');
const actor=process.argv.find(a=>a.startsWith('--actor='))?.slice(8);
try {
  const preview=(await postgresPool().query(`SELECT id,company_id,kol_uid,scope_brand,status,collaboration_id
    FROM kol_follow_index WHERE employee_id='usr_sriphy' ORDER BY id`)).rows;
  if (!apply) console.log(JSON.stringify({mode:'preview',legacy_user_id:'usr_sriphy',canonical_user_id:'sriphy',follows:preview},null,2));
  else {
    if(!actor)throw new Error('--actor is required for the audited identity correction');
    console.log(JSON.stringify({mode:'applied',...await repairSriphyFollowIdentity(actor)},null,2));
  }
} finally {await closePostgresPool();}
