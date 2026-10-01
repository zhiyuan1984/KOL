import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  BudgetBlocked,
  budgetBlockFor,
  captureThreadUsage,
  costsSummary,
  monthWindow,
  parseThreadUsage,
  recordCostEvent,
  upsertBudget,
} from "../src/costs.js";
import { HttpFail } from "../src/host/errors.js";
import { costsRouter } from "../src/routers/costs.js";
import type { Json } from "../src/types.js";

let tmp: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map((k) => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "costs-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  getConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function eventCount(): number {
  return Number((getConn().prepare("SELECT COUNT(*) AS n FROM cost_events").get() as { n: number }).n);
}

describe("costs module", () => {
  it("windows months in Asia/Shanghai (UTC+8)", () => {
    const window = monthWindow("2026-09");
    expect(window.startIso).toBe("2026-08-31T16:00:00.000Z");
    expect(window.endIso).toBe("2026-09-30T16:00:00.000Z");
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 5, occurredAt: "2026-08-31T15:59:59.000Z" });
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 7, occurredAt: "2026-08-31T16:00:00.000Z" });
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 11, occurredAt: "2026-09-30T16:00:00.000Z" });
    const summary = costsSummary("2026-09") as unknown as {
      totals: Record<string, number>;
      agents: Array<Record<string, string | number>>;
    };
    expect(summary.totals.total_tokens).toBe(7);
    expect(summary.agents[0]).toMatchObject({ agent_id: "agent:kol", total_tokens: 7, events: 1 });
  });

  it("aggregates per agent and reports honest notes", () => {
    recordCostEvent({ source: "test", agentId: "agent:kol", inputTokens: 100, outputTokens: 20 });
    recordCostEvent({ source: "test", agentId: "agent:kol", inputTokens: 10 });
    recordCostEvent({ source: "test", agentId: "agent:workspace-planner", totalTokens: 5 });
    recordCostEvent({ source: "test", totalTokens: 3 });
    const summary = costsSummary() as unknown as {
      totals: Record<string, number>;
      agents: Array<Record<string, string | number>>;
      notes: string[];
    };
    expect(summary.totals).toMatchObject({ input_tokens: 110, output_tokens: 20, total_tokens: 138, events: 4 });
    expect(summary.agents.map((a) => a.agent_id)).toEqual(["agent:kol", "agent:workspace-planner"]);
    expect(summary.notes).toContain("usage_estimated_source");
    expect(summary.notes).toContain("cost_cents_unavailable");
  });

  it("validates and versions budgets", () => {
    const first = upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 1000, actor: "t", expectedVersion: 0 });
    expect(first.version).toBe(0);
    const second = upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 2000, actor: "t", expectedVersion: 0 });
    expect(second.version).toBe(1);
    expect(second.limit_tokens).toBe(2000);
    let conflict: unknown;
    try {
      upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 3000, actor: "t", expectedVersion: 0 });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(HttpFail);
    expect((conflict as HttpFail).status).toBe(409);
    expect(() => upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 0, actor: "t", expectedVersion: 1 }))
      .toThrowError(HttpFail);
    expect(() => upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 10, warnPercent: 90, hardStopPercent: 50, actor: "t", expectedVersion: 1 }))
      .toThrowError(HttpFail);
  });

  it("blocks only at the hard-stop threshold and respects scopes", () => {
    upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 1000, actor: "t", expectedVersion: 0 });
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 799 });
    expect(budgetBlockFor("agent:kol")).toBeNull();
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 1 });
    expect(budgetBlockFor("agent:kol")).toBeNull();
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 200 });
    const blocked = budgetBlockFor("agent:kol");
    expect(blocked).toMatchObject({ scope: "agent", scope_ref: "agent:kol", used_tokens: 1000, limit_tokens: 1000, percent: 100 });
    expect(new BudgetBlocked(blocked!).asDict()).toMatchObject({ code: "budget_exceeded" });
    expect(budgetBlockFor("agent:workspace-planner")).toBeNull();

    // 公司级与 Agent 级分别生效；公司行先判定。
    upsertBudget({ scope: "company", scopeRef: "company:amperetime", limitTokens: 50, actor: "t", expectedVersion: 0 });
    recordCostEvent({ source: "test", agentId: "agent:workspace-planner", totalTokens: 60 });
    expect(budgetBlockFor("agent:kol")?.scope).toBe("company");
    expect(budgetBlockFor("agent:workspace-planner")).toMatchObject({ scope: "company", scope_ref: "company:amperetime" });

    // 公司行停用后：kol 命中自身 Agent 行；未配置预算的 ws 放行。
    upsertBudget({ scope: "company", scopeRef: "company:amperetime", limitTokens: 50, enabled: false, actor: "t", expectedVersion: 0 });
    expect(budgetBlockFor("agent:kol")?.scope).toBe("agent");
    expect(budgetBlockFor("agent:workspace-planner")).toBeNull();

    // Agent 行停用后全部放行。
    upsertBudget({ scope: "agent", scopeRef: "agent:kol", limitTokens: 1000, enabled: false, actor: "t", expectedVersion: 0 });
    expect(budgetBlockFor("agent:kol")).toBeNull();
  });

  it("parses thread usage defensively", () => {
    expect(parseThreadUsage({ threadUsage: { inputTokens: 10, outputTokens: 5 } })).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(parseThreadUsage({ usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5, model: "gpt-5" } }))
      .toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5, model: "gpt-5" });
    expect(parseThreadUsage({ threadUsage: { usage: { inputTokens: 8 } } })).toMatchObject({ inputTokens: 8, totalTokens: 8 });
    expect(parseThreadUsage({ threadUsage: null })).toBeNull();
    expect(parseThreadUsage({})).toBeNull();
    expect(parseThreadUsage(null)).toBeNull();
  });

  it("captures thread usage without ever throwing", async () => {
    const log: Json[] = [];
    const capture = (request: (method: string, params?: Json, timeout?: number) => Promise<Json>) => captureThreadUsage({
      rpc: { request },
      threadId: "thr_1",
      log,
      agentId: "agent:kol",
      skillId: "creator_discovery",
      sessionId: "sess_1",
      runId: "wrk_1",
    });
    await capture(async () => ({ threadUsage: { inputTokens: 100, outputTokens: 20 } }));
    expect(eventCount()).toBe(1);
    expect(log.at(-1)).toMatchObject({ method: "account/usage/read", params: { captured: true, input_tokens: 100, output_tokens: 20 } });
    await capture(async () => ({ threadUsage: null }));
    expect(eventCount()).toBe(1);
    expect(log.at(-1)).toMatchObject({ params: { captured: false, reason: "usage_unavailable" } });
    await capture(async () => {
      throw new Error("request timeout");
    });
    expect(eventCount()).toBe(1);
    expect(log.at(-1)).toMatchObject({ params: { captured: false } });
  });
});

