import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCrawlMcpClientFactory } from "../src/crawl/service.js";
import { getConn, resetConn } from "../src/db.js";
import { setDiscoveryBriefRunner } from "../src/home-discovery.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

/**
 * AI发现 提交的人员资格锚点是 Agent（ADR-2026-10-03、CONST-05）：员工由
 * Agent 绑定的组织单元/人员覆盖获得资格，技能授权不再逐人下发。
 * 回归对象：`POST /api/home/discovery/run` 曾在按人连接器闸门（requireConnector）后
 * 抛 403 { code: "connector_disabled" }，前端只显示「请求失败 (403)」。
 */

const RUN_BODY: Json = { platforms: ["youtube"], keywords: ["camping"], mode: "search" };

function mockMcp() {
  return {
    async callTool(name: string, _args: Json = {}) {
      if (name === "start_crawl") return { task_id: "remote-auth-1", status: "running" };
      return {};
    },
    async close() {},
  };
}

let tmp = "";
let app: Hono;
let adminCookie = "";

async function call(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const response = await app.request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) as Json : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

async function login(username: string): Promise<string> {
  const result = await call("POST", "/api/auth/login", { username, password: "employee-password" }, "");
  expect(result.status).toBe(200);
  return result.cookie;
}

async function createEmployee(username: string): Promise<string> {
  const created = await call("POST", "/api/admin/users", {
    username,
    name: username,
    password: "employee-password",
    roles: ["employee"],
    brands: ["LT"],
  });
  expect(created.status).toBe(201);
  return String(created.json.id);
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-discovery-auth-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = "enabled";
  process.env.CODEX_MODE = "real";
  process.env.CLAW_MODE = "mock";
  // 覆盖仓库根 .env：用例不碰真实采集端；轮询间隔拉长，避免后台监控跨用例继续跑。
  process.env.MEDIACRAWLER_MCP_URL = "http://127.0.0.1:9/mcp";
  process.env.MEDIACRAWLER_MCP_TOKEN = "test-secret";
  process.env.MEDIACRAWLER_POLL_INTERVAL_MS = "600000";
  resetConn();
  seedAll();
  setCrawlMcpClientFactory(mockMcp);
  setDiscoveryBriefRunner(async () => ({ items: [] }));
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const setup = await call("POST", "/api/auth/setup", {
    username: "admin",
    name: "Admin",
    password: "admin-password",
    brands: ["LT", "RO", "PQ"],
  }, "");
  expect(setup.status).toBe(201);
  adminCookie = setup.cookie;
});

afterEach(() => {
  setCrawlMcpClientFactory();
  setDiscoveryBriefRunner(null);
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  process.env.CODEX_MODE = "stub";
  delete process.env.MEDIACRAWLER_MCP_URL;
  delete process.env.MEDIACRAWLER_MCP_TOKEN;
  delete process.env.MEDIACRAWLER_POLL_INTERVAL_MS;
});

describe("home discovery submit authorization", () => {
  it("accepts the signed-in admin while the claw connector is still disabled", async () => {
    const claw = getConn().prepare("SELECT enabled FROM connectors WHERE id='claw'").get() as
      | { enabled?: number }
      | undefined;
    expect(Number(claw?.enabled || 0)).toBe(0);

    const started = await call("POST", "/api/home/discovery/run", RUN_BODY);
    expect(started.status, JSON.stringify(started.json)).toBe(202);
    const runId = String(started.json.id || "");
    expect(runId).toMatch(/^drun_/);
    const job = getConn().prepare("SELECT crawl_job_id FROM discovery_runs WHERE id=?").get(runId) as
      | { crawl_job_id?: string | null }
      | undefined;
    expect(String(job?.crawl_job_id || "")).toMatch(/^crawl_/);
  });

  it("gates employees by the Agent that assembles creator_discovery, not by a skill grant", async () => {
    const userId = await createEmployee("disc_nogrant");
    const employeeCookie = await login("disc_nogrant");

    const denied = await call("POST", "/api/home/discovery/run", RUN_BODY, employeeCookie);
    expect(denied.status).toBe(403);
    expect(denied.json.detail).toMatchObject({ code: "agent_not_usable", skill_id: "creator_discovery" });

    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run(userId, "person:ye_guanwang");
    createAgentBinding({
      agent_id: "agent:kol", target_type: "organization_unit", target_id: "org:lt_team",
      company_id: "company:amperetime", source: "test",
    });

    const allowed = await call("POST", "/api/home/discovery/run", RUN_BODY, employeeCookie);
    expect(allowed.status, JSON.stringify(allowed.json)).toBe(202);
    expect(String(allowed.json.id || "")).toMatch(/^drun_/);
  });

  it("keeps a broken collector as the run's honest failure, not a submit-time 403", async () => {
    setCrawlMcpClientFactory(() => ({
      async callTool() { throw new Error("collector down"); },
      async close() {},
    }));

    const started = await call("POST", "/api/home/discovery/run", RUN_BODY);
    expect(started.status, JSON.stringify(started.json)).toBe(202);
    const runId = String(started.json.id || "");
    const run = await call("GET", `/api/home/discovery/runs/${runId}`);
    const row = run.json.run as Json;
    expect(String(row.status)).toBe("crawl_failed");
    expect(String(row.error || "")).not.toBe("");
  });
});
