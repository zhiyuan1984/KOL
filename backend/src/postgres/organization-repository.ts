import type { Row } from "../types.js";
import { postgresQuery, postgresTransaction } from "./pool.js";

export type OrganizationUserInput = {
  id: string; username: string; name: string; passwordHash: string; roles: string[]; brands: string[];
  site: string; position: string; managerUserId: string | null; active: boolean; email: string; phone: string; now: string;
};
export async function pgCountUsers(): Promise<number> { const [row] = await postgresQuery<{ n: string }>("SELECT COUNT(*)::text AS n FROM users"); return Number(row?.n || 0); }
export async function pgUserById(id: string): Promise<Row | undefined> { const [row] = await postgresQuery<Row>("SELECT * FROM users WHERE id=$1", [id]); return row; }
export async function pgListUsers(): Promise<Row[]> { return postgresQuery<Row>("SELECT * FROM users ORDER BY created_at"); }
export async function pgCreateOrganizationUser(input: OrganizationUserInput): Promise<Row> {
  return postgresTransaction(async (client) => {
    await client.query(`INSERT INTO users (id,username,name,password_hash,roles,brands,site,position,manager_user_id,active,created_at,updated_at,email,phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)`, [input.id,input.username,input.name,input.passwordHash,JSON.stringify(input.roles),JSON.stringify(input.brands),input.site||null,input.position||null,input.managerUserId,input.active?1:0,input.now,input.email||null,input.phone||null]);
    return (await client.query<Row>("SELECT * FROM users WHERE id=$1", [input.id])).rows[0];
  });
}
export async function pgUpdateOrganizationUser(id: string, changes: Record<string, unknown>): Promise<Row | undefined> {
  const allowed = new Set(["email","name","site","position","manager_user_id","roles","brands","active","password_hash"]);
  const entries = Object.entries(changes).filter(([key]) => allowed.has(key));
  if (!entries.length) return pgUserById(id);
  const values = entries.map(([,value]) => value); const sets = entries.map(([key],i) => `${key}=$${i+1}`);
  sets.push(`updated_at=$${values.length+1}`); values.push(new Date().toISOString()); values.push(id);
  const rows = await postgresQuery<Row>(`UPDATE users SET ${sets.join(",")} WHERE id=$${values.length} RETURNING *`, values); return rows[0];
}
export async function pgDeactivateOrganizationUser(id: string, now: string): Promise<void> { await postgresTransaction(async (client)=>{ await client.query("UPDATE users SET active=0,updated_at=$2 WHERE id=$1",[id,now]); await client.query("DELETE FROM auth_sessions WHERE user_id=$1",[id]); }); }
export async function pgUpdatePasswordAndRevokeSessions(id: string, passwordHash: string, now: string): Promise<void> { await postgresTransaction(async(client)=>{ await client.query("UPDATE users SET password_hash=$2,updated_at=$3 WHERE id=$1",[id,passwordHash,now]); await client.query("DELETE FROM auth_sessions WHERE user_id=$1",[id]); }); }
export async function pgRevokeUserSessions(id: string): Promise<void> { await postgresQuery("DELETE FROM auth_sessions WHERE user_id=$1",[id]); }
export async function pgSyncOrganizationMembership(userId: string, unitId: string | null, now: string): Promise<void> {
  await postgresTransaction(async(client)=>{
    const user=(await client.query<Row>("SELECT id,name,username,email FROM users WHERE id=$1",[userId])).rows[0]; if(!user) throw new Error("unknown user");
    const target=unitId?(await client.query<Row>("SELECT id,company_id,status FROM organization_units WHERE id=$1",[unitId])).rows[0]:undefined; if(unitId&&(!target||String(target.status)!=="active")) throw new Error("unknown active organization unit");
    const current=(await client.query<Row>("SELECT person_ref FROM organization_people WHERE user_id=$1 LIMIT 1",[userId])).rows[0]; const personRef=current?.person_ref?String(current.person_ref):`person:user:${userId}`;
    await client.query(`INSERT INTO organization_people(person_ref,display_name,user_ref,user_id,email,status,source,created_at,updated_at) VALUES($1,$2,$3,$3,$4,'active','admin',$5,$5) ON CONFLICT(person_ref) DO UPDATE SET display_name=EXCLUDED.display_name,user_id=EXCLUDED.user_id,email=EXCLUDED.email,status='active',updated_at=EXCLUDED.updated_at`,[personRef,user.name,userId,String(user.email||(String(user.username).includes("@")?user.username:"")),now]);
    const old=(await client.query<Row>("SELECT id,company_id,org_unit_id FROM organization_memberships WHERE person_ref=$1 AND relation='primary' AND status='active'",[personRef])).rows;
    for(const row of old) if(String(row.org_unit_id)!==unitId) await client.query("UPDATE organization_memberships SET status='ended',effective_to=$2,updated_at=$2 WHERE id=$1",[row.id,now]);
    if(target&&!old.some(row=>String(row.org_unit_id)===String(target.id))){const id=`member:${personRef}:${target.id}:primary`; await client.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,effective_from,source,created_at,updated_at) VALUES($1,$2,$3,$4,'primary','active',$5,'admin',$5,$5) ON CONFLICT(id) DO UPDATE SET status='active',effective_from=EXCLUDED.effective_from,effective_to=NULL,updated_at=EXCLUDED.updated_at`,[id,personRef,target.company_id,target.id,now]);}
  });
}