describe("costs router", () => {
  function app(): Hono {
    const a = new Hono();
    a.onError((e, c) => e instanceof HttpFail
      ? c.json({ detail: e.detail }, e.status as 400 | 403 | 404 | 409)
      : c.json({ detail: "unexpected" }, 500));
    a.route("/api", costsRouter);
    return a;
  }

  it("serves the summary and the events list", async () => {
    recordCostEvent({ source: "test", agentId: "agent:kol", inputTokens: 7, outputTokens: 3, occurredAt: "2026-09-10T00:00:00.000Z" });
    const response = await app().request("/api/admin/costs/summary?month=2026-09");
    expect(response.status).toBe(200);
    const summary = await response.json() as Record<string, Json>;
    expect(summary.month).toBe("2026-09");
    expect(summary.timezone).toBe("Asia/Shanghai");
    expect((summary.totals as Record<string, number>).total_tokens).toBe(10);
    const events = await (await app().request("/api/admin/costs/events?limit=5")).json() as { events: Json[] };
    expect(events.events).toHaveLength(1);
  });

  it("validates budget payloads and returns version conflicts", async () => {
    const headers = { "content-type": "application/json" };
    const badLimit = await app().request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "agent", scope_ref: "agent:kol", limit_tokens: 0, expected_version: 0 }),
    });
    expect(badLimit.status).toBe(400);
    const missingVersion = await app().request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "agent", scope_ref: "agent:kol", limit_tokens: 100 }),
    });
    expect(missingVersion.status).toBe(400);
    const created = await app().request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "agent", scope_ref: "agent:kol", limit_tokens: 100, warn_percent: 80, hard_stop_percent: 100, expected_version: 0 }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ scope: "agent", scope_ref: "agent:kol", limit_tokens: 100, version: 0 });
    const conflict = await app().request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "agent", scope_ref: "agent:kol", limit_tokens: 50, expected_version: 7 }),
    });
    expect(conflict.status).toBe(409);
    const unknown = await app().request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "agent", scope_ref: "agent:kol", nope: true, expected_version: 1 }),
    });
    expect(unknown.status).toBe(400);
  });
});

