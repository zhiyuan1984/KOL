import { postgresDb, nowIso, onDatabaseReset } from "../postgres/access.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { PLATFORM_SYNC_AGENT } from "./platform-principal.js";
import { requireRuntimeIdentityTables } from "./schema.js";
export type ManagedAgent = {
  id: string;
  name: string;
  description: string;
  status: "draft" | "published" | "disabled";
  version: number;
  created_at: string;
  updated_at: string;
};
let ready = false;
onDatabaseReset(() => { ready = false; });
export async function ensureManagedAgents(): Promise<void> {
  if (ready)
    return;
  const db = postgresDb();
  await requireRuntimeIdentityTables("managed agents", ["managed_agents"]);
  const now = nowIso();
  // The shipped KOL Agent already has a published manifest and runtime skill bindings.
  for (const [id, name, description] of [
    ["agent:kol", "KOL 智能体", "KOL 合作与跟进能力"],
    ["agent:workspace-planner", "工作规划 Agent", "工作计划、待办与分析"],
    [PLATFORM_SYNC_AGENT, "平台同步 Agent", "平台后台作业：只读同步，不对应人员；人员不能使用或绑定"],
  ]) {
    await db.execute(`INSERT INTO managed_agents (id,name,description,status,version,created_at,updated_at)
        VALUES ($1,$2,$3,'published',$4,$5,$6) ON CONFLICT (id) DO NOTHING`, id, name, description, 1, now, now);
  }
  ready = true;
}
export async function listManagedAgents(): Promise<ManagedAgent[]> {
  (await ensureManagedAgents());
  return (await postgresDb().many("SELECT * FROM managed_agents ORDER BY created_at,id")) as ManagedAgent[];
}
export async function managedAgent(id: string): Promise<ManagedAgent> {
  (await ensureManagedAgents());
  const row = (await postgresDb().one("SELECT * FROM managed_agents WHERE id=$1", id)) as ManagedAgent | undefined;
  if (!row)
    throw new HttpFail(404, "Agent 不存在");
  return row;
}
export async function agentIsPublished(id: string): Promise<boolean> {
  (await ensureManagedAgents());
  const row = (await postgresDb().one("SELECT status FROM managed_agents WHERE id=$1", id)) as {
    status?: string;
  } | undefined;
  return row?.status === "published";
}
export async function createManagedAgent(input: {
  name: string;
  description?: string;
}): Promise<ManagedAgent> {
  const name = String(input.name || "").trim();
  if (!name || name.length > 80)
    throw new HttpFail(400, "Agent 名称须为 1–80 字");
  const description = String(input.description || "").trim();
  if (description.length > 500)
    throw new HttpFail(400, "Agent 描述不能超过 500 字");
  (await ensureManagedAgents());
  const id = nid("agent");
  const now = nowIso();
  (await postgresDb().execute(`INSERT INTO managed_agents (id,name,description,status,version,created_at,updated_at)
    VALUES ($1,$2,$3,'draft',1,$4,$5)`, id, name, description, now, now));
  return (await managedAgent(id));
}
export async function updateManagedAgent(id: string, input: {
  name?: string;
  description?: string;
  status?: ManagedAgent["status"];
  expected_version: number;
}): Promise<ManagedAgent> {
  const current = (await managedAgent(id));
  if (!Number.isInteger(input.expected_version) || input.expected_version !== Number(current.version)) {
    throw new HttpFail(409, "Agent 已被其他人修改，请刷新后重试");
  }
  const name = input.name === undefined ? current.name : String(input.name).trim();
  const description = input.description === undefined ? current.description : String(input.description).trim();
  const status = input.status === undefined ? current.status : input.status;
  if (!name || name.length > 80 || description.length > 500)
    throw new HttpFail(400, "Agent 名称或描述无效");
  if (!["draft", "published", "disabled"].includes(status))
    throw new HttpFail(400, "Agent 状态无效");
  if (current.status === "draft" && status === "disabled")
    throw new HttpFail(409, "草稿可直接保留，无需停用");
  (await postgresDb().execute(`UPDATE managed_agents SET name=$1,description=$2,status=$3,version=version+1,updated_at=$4
    WHERE id=$5 AND version=$6 AND workspace_managed=FALSE`, name, description, status, nowIso(), id, current.version));
  const check = (await managedAgent(id)) as ManagedAgent & {
    workspace_managed?: boolean;
  };
  if (check.workspace_managed)
    throw new HttpFail(409, "此 Agent 已使用版本治理，请保存修订草稿并确认发布");
  return (await managedAgent(id));
}
