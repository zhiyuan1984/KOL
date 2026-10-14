/**
 * Agent 覆盖诊断 CLI（只读）：解释某个 Agent 的绑定点为什么覆盖/没覆盖某位员工。
 *
 * 输出：该 Agent 的全部 agent_bindings（含已撤销）与 admin.agent.bind* 审计；
 * 员工的人员锚点、全部组织成员关系（含已结束）及所属单元的上级链；最终是否在覆盖名单里、经由哪些绑定点。
 * 使用应用同一 PostgreSQL 数据源（DATABASE_URL），不写业务数据。
 *
 *   cd backend && npx tsx scripts/diagnose-agent-coverage.ts --agent 线索智能体 --user 鄢棽
 *   cd backend && npx tsx scripts/diagnose-agent-coverage.ts --agent agent:kol --user sriphy
 */
import { postgresDb } from "../src/postgres/access.js";
import { effectiveAgentUsers } from "../src/runtime/organization-tree.js";
type Row = Record<string, unknown>;
const args = process.argv.slice(2);
function flag(name: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}
const agentArg = flag("--agent");
const userArg = flag("--user");
if (!agentArg || !userArg) {
  console.error("用法：--agent <Agent id 或名称> --user <账号 id、用户名或姓名>");
  process.exit(2);
}
const db = postgresDb();
const all = async (sql: string, ...params: unknown[]) => (await db.many(sql, ...params as never[])) as Row[];
const one = async (sql: string, ...params: unknown[]) => (await db.one(sql, ...params as never[])) as Row | undefined;
async function main(): Promise<void> {
  const agent = await (async () => {
    try {
      return await one("SELECT id,name,status,version FROM managed_agents WHERE id=$1 OR name=$2", agentArg, agentArg);
    }
    catch {
      return undefined;
    }
  })();
  const agentId = String(agent?.id || agentArg);
  console.log(`Agent：${agent ? `${agent.name}（${agent.id}，${agent.status}，v${agent.version}）` : `${agentArg}（managed_agents 中未找到，按 id 继续）`}`);
  const units = new Map((await all("SELECT id,display_name,parent_id,status FROM organization_units")).map((row) => [String(row.id), row]));
  const unitName = (id: unknown) => units.get(String(id))?.display_name || String(id);
  const chain = (id: string) => {
  const out: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const unit = units.get(current);
    out.push(unit ? `${unit.display_name}(${current}${unit.status === "active" ? "" : `, ${unit.status}`})` : `${current}(不存在)`);
    current = unit?.parent_id ? String(unit.parent_id) : null;
  }
  return out.join(" → ");
  };
  console.log("\n绑定点（含已撤销）：");
  for (const row of await all("SELECT id,target_type,target_id,status,binding_version,source,reason,updated_at FROM agent_bindings WHERE agent_id=$1 ORDER BY status,target_type,target_id", agentId)) {
  const label = row.target_type === "organization_unit" ? unitName(row.target_id) : String(row.target_id);
  console.log(`  [${row.status}] ${row.target_type} ${label}（${row.target_id}） v${row.binding_version} · ${row.source || ""} · ${row.reason || ""} · ${row.updated_at}`);
  }
  console.log("\n绑定相关审计（最近 20 条）：");
  for (const row of await all("SELECT ts,actor,event_type,payload FROM audit_events WHERE event_type LIKE 'admin.agent.%bind%' AND payload LIKE $1 ORDER BY id DESC LIMIT 20", `%${agentId}%`)) {
  console.log(`  ${row.ts} ${row.actor} ${row.event_type} ${String(row.payload).slice(0, 300)}`);
  }
  const user = await one("SELECT id,username,name,site,active FROM users WHERE id=$1 OR username=$2 OR name=$3", userArg, userArg, userArg);
  const person = user
    ? await one("SELECT person_ref,display_name,user_id,status FROM organization_people WHERE user_id=$1", user.id)
    : await one("SELECT person_ref,display_name,user_id,status FROM organization_people WHERE display_name=$1 OR person_ref=$2", userArg, userArg);
  console.log(`\n员工账号：${user ? `${user.name}（${user.id} / ${user.username}，site=${user.site ?? "空"}，active=${user.active}）` : "未找到"}`);
  console.log(`人员锚点：${person ? `${person.display_name}（${person.person_ref}，user_id=${person.user_id ?? "空"}，${person.status}）` : "未找到——没有人员锚点就不会进入任何覆盖名单"}`);
  if (person) {
  console.log("组织成员关系（含已结束）：");
    for (const row of await all("SELECT org_unit_id,relation,status,effective_from,effective_to,source FROM organization_memberships WHERE person_ref=$1 ORDER BY status,relation", person.person_ref)) {
    console.log(`  [${row.status}] ${row.relation} ${chain(String(row.org_unit_id))} · ${row.effective_from ?? ""} ~ ${row.effective_to ?? ""} · ${row.source || ""}`);
  }
  }
  const effective = await effectiveAgentUsers(agentId);
  const covered = person ? effective.users.find((entry) => entry.person_ref === person.person_ref) : undefined;
  console.log(`\n覆盖名单：${effective.users.length} 人，组织版本 ${effective.org_version}`);
  if (!covered) {
  console.log("结论：该员工不在覆盖名单中。对照上面的 active 绑定点与 active 成员关系的上级链排查。");
  }
  else {
  console.log(`结论：已覆盖${covered.user_id ? "" : "（但人员没有关联账号，账号侧仍不可用）"}，来源：`);
  for (const source of covered.sources) {
    console.log(`  ${source.via} · ${source.via_unit_display_name || source.via_unit_id} · 绑定点 ${source.binding_target_display_name || source.binding_target_id}`);
  }
  }
}
try {
  await main();
}
finally {
  await db.close();
}