describe("cost user dimension", () => {
  it("records, aggregates, and lists the requesting employee", () => {
    recordCostEvent({ source: "test", agentId: "agent:kol", userId: "usr_a", inputTokens: 10, outputTokens: 5 });
    recordCostEvent({ source: "test", agentId: "agent:kol", userId: "usr_b", totalTokens: 4 });
    recordCostEvent({ source: "test", agentId: "agent:kol", totalTokens: 2 });
    const summary = costsSummary() as unknown as {
      users: Array<Record<string, string | number>>;
      budgets: Array<Record<string, unknown>>;
    };
    expect(summary.users.map((row) => row.user_id)).toEqual(["usr_a", "usr_b"]);
    expect(summary.users[0]).toMatchObject({ total_tokens: 15, events: 1 });
    const userBudgetRows = summary.budgets.filter((row) => row.scope === "user");
    expect(userBudgetRows.map((row) => row.scope_ref).sort()).toEqual(["usr_a", "usr_b"]);
  });

  it("blocks only the employee whose own budget is exhausted", () => {
    upsertBudget({ scope: "user", scopeRef: "usr_a", limitTokens: 100, actor: "t", expectedVersion: 0 });
    recordCostEvent({ source: "test", agentId: "agent:kol", userId: "usr_a", totalTokens: 100 });
    const blocked = budgetBlockFor("agent:kol", "usr_a");
    expect(blocked).toMatchObject({ scope: "user", scope_ref: "usr_a", used_tokens: 100, percent: 100 });
    expect(new BudgetBlocked(blocked!).asDict()).toMatchObject({ code: "budget_exceeded", scope: "user" });
    expect(budgetBlockFor("agent:kol", "usr_b")).toBeNull();
    expect(budgetBlockFor("agent:kol")).toBeNull();
    upsertBudget({ scope: "user", scopeRef: "usr_a", limitTokens: 100, enabled: false, actor: "t", expectedVersion: 0 });
    expect(budgetBlockFor("agent:kol", "usr_a")).toBeNull();
  });

  it("captures the requesting employee on thread usage", async () => {
    const log: Json[] = [];
    await captureThreadUsage({
      rpc: { request: async () => ({ threadUsage: { inputTokens: 7, outputTokens: 3 } }) },
      threadId: "thr_user",
      log,
      agentId: "agent:kol",
      userId: "usr_a",
      skillId: "email_compose",
      sessionId: "sess_u",
      runId: "wrk_u",
    });
    const row = getConn().prepare("SELECT user_id, total_tokens FROM cost_events ORDER BY created_at DESC LIMIT 1")
      .get() as { user_id: string; total_tokens: number };
    expect(row).toMatchObject({ user_id: "usr_a", total_tokens: 10 });
    expect(log.at(-1)).toMatchObject({ params: { captured: true, total_tokens: 10 } });
  });

  it("accepts user scope through the budget API and rejects unknown scopes", async () => {
    const a = new Hono();
    a.onError((e, c) => e instanceof HttpFail
      ? c.json({ detail: e.detail }, e.status as 400 | 403 | 404 | 409)
      : c.json({ detail: "unexpected" }, 500));
    a.route("/api", costsRouter);
    const headers = { "content-type": "application/json" };
    const created = await a.request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "user", scope_ref: "usr_a", limit_tokens: 500, expected_version: 0 }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ scope: "user", scope_ref: "usr_a", limit_tokens: 500, version: 0 });
    const rejected = await a.request("/api/admin/costs/budget", {
      method: "PUT",
      headers,
      body: JSON.stringify({ scope: "team", scope_ref: "team_a", limit_tokens: 500, expected_version: 0 }),
    });
    expect(rejected.status).toBe(400);
  });
});
