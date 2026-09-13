import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateApprovalPlan } from "../src/approval/plan.js";
import { canDecideCurrent, employeeForUser } from "../src/approval/inbox.js";
import { createWorkApproval } from "../src/gateway/wecom.js";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";

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
    json: text ? JSON.parse(text) as Record<string, unknown> : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

async function createApprover(username: string, name: string) {
  const created = await call("POST", "/api/admin/users", {
    username,
    name,
    password: "employee-password",
    roles: ["employee"],
    brands: ["LT", "PQ"],
  });
  expect(created.status).toBe(201);
  const id = String(created.json.id);
  await call("PUT", `/api/admin/users/${id}/connectors`, {
    connectors: ["wecom:write"],
  });
  return id;
}

async function login(username: string) {
  const result = await call("POST", "/api/auth/login", {
    username,
    password: "employee-password",
  }, "");
  expect(result.status).toBe(200);
  return result.cookie;
}

describe("approval inbox by login name", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-inbox-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "real";
    process.env.AUTH_MODE = "enabled";
    resetConn();
    seedAll();
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
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AUTH_MODE;
    process.env.CODEX_MODE = "stub";
  });

  it("maps login display names onto org employees", () => {
    expect(employeeForUser({ name: "王主管", username: "wang" })?.id).toBe("emp_wang");
    expect(employeeForUser({ name: "财务负责人", username: "finance" })?.id).toBe("emp_finance");
    expect(employeeForUser({ name: "张总", username: "zhang" })?.id).toBe("emp_zhang");
    expect(employeeForUser({ name: "林桐", username: "lintong" })?.id).toBe("emp_lintong");
    expect(employeeForUser({ name: "鄢棽", username: "sriphy" })).toBeNull();
  });

  it("lets 王主管 / 财务负责人 / 张总 see the bill only when it is their turn", async () => {
    await createApprover("lintong", "林桐");
    await createApprover("wang", "王主管");
    await createApprover("finance", "财务负责人");
    await createApprover("zhang", "张总");

    const plan = calculateApprovalPlan({
      requester_name: "黎玉燕",
      amount: 50000,
      currency: "USD",
    });
    expect(plan.rule_id).toBe("FIN-EXP-004");
    const created = createWorkApproval({
      kind: "expense",
      amountUsd: plan.amount_base,
      chain: plan.steps.map((step) => step.employee_id),
      payload: { ...plan, steps: plan.steps },
      title: "黎玉燕 USD 50000",
    });
    const aid = String(created.id);

    const cookies = {
      林桐: await login("lintong"),
      王主管: await login("wang"),
      财务负责人: await login("finance"),
      张总: await login("zhang"),
    };

    const listed = async (name: keyof typeof cookies) => {
      const result = await call("GET", "/api/approvals", undefined, cookies[name]);
      expect(result.status).toBe(200);
      const rows = result.json as unknown as {
        id: string;
        can_decide: boolean;
        current_index: number;
        chain_detail: { name: string }[];
      }[];
      return rows.find((row) => row.id === aid);
    };

    const first = await listed("王主管");
    expect(first?.can_decide).toBe(false);
    expect(first?.chain_detail[first.current_index].name).toBe("林桐");
    expect((await listed("财务负责人"))?.can_decide).toBe(false);
    expect((await listed("张总"))?.can_decide).toBe(false);
    expect((await listed("林桐"))?.can_decide).toBe(true);

    const denied = await call("POST", `/api/approvals/${aid}/decide`, {
      decision: "approve",
    }, cookies.王主管);
    expect(denied.status).toBe(403);

    for (const name of ["林桐", "王主管", "财务负责人", "张总"] as const) {
      const mine = await listed(name);
      expect(mine?.can_decide).toBe(true);
      expect(mine?.chain_detail[mine.current_index].name).toBe(name);
      const others = (["林桐", "王主管", "财务负责人", "张总"] as const).filter((row) => row !== name);
      for (const other of others) {
        const row = await listed(other);
        if (row?.can_decide) expect(row.chain_detail[row.current_index].name).toBe(other);
        else expect(row?.can_decide).toBe(false);
      }
      const decided = await call("POST", `/api/approvals/${aid}/decide`, {
        decision: "approve",
      }, cookies[name]);
      expect(decided.status).toBe(200);
    }

    expect((await listed("张总"))?.can_decide).toBe(false);
    const done = await call("GET", `/api/approvals/${aid}`, undefined, cookies.张总);
    expect((done.json as { status: string }).status).toBe("consumed");
    expect(canDecideCurrent(
      { id: "u", username: "wang", name: "王主管", handle: "wang", roles: ["employee"], role: "employee", brands: [], site: "", manager_user_id: null, active: true, exam_passed: true, exam_module: "" },
      ["emp_wang"],
      0,
    )).toBe(true);
  });

  it("lets a wecom write employee preview and create an expense without inventing a second engine", async () => {
    await createApprover("lintong", "林桐");
    const cookie = await login("lintong");
    const before = await call("GET", "/api/approvals", undefined, cookie);
    const beforeCount = (before.json as unknown as unknown[]).length;

    const preview = await call("POST", "/api/approvals/preview", {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
      requester_name: "黎玉燕",
    }, cookie);
    expect(preview.status).toBe(200);
    const steps = (preview.json as { steps: { name: string }[] }).steps;
    expect(steps.map((step) => step.name)).toEqual(["林桐"]);
    expect((await call("GET", "/api/approvals", undefined, cookie)).json as unknown as unknown[]).toHaveLength(beforeCount);

    const created = await call("POST", "/api/approvals", {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
      requester_name: "黎玉燕",
      purpose: "广告费",
    }, cookie);
    expect(created.status).toBe(200);
    const row = created.json as {
      id: string;
      kind: string;
      can_decide: boolean;
      expected_role: string;
      chain_detail: { name: string }[];
      payload: { rule_id: string };
    };
    expect(row.kind).toBe("expense");
    expect(row.payload.rule_id).toBe("FIN-EXP-001");
    expect(row.chain_detail.map((step) => step.name)).toEqual(["林桐"]);
    expect(row.can_decide).toBe(true);
    expect(row.expected_role).toBe("emp_lintong");

    const listed = await call("GET", "/api/approvals", undefined, cookie);
    expect((listed.json as unknown as { id: string }[]).some((item) => item.id === row.id)).toBe(true);

    const asMe = await call("POST", "/api/approvals/preview", {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
    }, cookie);
    expect(asMe.status).toBe(200);
    expect((asMe.json as { steps: { name: string }[]; plan: { requester_name?: string } }).plan.requester_name).toBe("林桐");
    expect((asMe.json as { steps: { name: string }[] }).steps.map((step) => step.name)).toEqual(["王主管"]);
  });

  it("requires wecom write to create, but read is enough to preview", async () => {
    const reader = await call("POST", "/api/admin/users", {
      username: "reader",
      name: "只读员工",
      password: "employee-password",
      roles: ["employee"],
      brands: ["LT"],
    });
    expect(reader.status).toBe(201);
    await call("PUT", `/api/admin/users/${String(reader.json.id)}/connectors`, {
      connectors: ["wecom:read"],
    });
    const noGrant = await call("POST", "/api/admin/users", {
      username: "nogrant",
      name: "无连接器",
      password: "employee-password",
      roles: ["employee"],
      brands: ["LT"],
    });
    expect(noGrant.status).toBe(201);

    const readCookie = await login("reader");
    const noneCookie = await login("nogrant");
    const body = {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
      requester_name: "黎玉燕",
    };

    const preview = await call("POST", "/api/approvals/preview", body, readCookie);
    expect(preview.status).toBe(200);
    const deniedCreate = await call("POST", "/api/approvals", body, readCookie);
    expect(deniedCreate.status).toBe(403);
    expect((deniedCreate.json.detail as { code?: string }).code).toBe("connector_not_granted");

    const deniedPreview = await call("POST", "/api/approvals/preview", body, noneCookie);
    expect(deniedPreview.status).toBe(403);
  });

  it("returns blocked codes when the employee form cannot compute a chain", async () => {
    await createApprover("lintong", "林桐");
    const cookie = await login("lintong");
    const blocked = await call("POST", "/api/approvals", {
      kind: "expense",
      amount: 5000,
      currency: "CNY",
      requester_name: "张三",
    }, cookie);
    expect(blocked.status).toBe(400);
    expect(blocked.json.detail).toMatchObject({ code: "unknown_requester" });
    expect(String((blocked.json.detail as { message?: string }).message)).toContain("组织名单");
  });
});
