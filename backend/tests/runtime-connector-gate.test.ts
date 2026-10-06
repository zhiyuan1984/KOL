import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, listAudit, resetConn } from "../src/db.js";
import { connectorGapResponse } from "../src/host/api.js";
import { declaredManagedConnectors, skillConnectorGaps, unusableDiscoveredConnector } from "../src/runtime/skill-connector-gate.js";
import { ensureRuntimeSchema, getToolPolicy, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { parseDeclaredMcp } from "../src/runtime/skill-coverage.js";
import { taskDefinition } from "../src/tasks/registry.js";
import { seedAll } from "../src/seed.js";
import type { Intent } from "../src/types.js";
import { authenticatedTestApp, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import { publishFixtureSkills } from "./helpers/skill-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";

type Json = Record<string, unknown>;

const HASH = "b".repeat(64);
/**
 * 会话消息入口要读 PostgreSQL 权威表（authorizedTaskSession），本机没有 PostgreSQL——
 * 与 context-resolve.test.ts 同一环境限制；配了 TEST_DATABASE_URL 就一起跑。
 */
const hasPostgres = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

/** 员工可见文案：不得出现 MCP、skill_runtime、连接器 id、工具别名或技能 id（DESIGN §15、§16）。 */
function expectBusinessCopy(payload: Json): void {
  const copy = `${String(payload.message || "")} ${String(payload.next_action || "")}`;
  for (const word of ["MCP", "skill_runtime", "connector", "starrykol", "creator_library_query", "rt_", "已通知管理员"]) {
    expect(copy, word).not.toContain(word);
  }
}

let tmp = "";
let env: Record<string, string | undefined>;
const savedMode = process.env.CODEX_MODE;

function setMode(mode: string): void {
  process.env.CODEX_MODE = mode;
}

function policy(connectorId: string, toolName: string): void {
  setToolPolicy(connectorId, toolName, { enabled: true, risk: "L1", access: "read", schema_hash: HASH }, 0);
}

/** 线上口径：声明工具的策略已由管理员放行，只差把技能挂上去。 */
function policiesFor(skillId: string, connectorId = "starrykol"): void {
  for (const tool of parseDeclaredMcp(taskDefinition(skillId)?.mcp || [])) {
    if (tool.connector_id === connectorId && !getToolPolicy(connectorId, tool.tool_name)) policy(connectorId, tool.tool_name);
  }
}

function session(sid: string): void {
  const now = new Date().toISOString();
  getConn().prepare(
    "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id) VALUES (?,?,?,?,?,?,?)",
  ).run(sid, "连接缺口", now, now, "kol", 0, null);
}

function intentFor(skill: string): Intent {
  return {
    type: skill,
    skill,
    handle: null,
    amount_usd: null,
    tracking: null,
    carrier: null,
    eta: null,
    needs_worker: true,
    raw: skill,
    collaboration_id: null,
    extras: {},
  };
}

beforeEach(() => {
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "DATABASE_URL", "CODEX_MODE", "AUTH_MODE"].map((key) => [key, process.env[key]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "connector-gate-"));
  delete process.env.DATABASE_URL;
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "test.db"),
    LINGONG_DATA: tmp,
    CODEX_MODE: "stub",
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
  });
  publishFixtureSkills(tmp, ["declared_fixture"]);
  resetConn();
  ensureRuntimeSchema();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (savedMode === undefined) delete process.env.CODEX_MODE;
  else process.env.CODEX_MODE = savedMode;
});

describe("declaredManagedConnectors", () => {
  it("只认已登记的受管连接器，未登记别名不进缺口判定", () => {
    // 夹具同时声明 starrykol.*（受管）与 starry.get_collaboration（legacy 未登记）。
    expect(declaredManagedConnectors("declared_fixture")).toEqual(["starrykol"]);
    // confirm_stage / creator_scoring 只声明 legacy 与 kolclaw 别名，目录里没有这两行。
    expect(declaredManagedConnectors("confirm_stage")).toEqual([]);
    expect(declaredManagedConnectors("creator_scoring")).toEqual([]);
    // 没有声明任何工具的技能不是缺口候选。
    expect(declaredManagedConnectors("today_plan")).toEqual([]);
    expect(declaredManagedConnectors("不存在的技能")).toEqual([]);
  });
});

