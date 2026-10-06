import { getConn, nowIso, onConnReset } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { PLATFORM_SYNC_AGENT } from "./platform-principal.js";

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
onConnReset(() => { ready = false; });

export function ensureManagedAgents(): void {
  if (ready) return;
  const db = getConn();
  db.exec(`CREATE TABLE IF NOT EXISTS managed_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('draft','published','disabled')),
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const now = nowIso();
  // The shipped KOL Agent already has a published manifest and runtime skill bindings.
  const seed = db.prepare(`INSERT INTO managed_agents (id,name,description,status,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`);
  seed.run("agent:kol", "KOL 智能体", "KOL 合作与跟进能力", "published", 1, now, now);
  seed.run("agent:workspace-planner", "工作规划 Agent", "工作计划、待办与分析", "published", 1, now, now);
  seed.run(PLATFORM_SYNC_AGENT, "平台同步 Agent", "平台后台作业：只读同步，不对应人员；人员不能使用或绑定", "published", 1, now, now);
  ready = true;
}

export function listManagedAgents(): ManagedAgent[] {
  ensureManagedAgents();
  return getConn().prepare("SELECT * FROM managed_agents ORDER BY created_at,id").all() as ManagedAgent[];
}

export function managedAgent(id: string): ManagedAgent {
  ensureManagedAgents();
  const row = getConn().prepare("SELECT * FROM managed_agents WHERE id=?").get(id) as ManagedAgent | undefined;
  if (!row) throw new HttpFail(404, "Agent 不存在");
  return row;
}

export function agentIsPublished(id: string): boolean {
  ensureManagedAgents();
  const row = getConn().prepare("SELECT status FROM managed_agents WHERE id=?").get(id) as { status?: string } | undefined;
  return row?.status === "published";
}

export function createManagedAgent(input: { name: string; description?: string }): ManagedAgent {
  const name = String(input.name || "").trim();
  if (!name || name.length > 80) throw new HttpFail(400, "Agent 名称须为 1–80 字");
  const description = String(input.description || "").trim();
  if (description.length > 500) throw new HttpFail(400, "Agent 描述不能超过 500 字");
  ensureManagedAgents();
  const id = nid("agent");
  const now = nowIso();
  getConn().prepare(`INSERT INTO managed_agents (id,name,description,status,version,created_at,updated_at)
    VALUES (?,?,?,'draft',1,?,?)`).run(id, name, description, now, now);
  return managedAgent(id);
}

export function updateManagedAgent(
  id: string,
  input: { name?: string; description?: string; status?: ManagedAgent["status"]; expected_version: number },
): ManagedAgent {
  const current = managedAgent(id);
  if (!Number.isInteger(input.expected_version) || input.expected_version !== Number(current.version)) {
    throw new HttpFail(409, "Agent 已被其他人修改，请刷新后重试");
  }
  const name = input.name === undefined ? current.name : String(input.name).trim();
  const description = input.description === undefined ? current.description : String(input.description).trim();
  const status = input.status === undefined ? current.status : input.status;
  if (!name || name.length > 80 || description.length > 500) throw new HttpFail(400, "Agent 名称或描述无效");
  if (!["draft", "published", "disabled"].includes(status)) throw new HttpFail(400, "Agent 状态无效");
  if (current.status === "draft" && status === "disabled") throw new HttpFail(409, "草稿可直接保留，无需停用");
  getConn().prepare(`UPDATE managed_agents SET name=?,description=?,status=?,version=version+1,updated_at=?
    WHERE id=? AND version=?`).run(name, description, status, nowIso(), id, current.version);
  return managedAgent(id);
}
