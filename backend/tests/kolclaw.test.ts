import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { parseKolClawMcpConfig } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import {
  executeKolClawTask,
  KOLCLAW_TASKS,
  normalizeKolClawResult,
  setKolClawClientFactory,
} from "../src/kolclaw/service.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";

let tmp = "";
let app: Hono;
const calls: Array<{ name: string; args: Json }> = [];

function mockClient() {
  return {
    async callTool(name: string, args: Json = {}): Promise<Json> {
      calls.push({ name, args });
      if (name === "list_creators") {
        return { result: JSON.stringify({ total: 1, creators: [{ id: 7, name: "户外电源达人", nickname: "户外电源达人", grade: "A", status: "待建联", followers: 85000 }] }) };
      }
      if (name === "add_creator") return { result: JSON.stringify({ ok: true, creator: { id: 101, name: args.name }, created: true }) };
      if (name === "update_creator_status") return { result: JSON.stringify({ ok: true, creator: { name: args.name, status: args.status } }) };
      if (name === "analyze_creator") return { result: JSON.stringify({ id: args.creator_id || 7, name: args.name || "户外电源达人", score: 8, grade: "A" }) };
      if (name === "analyze_creators") return { result: JSON.stringify({ total: 1, items: [{ name: "户外电源达人", score: 8 }] }) };
      if (name === "generate_outreach_script") {
        return { result: JSON.stringify({ name: args.name, dm_script: "私信话术", wechat_script: "微信话术" }) };
      }
      if (name === "get_daily_tasks") return { result: JSON.stringify({ total_tasks: 2, priority_uncontacted: [{ name: "户外电源达人" }], pending_followup: [] }) };
      if (name === "get_budget_report") {
        return { result: JSON.stringify({ campaign_id: args.campaign_id || 1, remaining_budget: 43200, pending: [{ name: "户外电源达人" }] }) };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kolclaw-"));
  process.env.LINGONG_DB = path.join(tmp, "kolclaw.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  calls.length = 0;
  setKolClawClientFactory(mockClient);
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  setKolClawClientFactory();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KOL Claw MCP config", () => {
  it("parses Cursor mcpServers JSON including streamableHttp", () => {
    expect(parseKolClawMcpConfig(`{
      "mcpServers": {
        "kol-claw": {
          "type": "streamableHttp",
          "url": "http://kol-claw.example:9093/mcp",
          "headers": { "Authorization": "Bearer kc_test_token" }
        }
      }
    }`)).toEqual({
      url: "http://kol-claw.example:9093/mcp",
      token: "kc_test_token",
    });
  });

  it("ignores placeholder tokens in markdown docs", () => {
    expect(parseKolClawMcpConfig(`
      \`\`\`json
      { "mcpServers": { "kol-claw": {
        "url": "http://47.251.65.112:9093/mcp",
        "headers": { "Authorization": "Bearer <KOLCLAW_MCP_KEY>" }
      } } }
      \`\`\`
    `)).toEqual({ url: "http://47.251.65.112:9093/mcp" });
  });
});

describe("KOL Claw result normalization", () => {
  it("unwraps { result: JSON string }", () => {
    expect(normalizeKolClawResult({ result: "{\"total\":2,\"creators\":[]}" })).toEqual({ total: 2, creators: [] });
    expect(normalizeKolClawResult({ result: { ok: true } })).toEqual({ ok: true });
  });
});

describe("KOL Claw Host orchestration", () => {
  it("profiles and scores a named creator, and batch-scores otherwise", async () => {
    await executeKolClawTask("creator_scoring", { name: "户外电源达人", target_cpm: 12 });
    await executeKolClawTask("creator_scoring", {});
    expect(calls.map((item) => item.name)).toEqual(["analyze_creator", "analyze_creators"]);
    expect(calls[1].args).toMatchObject({ mode: "resource", target_cpm: 15 });
  });

  it("generates outreach from the first library creator when no name is given", async () => {
    const { data } = await executeKolClawTask("creator_outreach", { product: "露营灯" });
    expect(calls.map((item) => item.name)).toEqual(["list_creators", "generate_outreach_script"]);
    expect(data).toMatchObject({ dm_script: "私信话术", wechat_script: "微信话术" });
  });

  it("reads daily tasks and budget reports", async () => {
    const daily = await executeKolClawTask("creator_daily_tasks", {});
    const budget = await executeKolClawTask("creator_budget_report", {});
    expect(calls.map((item) => item.name)).toEqual(["get_daily_tasks", "get_budget_report"]);
    expect(daily.data).toMatchObject({ total_tasks: 2 });
    expect(budget.data).toMatchObject({ remaining_budget: 43200, campaign_id: 1 });
  });
});

describe("KOL Claw task run path", () => {
  it("runs remaining catalog tasks from text and persists a result card", async () => {
    const prompts: Record<(typeof KOLCLAW_TASKS)[number], string> = {
      creator_scoring: "达人评分",
      creator_outreach: "生成建联话术 达人名称：户外电源达人 产品：露营灯",
      creator_daily_tasks: "今日KOL任务",
      creator_budget_report: "KOL预算 项目ID 1",
    };
    for (const taskType of KOLCLAW_TASKS) {
      const created = await request("POST", "/api/tasks/from-text", { text: prompts[taskType] });
      expect(created.status, `${taskType}: create`).toBe(201);
      const task = created.body.task as Json;
      expect(task.task_type).toBe(taskType);
      const queued = await request("POST", `/api/tasks/${task.id}/run`, {});
      expect(queued.status, `${taskType}: queue`).toBe(202);
      const executed = await request(
        "POST",
        `/api/sessions/${queued.body.session_id}/messages`,
        queued.body.pending_message,
      );
      expect(executed.status, `${taskType}: run`).toBe(200);
      const messages = executed.body.messages as Json[];
      expect(messages.some((message) => message.kind === "task_result_card"), `${taskType}: card`).toBe(true);
      expect((executed.body.worker as Json)?.skill).toBe(taskType);
      const detail = await request("GET", `/api/tasks/${task.id}`);
      expect((detail.body.artifacts as Json[]).some((artifact) => artifact.artifact_type === "task_result_card")).toBe(true);
    }
  });
});
