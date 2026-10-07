import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { ensureManagedAgents } from "../src/runtime/managed-agents.js";

/**
 * 员工面「经由哪个数字员工可用」：`GET /api/skills/:id/agents` 只返回已发布、
 * 且启用了该技能装配的 Agent 的 id 与 name。
 *
 * 依据：IA §2#4（技能面回答"当前有资格使用的 Agent 装配了哪项能力"）、
 * CONST-05（取数前按 canUseAgent 校验）、使用 ≠ 治理（不泄漏绑定目标 / 组织树 / 版本）。
 *
 * 注意：全新库启动时 `agent:kol` 的 manifest 装配（含 creator_discovery）已由
 * bootstrap 写入，测试直接复用这批出厂绑定，不重复插入。
 */

let tmp = "";
let app: Hono;

type Json = Record<string, unknown>;

async function get(url: string): Promise<{ response: Response; json: Json }> {
  const response = await app.request(url, { method: "GET", headers: {} });
  const text = await response.text();
  return { response, json: (text ? JSON.parse(text) : {}) as Json };
}

function bindSkill(agentId: string, skillId: string, enabled = 1): void {
  getConn()
    .prepare(
      "INSERT INTO runtime_agent_skills (agent_id, skill_id, enabled, version, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(agentId, skillId, enabled, 1, nowIso());
}

function insertAgent(id: string, name: string, status: string): void {
  const now = nowIso();
  getConn()
    .prepare(
      "INSERT INTO managed_agents (id,name,description,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(id, name, "", status, 1, now, now);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skill-agents-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  ensureManagedAgents();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "CODEX_MODE"]) delete process.env[key];
});

describe("GET /api/skills/:id/agents", () => {
  it("返回已发布且启用装配的 Agent，只暴露 id 与 name", async () => {
    const { response, json } = await get("/api/skills/creator_discovery/agents");
    expect(response.status).toBe(200);
    const agents = json.agents as Array<Record<string, unknown>>;
    expect(agents).toEqual([{ id: "agent:kol", name: "KOL 智能体" }]);
    for (const agent of agents) {
      expect(Object.keys(agent).sort()).toEqual(["id", "name"]);
    }
  });

  it("多 Agent 装配都返回；未启用装配 / 草稿 Agent 不返回", async () => {
    insertAgent("agent:test2", "测试智能体二", "published");
    bindSkill("agent:test2", "creator_discovery", 1);
    insertAgent("agent:disabled-bind", "停用装配智能体", "published");
    bindSkill("agent:disabled-bind", "creator_discovery", 0);
    insertAgent("agent:draft1", "草稿智能体", "draft");
    bindSkill("agent:draft1", "creator_discovery", 1);
    const { response, json } = await get("/api/skills/creator_discovery/agents");
    expect(response.status).toBe(200);
    expect(json.agents).toEqual([
      { id: "agent:kol", name: "KOL 智能体" },
      { id: "agent:test2", name: "测试智能体二" },
    ]);
  });

  it("没有 Agent 装配时返回空数组（不伪造）", async () => {
    getConn().prepare("DELETE FROM runtime_agent_skills WHERE skill_id=?").run("creator_discovery");
    const { response, json } = await get("/api/skills/creator_discovery/agents");
    expect(response.status).toBe(200);
    expect(json.agents).toEqual([]);
  });

  it("未知技能返回 404，不泄漏存在性", async () => {
    const { response } = await get("/api/skills/no_such_skill/agents");
    expect(response.status).toBe(404);
  });
});