describe("skillConnectorGaps", () => {
  it("已登记连接器没有父绑定就是缺口", () => {
    policiesFor("declared_fixture");
    policiesFor("creator_library_query");
    expect(skillConnectorGaps("declared_fixture")).toEqual([{ connector_id: "starrykol", reason: "connector_unbound" }]);
    // 线上真实场景：达人库查询声明了 starrykol 工具，策略已放行，却没有任何挂载行。
    expect(skillConnectorGaps("creator_library_query")).toEqual([{ connector_id: "starrykol", reason: "connector_unbound" }]);
  });

  it("声明工具的策略都未放行时不算未接通：那是等管理员审批策略的另一种治理状态", () => {
    // 谈判纪要只声明了受写入策略约束的远端工具，本职（整理本地摘要）不依赖它，不能整体拦掉。
    expect(skillConnectorGaps("declared_fixture")).toEqual([]);
    setToolPolicy("starrykol", "pageKolProfiles", { enabled: false, risk: "L1", access: "read", schema_hash: HASH }, 0);
    expect(skillConnectorGaps("declared_fixture")).toEqual([]);
  });

  it("有启用工具绑定就不算缺口", () => {
    policy("starrykol", "pageKolProfiles");
    setSkillConnector("declared_fixture", "starrykol", true, 0);
    setSkillTool("declared_fixture", "starrykol", "pageKolProfiles", true, 0);
    expect(skillConnectorGaps("declared_fixture")).toEqual([]);
  });

  it("父绑定被停用、或启用工具绑定为 0 都是缺口", () => {
    policy("starrykol", "pageKolProfiles");
    setSkillConnector("declared_fixture", "starrykol", true, 0);
    setSkillTool("declared_fixture", "starrykol", "pageKolProfiles", true, 0);
    setSkillConnector("declared_fixture", "starrykol", false, 1);
    expect(skillConnectorGaps("declared_fixture")).toEqual([{ connector_id: "starrykol", reason: "connector_unbound" }]);

    setSkillConnector("declared_fixture", "starrykol", true, 2);
    setSkillTool("declared_fixture", "starrykol", "pageKolProfiles", false, 1);
    expect(skillConnectorGaps("declared_fixture")).toEqual([{ connector_id: "starrykol", reason: "no_tool_bound" }]);
  });

  it("unknown_connector 不计入，也不误伤只声明 legacy 别名的技能", () => {
    // confirm_stage 只声明 legacy `starry.*`，kolclaw 系技能声明的是未登记的 `kolclaw.*`。
    expect(declaredManagedConnectors("confirm_stage")).toEqual([]);
    expect(skillConnectorGaps("confirm_stage")).toEqual([]);
    expect(skillConnectorGaps("creator_daily_tasks")).toEqual([]);
    expect(skillConnectorGaps("creator_budget_report")).toEqual([]);
  });
});

describe("unusableDiscoveredConnector", () => {
  it("声明了已登记连接器、远端又报它失败，且该连接器 0 个工具时才算运行期缺口", () => {
    expect(unusableDiscoveredConnector("creator_library_query", {
      tools: [],
      unavailable: [{ connector_id: "starrykol", code: "runtime_remote_timeout" }],
    })).toEqual({ connector_id: "starrykol", code: "runtime_remote_timeout" });
    // 已经发现到工具：turn 有真数据可调用，不拦。
    expect(unusableDiscoveredConnector("creator_library_query", {
      tools: [{ connectorId: "starrykol" }],
      unavailable: [{ connector_id: "starrykol", code: "runtime_no_authorized_tools" }],
    })).toBeNull();
    // 没有绑定行时 discover 连 unavailable 都不记，这种缺口由前置拦截负责。
    expect(unusableDiscoveredConnector("creator_library_query", { tools: [], unavailable: [] })).toBeNull();
    // 只报未登记连接器（legacy starry）或别家连接器，不算缺口。
    expect(unusableDiscoveredConnector("creator_library_query", {
      tools: [],
      unavailable: [{ connector_id: "starry", code: "runtime_connector_unbound" }],
    })).toBeNull();
    expect(unusableDiscoveredConnector("today_plan", {
      tools: [],
      unavailable: [{ connector_id: "starrykol", code: "runtime_remote_unavailable" }],
    })).toBeNull();
  });
});

