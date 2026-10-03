import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { freshTestDatabase } from "./support/pg.js";

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

async function createEmployee(username = "employee") {
  const created = await call("POST", "/api/admin/users", {
    username,
    name: "Employee",
    password: "employee-password",
    roles: ["employee"],
    brands: ["LT"],
  });
  expect(created.response.status).toBe(201);
  return created.json;
}

async function employeeLogin(username = "employee") {
  const login = await call("POST", "/api/auth/login", {
    username,
    password: "employee-password",
  }, "");
  expect(login.response.status).toBe(200);
  return login.cookie;
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-enterprise-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  resetConn();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const initial = await call("GET", "/api/auth/status", undefined, "");
  expect(initial.json).toMatchObject({ setup_required: true, authenticated: false });
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

describe("production account and enterprise controls", () => {
  it("requires first-run setup, logs in, reports status, and logs out", async () => {
    const status = await call("GET", "/api/auth/status", undefined, "");
    expect(status.json).toMatchObject({ setup_required: false, authenticated: false });
    const login = await call("POST", "/api/auth/login", {
      email: "admin",
      password: "admin-password",
    }, "");
    expect(login.cookie).toContain("lingong_session=");
    const authenticated = await call("GET", "/api/auth/status", undefined, login.cookie);
    expect(authenticated.json).toMatchObject({
      authenticated: true,
      available_modes: ["employee", "admin"],
    });
    expect((authenticated.json.user as Record<string, unknown>).roles).toEqual(["employee", "admin"]);
    const logout = await call("POST", "/api/auth/logout", {}, login.cookie);
    expect(logout.response.status).toBe(200);
    expect(logout.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(logout.response.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("enforces admin authorization and Agent-derived skill availability", async () => {
    // Use the CI stub mode so this test reaches the employee skill PEP
    // without starting a real Codex turn. Publication no longer 409s.
    process.env.CODEX_MODE = "stub";
    const employee = await createEmployee();
    const cookie = await employeeLogin();
    expect((await call("GET", "/api/admin/users", undefined, cookie)).response.status).toBe(403);
    const session = await call("POST", "/api/sessions", { title: "gated" }, cookie);
    const denied = await call("POST", `/api/sessions/${session.json.id}/messages`, {
      text: "写合作邮件",
      intent: "email_compose",
    }, cookie);
    // 资格锚点是 Agent（ADR-2026-10-03）：未绑定的账号在提交时就被拒绝。
    expect(denied.response.status).toBe(400);
    expect(denied.json.detail).toBe("未授权该技能");
    // 保留的逐人技能授权表仍可写，但不再让技能可见或可执行。
    await call("PUT", `/api/admin/users/${employee.id}/skills/email_compose`, {});
    expect(await (await call("GET", "/api/skills", undefined, cookie)).json).toEqual([]);
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run(String(employee.id), "person:ye_guanwang");
    createAgentBinding({
      agent_id: "agent:kol", target_type: "organization_unit", target_id: "org:lt_team",
      company_id: "company:amperetime", source: "test",
    });
    const skills = await call("GET", "/api/skills", undefined, cookie);
    expect((skills.json as unknown as { id: string }[]).map((skill) => skill.id)).toContain("email_compose");
  });

  it("stores preferences and versioned Markdown memory", async () => {
    const employee = await createEmployee();
    const cookie = await employeeLogin();
    const preferences = await call("PATCH", "/api/preferences", {
      analytics_cookies: true,
      locale: "zh-CN",
    }, cookie);
    expect(preferences.json).toMatchObject({ analytics_cookies: true, locale: "zh-CN" });
    const memory = await call("POST", "/api/memory", {
      title: "Outreach preference",
      body_md: "Use the concise outreach style.",
      scope: "private",
    }, cookie);
    expect(memory.response.status).toBe(201);
    const updated = await call("PATCH", `/api/memory/${memory.json.id}`, {
      body_md: "Use a warm outreach style.",
    }, cookie);
    expect(updated.json).toMatchObject({
      title: "Outreach preference",
      version: 2,
      body_md: "Use a warm outreach style.",
    });
    expect(employee.id).toBeTruthy();
  });

  it("archives, exports, soft-deletes, and cleans a session", async () => {
    const session = await call("POST", "/api/sessions", { title: "Export me" });
    const archived = await call("POST", `/api/sessions/${session.json.id}/archive`, {});
    expect(archived.json.archived_at).toBeTruthy();
    const withArchived = await call("GET", "/api/sessions?include_archived=1");
    expect((withArchived.json as unknown as { id: string }[]).some((row) => row.id === session.json.id)).toBe(true);
    const restored = await call("POST", `/api/sessions/${session.json.id}/unarchive`, {});
    expect(restored.json.archived_at).toBeNull();
    const exported = await call("GET", `/api/sessions/${session.json.id}/export?format=json`);
    expect((exported.json.session as Record<string, unknown>).title).toBe("Export me");
    const removed = await call("DELETE", `/api/sessions/${session.json.id}`);
    expect(removed.json).toMatchObject({
      soft_deleted: true,
      immutable_data: { stage_transitions: expect.stringContaining("retained") },
    });
    expect((await call("GET", `/api/sessions/${session.json.id}`)).response.status).toBe(404);
  });

  it("creates expiring read-only shares and supports revocation", async () => {
    const session = await call("POST", "/api/sessions", { title: "Shared" });
    const share = await call("POST", `/api/sessions/${session.json.id}/share`, {
      expires_in_seconds: 60,
    });
    const token = String(share.json.token);
    expect((await call("GET", `/api/shared/${token}`, undefined, "")).json.read_only).toBe(true);
    await call("DELETE", `/api/sessions/${session.json.id}/share/${share.json.id}`);
    expect((await call("GET", `/api/shared/${token}`, undefined, "")).response.status).toBe(404);

    const expiring = await call("POST", `/api/sessions/${session.json.id}/share`, { expires_in_seconds: 60 });
    getConn().prepare("UPDATE session_shares SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(expiring.json.id);
    expect((await call("GET", `/api/shared/${expiring.json.token}`, undefined, "")).response.status).toBe(404);
  });

  it("assigns an exam and derives exam_passed from required attempts", async () => {
    const employee = await createEmployee();
    const exam = await call("POST", "/api/admin/exams", { title: "Data handling" });
    const item = await call("POST", `/api/admin/exams/${exam.json.id}/items`, {
      prompt: "Handle personal data with least privilege",
      kind: "true_false",
    });
    expect(item.response.status).toBe(201);
    await call("POST", `/api/admin/exam-items/${item.json.id}/accept`, {});
    const published = await call("POST", `/api/admin/exams/${exam.json.id}/publish`, {});
    expect(published.response.status).toBe(200);
    const assignment = await call("POST", `/api/admin/exams/${exam.json.id}/assign`, {
      user_id: employee.id,
      required: true,
    });
    const cookie = await employeeLogin();
    const statusBefore = await call("GET", "/api/auth/status", undefined, cookie);
    expect((statusBefore.json.user as Record<string, unknown>).exam_passed).toBe(false);
    expect((statusBefore.json.user as Record<string, unknown>).exam_todo_count).toBe(1);
    const submitted = await call("POST", `/api/exams/${assignment.json.id}/submit`, {
      options: { [String(item.json.id)]: "yes" },
    }, cookie);
    expect(submitted.json).toMatchObject({ passed: true, exam_passed: true });
  });

  it("replaces employee skill and approval grants without per-person connector grants", async () => {
    const employee = await createEmployee("grantee");
    const now = new Date().toISOString();
    getConn().prepare("UPDATE connectors SET enabled=1, status='configured' WHERE id IN ('starrykol','claw')").run();
    for (const [id, label] of [["enterprise_mail", "Enterprise Mail"], ["wecom", "WeCom"]]) {
      getConn().prepare(
        "INSERT OR IGNORE INTO connectors (id,label,enabled,status,credential_ref,updated_at) VALUES (?,?,?,?,?,?)",
      ).run(id, label, 1, "configured", null, now);
    }
    await call("PUT", `/api/admin/users/${employee.id}/skills`, { skills: ["email_compose", "creator_discovery"] });
    // 保留的逐人技能授权表仍可由管理端写入，供历史数据与过渡期核对；
    // 人员资格已改由 Agent 绑定决定（ADR-2026-10-03），该表不再放行任何调用。
    for (const [id, access] of [["starrykol", "read"], ["claw", "read"], ["enterprise_mail", "write"], ["wecom", "read"]]) {
      getConn().prepare(
        "INSERT OR REPLACE INTO user_connector_grants (user_id,connector_id,access,created_at) VALUES (?,?,?,?)",
      ).run(employee.id, id, access, now);
    }
    await call("PUT", `/api/admin/users/${employee.id}/approval-roles`, { roles: ["lead"] });
    const detail = await call("GET", `/api/admin/users/${employee.id}`);
    expect(detail.json).toMatchObject({
      skill_grants: expect.arrayContaining(["email_compose", "creator_discovery"]),
      approval_roles: ["lead"],
    });
    expect(detail.json).not.toHaveProperty("connector_grants");

    const cookie = await employeeLogin("grantee");
    const connectors = await call("GET", "/api/connectors", undefined, cookie);
    const connectorRows = connectors.json as unknown as Record<string, unknown>[];
    expect(connectorRows.map((item) => item.id))
      .toEqual(expect.arrayContaining(["starrykol", "claw", "enterprise_mail", "wecom"]));
    for (const row of connectorRows) {
      expect(row).not.toHaveProperty("credential_ref");
      expect(row).not.toHaveProperty("credential_reference");
      expect(row).not.toHaveProperty("credential_status");
      expect(row).not.toHaveProperty("status");
    }
  });

  it("returns employee binding detail and the runtime-backed tool list for admin governance", async () => {
    const employee = await createEmployee("directory-user");
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO user_starry_bindings
        (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(employee.id, "directory@amperetime.com", 1, "mailbox_directory", "Directory User", "secret-bearer", "connected", now);
    getConn().prepare(
      `INSERT INTO kol_follow_index
        (id,company_id,kol_uid,scope_brand,employee_id,status,claimed_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run("follow_directory", "company:amperetime", "kol_directory", "LT", employee.id, "active", now, now, now);

    const directory = await call("GET", "/api/admin/users");
    const listed = (directory.json as unknown as Array<Record<string, unknown>>).find((row) => row.id === employee.id);
    expect(listed).toMatchObject({ mailbox_count: 1, kol_count: 1 });

    const context = await call("GET", `/api/admin/users/${employee.id}/context`);
    expect(context.response.status).toBe(200);
    expect(context.json.mailboxes).toEqual([expect.objectContaining({
      mailbox_email: "directory@amperetime.com",
      status: "connected",
      is_default: true,
    })]);
    expect(context.json.mailboxes).not.toHaveProperty("0.bearer_token");
    expect(context.json.kols).toEqual([expect.objectContaining({
      kol_uid: "kol_directory",
      display_name: "kol_directory",
      scope_brand: "LT",
    })]);

    const before = await call("GET", `/api/admin/users/${employee.id}/tools`);
    const initialTool = (before.json.tools as unknown as Array<Record<string, unknown>>).find((tool) => tool.id === "email_compose");
    expect(initialTool).toMatchObject({ label: expect.any(String), granted: false });
    await call("PUT", `/api/admin/users/${employee.id}/skills`, { skills: ["email_compose"] });
    const after = await call("GET", `/api/admin/users/${employee.id}/tools`);
    const grantedTool = (after.json.tools as unknown as Array<Record<string, unknown>>).find((tool) => tool.id === "email_compose");
    expect(grantedTool).toMatchObject({ granted: true, assignable: expect.any(Boolean) });
  });

  it("returns the organization person directory without raw registry fields", async () => {
    const directory = await call("GET", "/api/admin/organization-people");
    expect(directory.response.status).toBe(200);
    const people = directory.json.people as Array<Record<string, unknown>>;
    expect(people).toHaveLength(19);
    const names = people.map((row) => String(row.display_name));
    expect(names).toEqual([...names].sort());
    expect(people.find((row) => row.person_ref === "person:ye_guanwang")).toMatchObject({
      display_name: "叶观旺",
      avatar_url: "/avatars/employees/ye_guanwang.png",
      title: "联盟营销组长",
      org_unit_id: "org:lt_team",
      user_id: null,
    });
    expect(people.find((row) => row.person_ref === "person:liu_min")).toMatchObject({ display_name: "刘敏", avatar_url: null });
    expect(people.every((row) => Object.keys(row).sort().join(",") === "avatar_url,display_name,org_unit_id,person_ref,title,user_id")).toBe(true);
    const raw = JSON.stringify(directory.json);
    for (const leaked of ["pending_fields", "source", "user_ref", "email", "employee_no"]) {
      expect(raw).not.toContain(leaked);
    }

    await createEmployee("org-directory");
    const cookie = await employeeLogin("org-directory");
    expect((await call("GET", "/api/admin/organization-people", undefined, cookie)).response.status).toBe(403);
  });

  it("updates profile and password, invalidating old sessions", async () => {
    const profile = await call("PATCH", "/api/me", { name: "Renamed Admin", email: "admin@example.com" });
    expect(profile.json).toMatchObject({ name: "Renamed Admin", email: "admin@example.com" });
    const changed = await call("POST", "/api/auth/password", {
      current_password: "admin-password",
      new_password: "new-admin-password",
    });
    expect(changed.json).toMatchObject({ ok: true, reauthenticate: true });
    expect((await call("GET", "/api/me")).response.status).toBe(401);
    const login = await call("POST", "/api/auth/login", {
      email: "admin@example.com",
      password: "new-admin-password",
    }, "");
    expect(login.response.status).toBe(200);
  });

  it("reports storage and strips private fields from public shares", async () => {
    const session = await call("POST", "/api/sessions", { title: "Public-safe" });
    await call("POST", `/api/sessions/${session.json.id}/messages`, { text: "hello" });
    const share = await call("POST", `/api/sessions/${session.json.id}/share`, { expires_in_seconds: 60 });
    const shared = await call("GET", `/api/shared/${share.json.token}`, undefined, "");
    expect(shared.json.read_only).toBe(true);
    expect((shared.json.session as Record<string, unknown>).owner_user_id).toBeUndefined();
    const summary = await call("GET", "/api/me/data-summary");
    expect(summary.json).toMatchObject({ sessions: 1 });
    expect(Number(summary.json.database_bytes)).toBeGreaterThan(0);
  });

  it("scopes recent uploads and attachment reuse to the owning employee", async () => {
    process.env.CODEX_MODE = "stub";
    const form = new FormData();
    form.append("file", new File(["private brief"], "private.md", { type: "text/markdown" }));
    const uploadedResponse = await app.request("/api/attachments", {
      method: "POST",
      headers: { Cookie: adminCookie },
      body: form,
    });
    expect(uploadedResponse.status).toBe(200);
    const uploaded = (await uploadedResponse.json()) as { id: string; name: string; path: string };
    const adminRecent = await call("GET", "/api/files/recent");
    expect((adminRecent.json as unknown as { id: string }[]).map((item) => item.id)).toContain(uploaded.id);

    await createEmployee("file-user");
    const cookie = await employeeLogin("file-user");
    const employeeRecent = await call("GET", "/api/files/recent", undefined, cookie);
    expect(employeeRecent.json).toEqual([]);
    const session = await call("POST", "/api/sessions", { title: "ownership" }, cookie);
    const denied = await call("POST", `/api/sessions/${session.json.id}/messages`, {
      text: "hello",
      attachments: [{ id: uploaded.id, name: uploaded.name, path: uploaded.path }],
    }, cookie);
    expect(denied.response.status).toBe(403);
  });
});
