import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";

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
    response,
    json: text ? JSON.parse(text) as Record<string, unknown> : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

async function createEmployee(username = "examinee") {
  const created = await call("POST", "/api/admin/users", {
    username,
    name: "Examinee",
    password: "employee-password",
    roles: ["employee"],
    brands: ["LT"],
  });
  expect(created.response.status).toBe(201);
  return created.json;
}

async function employeeLogin(username = "examinee") {
  const login = await call("POST", "/api/auth/login", {
    username,
    password: "employee-password",
  }, "");
  expect(login.response.status).toBe(200);
  return login.cookie;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-exam-gov-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  resetConn();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const setup = await call("POST", "/api/auth/setup", {
    username: "admin",
    name: "Admin",
    password: "admin-password",
    brands: ["LT", "RO", "PQ"],
  }, "");
  expect(setup.response.status).toBe(201);
  adminCookie = setup.cookie;
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  process.env.CODEX_MODE = "stub";
});

describe("exam governance (PROD-PLAT-07 / CONST-02)", () => {
  it("rejects assigning a draft paper", async () => {
    const employee = await createEmployee();
    const exam = await call("POST", "/api/admin/exams", { title: "Draft only" });
    expect(exam.json).toMatchObject({ status: "draft", version: 0 });
    const assigned = await call("POST", `/api/admin/exams/${exam.json.id}/assign`, {
      user_id: employee.id,
      required: true,
    });
    expect(assigned.response.status).toBe(409);
    expect(String(assigned.json.detail)).toMatch(/draft/i);
  });

  it("ignores self-reported pass and grades against the published snapshot", async () => {
    const employee = await createEmployee();
    const exam = await call("POST", "/api/admin/exams", { title: "Server grade" });
    const item = await call("POST", `/api/admin/exams/${exam.json.id}/items`, {
      prompt: "Published policy is binding",
      kind: "true_false",
    });
    expect(item.response.status).toBe(201);
    await call("POST", `/api/admin/exam-items/${item.json.id}/accept`, {});
    const published = await call("POST", `/api/admin/exams/${exam.json.id}/publish`, {});
    expect(published.response.status).toBe(200);
    expect(published.json).toMatchObject({ status: "published", version: 1 });
    const assignment = await call("POST", `/api/admin/exams/${exam.json.id}/assign`, {
      user_id: employee.id,
      required: true,
    });
    expect(assignment.response.status).toBe(201);
    const cookie = await employeeLogin();
    const submitted = await call("POST", `/api/exams/${assignment.json.id}/submit`, {
      passed: true,
      score: 100,
      pass_score: 0,
      answers: { [String(item.json.id)]: "no" },
    }, cookie);
    expect(submitted.response.status).toBe(200);
    expect(submitted.json).toMatchObject({ passed: false, exam_passed: false, score: 0, total: 1 });
  });

  it("rejects generating questions from unpublished knowledge", async () => {
    const exam = await call("POST", "/api/admin/exams", { title: "From knowledge" });
    const draft = await call("POST", "/api/admin/knowledge", {
      title: "未发布制度",
      body: "This draft must not become a live paper.",
    });
    expect(draft.response.status).toBe(201);
    expect(draft.json).toMatchObject({ status: "draft" });
    const generated = await call("POST", `/api/admin/exams/${exam.json.id}/generate`, {
      knowledge_ids: [draft.json.id],
    });
    expect(generated.response.status).toBe(409);
    expect(String(generated.json.detail)).toMatch(/unpublished/i);
  });

  it("does not let GET /api/exam fake a pass via persona", async () => {
    const demo = await call("GET", "/api/exam");
    expect(demo.response.status).toBe(200);
    expect(demo.json.passed).toBe(true);
    expect(demo.json).not.toHaveProperty("personas");
    expect(String(demo.json.note || "")).toMatch(/不按演示身份假装通过/);
  });

  it("rejects publishing while any item is still unaccepted", async () => {
    const exam = await call("POST", "/api/admin/exams", { title: "Need accept" });
    const item = await call("POST", `/api/admin/exams/${exam.json.id}/items`, {
      prompt: "Unaccepted candidate",
      kind: "true_false",
    });
    expect(item.json.accepted).toBe(false);
    const blocked = await call("POST", `/api/admin/exams/${exam.json.id}/publish`, {});
    expect(blocked.response.status).toBe(409);
    expect(String(blocked.json.detail)).toMatch(/unaccepted/i);
  });
});

describe("exam demo endpoint ignores persona pass", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-exam-demo-"));
    process.env.LINGONG_DB = path.join(tmp, "test.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    process.env.AUTH_MODE = "disabled";
    resetConn();
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminCookie = "";
  });

  it("stays honest when the exam_blocked persona is selected", async () => {
    const switched = await call("POST", "/api/me/persona", { persona: "exam_blocked" }, "");
    expect(switched.response.status).toBe(200);
    expect(switched.json.exam_passed).toBe(false);
    const demo = await call("GET", "/api/exam", undefined, "");
    expect(demo.response.status).toBe(200);
    expect(demo.json.passed).toBe(true);
    expect(demo.json).not.toHaveProperty("personas");
    expect(Number(demo.json.exam_todo_count)).toBe(0);
  });
});