describe("连接缺口卡（Host 闸门）", () => {
  it("真实模式命中缺口：不落 steps、不起箱，只落业务语言的连接缺口卡", () => {
    session("ses_connector_gap");
    setMode("real");
    policiesFor("creator_library_query");
    const response = connectorGapResponse("ses_connector_gap", {}, intentFor("creator_library_query"), "creator_library_query");
    expect(response).not.toBeNull();
    expect(response!.worker).toBeNull();
    expect(response!.connector_gap).toMatchObject({ code: "runtime_connector_unmounted", skill_id: "creator_library_query", connectors: ["starrykol"] });
    // 带 error：绑定任务/运行按失败收尾，不记成已完成。
    expect(response!.error).toMatchObject({ code: "runtime_connector_unmounted", ok: false });

    const messages = response!.messages as Json[];
    const kinds = messages.map((message) => message.kind);
    expect(kinds).toContain("error_card");
    // 没有 steps / task_result_card 说明 mapWorker 从未跑过：本次未起箱、未起 turn。
    expect(kinds).not.toContain("steps");
    expect(kinds).not.toContain("task_result_card");
    const cards = messages.filter((message) => message.kind === "error_card");
    expect(cards).toHaveLength(1);
    const card = cards[0].payload as Json;
    expect(card).toMatchObject({
      code: "runtime_connector_unmounted",
      // 前端 errorTitle(status || code)：可读 status 就是员工看到的标题，机器码只留在 code。
      status: "数据连接尚未接通",
      message: "“达人库查询”所需的数据连接尚未接通，本次没有开始处理，也没有使用缓存或虚构数据。",
      next_action: "请联系管理员在连接管理中为该技能完成挂载。",
    });
    // code 是机器字段，员工文案单独校验。
    expectBusinessCopy(card);

    const audited = listAudit("runtime.connector_gap");
    expect(audited).toHaveLength(1);
    expect(audited[0].payload).toMatchObject({
      skill_id: "creator_library_query",
      connector_id: "starrykol",
      reason: "connector_unbound",
    });
  });

  it("stub 模式不拦截：不落卡、不写审计", () => {
    session("ses_stub_no_gate");
    setMode("stub");
    expect(connectorGapResponse("ses_stub_no_gate", {}, intentFor("creator_library_query"), "creator_library_query")).toBeNull();
    expect(listAudit("runtime.connector_gap")).toHaveLength(0);
  });

  it("工具绑定齐备时不拦截", () => {
    session("ses_connector_ready");
    policy("starrykol", "pageKolProfiles");
    setSkillConnector("creator_library_query", "starrykol", true, 0);
    setSkillTool("creator_library_query", "starrykol", "pageKolProfiles", true, 0);
    setMode("real");
    expect(connectorGapResponse("ses_connector_ready", {}, intentFor("creator_library_query"), "creator_library_query")).toBeNull();
  });

  it("任务协作分析（kol_analyze）本轮不挂载业务工具，不按声明工具拦截", () => {
    session("ses_task_analysis");
    setMode("real");
    expect(connectorGapResponse("ses_task_analysis", {}, intentFor("kol_analyze"), "kol_analyze")).toBeNull();
  });

  it("只声明 legacy 别名的技能不被拦截", () => {
    session("ses_stage_write");
    setMode("real");
    expect(connectorGapResponse("ses_stage_write", {}, intentFor("confirm_stage"), "confirm_stage")).toBeNull();
  });
});

async function waitForKind(app: Hono, sid: string, kind: string, timeoutMs = 15_000): Promise<Json[]> {
  const deadline = Date.now() + timeoutMs;
  let last: Json[] = [];
  while (Date.now() < deadline) {
    const snapshot = await (await app.request(`/api/sessions/${sid}`)).json() as Json;
    last = (snapshot.messages as Json[]) || [];
    if (last.some((message) => message.kind === kind)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return last;
}

describe.skipIf(!hasPostgres)("运行路径的连接缺口闸门（需要 PostgreSQL）", () => {
  beforeEach(async () => {
    await freshTestDatabase();
    setMode("real");
    process.env.AUTH_MODE = "enabled";
    resetConn();
    seedAll();
  });

  async function ask(app: Hono, intent: string, text: string): Promise<string> {
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: text }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, intent, act: "ask" }),
    });
    // 真实模式立即受理，结果由后台落卡。
    expect([200, 202]).toContain(response.status);
    return id;
  }

  it("声明了连接器却没有任何挂载：不起箱、不起 turn，员工只看到连接缺口卡", async () => {
    const cookie = seedRuntimeTestActor(["creator_library_query"]);
    policiesFor("creator_library_query");
    const { createApp } = await import("../src/app.js");
    const app = authenticatedTestApp(createApp(), cookie);
    const sid = await ask(app, "creator_library_query", "查询达人库");
    const messages = await waitForKind(app, sid, "error_card");
    const card = messages.find((message) => message.kind === "error_card")?.payload as Json;
    expect(card).toMatchObject({
      code: "runtime_connector_unmounted",
      message: "“达人库查询”所需的数据连接尚未接通，本次没有开始处理，也没有使用缓存或虚构数据。",
      next_action: "请联系管理员在连接管理中为该技能完成挂载。",
    });
    expectBusinessCopy(card);
    const serialized = JSON.stringify(messages);
    for (const word of ["skill_runtime", "starrykol", "creator_library_query", "rt_"]) {
      expect(serialized, word).not.toContain(word);
    }
    // 未起箱：没有箱内步骤，也没有任务结果。
    expect(messages.map((message) => message.kind)).not.toContain("steps");
    expect(messages.some((message) => message.kind === "task_result_card")).toBe(false);
    expect(listAudit("runtime.connector_gap").length).toBeGreaterThan(0);
  });

  it("stub 模式不拦截：照常起箱并出结果", async () => {
    setMode("stub");
    process.env.AUTH_MODE = "disabled";
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "查询达人库" }),
    });
    const { id } = (await created.json()) as { id: string };
    const response = await app.request(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "查询达人库", intent: "creator_library_query", act: "ask" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Json;
    expect(body.connector_gap).toBeUndefined();
    expect((body.worker as Json)?.skill).toBe("creator_library_query");
    expect(JSON.stringify(body.messages)).not.toContain("runtime_connector_unmounted");
    expect(listAudit("runtime.connector_gap")).toHaveLength(0);
  });
});
