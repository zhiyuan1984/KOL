/** PostgreSQL-native Agent coverage diagnostic; metadata queries only. */
import { getConn } from "../src/db.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { effectiveAgentUsers } from "../src/runtime/organization-tree.js";
type Row = Record<string, unknown>;
const args = process.argv.slice(2);
function flag(name: string): string { const i=args.indexOf(name); return i>=0?String(args[i+1]||"").trim():""; }
const agentArg=flag("--agent"),userArg=flag("--user");
if(!agentArg||!userArg) throw new Error("用法：--agent <Agent id 或名称> --user <账号 id、用户名或姓名>");
async function rows(sql: string, values: unknown[] = []): Promise<Row[]> { return (await getConn().query<Row>(sql, values)).rows; }
try {
  const agent=(await rows("SELECT id,name,status,version FROM managed_agents WHERE id=$1 OR name=$1",[agentArg]))[0];
  const agentId=String(agent?.id||agentArg);
  console.log(`Agent：${agent?`${agent.name}（${agent.id}，${agent.status}，v${agent.version}）`:`${agentArg}（未找到，按 id 继续）`}`);
  const units=new Map((await rows("SELECT id,display_name,parent_id,status FROM organization_units")).map(row=>[String(row.id),row]));
  function chain(id:string):string {
    const out:string[]=[],seen=new Set<string>();let current:string|null=id;
    while(current&&!seen.has(current)){seen.add(current);const unit=units.get(current);out.push(unit?`${unit.display_name}(${current}${unit.status==='active'?'':`, ${unit.status}`})`:`${current}(不存在)`);current=unit?.parent_id?String(unit.parent_id):null;}
    return out.join(" → ");
  }
  console.log("\n绑定点（含已撤销）：");
  for(const row of await rows("SELECT id,target_type,target_id,status,binding_version,source,reason,updated_at FROM agent_bindings WHERE agent_id=$1 ORDER BY status,target_type,target_id",[agentId])) {
    const label=row.target_type==='organization_unit'?units.get(String(row.target_id))?.display_name||row.target_id:row.target_id;
    console.log(`  [${row.status}] ${row.target_type} ${label}（${row.target_id}） v${row.binding_version} · ${row.source||''} · ${row.reason||''} · ${row.updated_at}`);
  }
  console.log("\n绑定相关审计（最近 20 条）：");
  for(const row of await rows("SELECT ts,actor,event_type,payload FROM audit_events WHERE event_type LIKE 'admin.agent.%bind%' AND payload LIKE $1 ORDER BY id DESC LIMIT 20",[`%${agentId}%`])) console.log(`  ${row.ts} ${row.actor} ${row.event_type} ${String(row.payload).slice(0,300)}`);
  const user=(await rows("SELECT id,username,name,site,active FROM users WHERE id=$1 OR username=$1 OR name=$1",[userArg]))[0];
  const person=(await rows(user?"SELECT person_ref,display_name,user_id,status FROM organization_people WHERE user_id=$1":"SELECT person_ref,display_name,user_id,status FROM organization_people WHERE display_name=$1 OR person_ref=$1",[user?user.id:userArg]))[0];
  console.log(`\n员工账号：${user?`${user.name}（${user.id} / ${user.username}，site=${user.site??'空'}，active=${user.active}）`:'未找到'}`);
  console.log(`人员锚点：${person?`${person.display_name}（${person.person_ref}，user_id=${person.user_id??'空'}，${person.status}）`:'未找到'}`);
  if(person){console.log("组织成员关系（含已结束）：");for(const row of await rows("SELECT org_unit_id,relation,status,effective_from,effective_to,source FROM organization_memberships WHERE person_ref=$1 ORDER BY status,relation",[person.person_ref]))console.log(`  [${row.status}] ${row.relation} ${chain(String(row.org_unit_id))} · ${row.effective_from??''} ~ ${row.effective_to??''} · ${row.source||''}`);}
  const effective=await effectiveAgentUsers(agentId),covered=person?effective.users.find(entry=>entry.person_ref===person.person_ref):undefined;
  console.log(`\n覆盖名单：${effective.users.length} 人，组织版本 ${effective.org_version}`);
  if(!covered)console.log("结论：该员工不在覆盖名单中。请核对 active 绑定点、人员与成员关系的上级链。");
  else{console.log(`结论：已覆盖${covered.user_id?'':'（人员未关联账号，账号侧仍不可用）'}，来源：`);for(const source of covered.sources)console.log(`  ${source.via} · ${source.via_unit_display_name||source.via_unit_id} · 绑定点 ${source.binding_target_display_name||source.binding_target_id}`);}
} finally { await closePostgresPool(); }
