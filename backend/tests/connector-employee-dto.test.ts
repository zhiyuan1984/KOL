import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let tmp = "";
let app: Hono;
let adminCookie = "";

const dtoFixture = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "backend/tests/fixtures/employee-connector-dto.json"), "utf8"),
) as { forbidden_keys: string[]; access: string[] };

function assertEmployeeConnectorDto(row: Record<string, unknown>) {
  for (const key of dtoFixture.forbidden_keys) {
    expect(row, `employee DTO must not emit ${key}`).not.toHaveProperty(key);
  }
  expect(JSON.stringify(row)).not.toMatch(/credential_/i);
  expect(JSON.stringify(row)).not.toMatch(/"admin"/);
  expect(dtoFixture.access).toContain(row.access);
  expect(row.id).toEqual(expect.any(String));
  expect(row.label).toEqual(expect.any(String));
}

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
    json: text ? JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[] : {},
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
  return created.json as Record<string, unknown>;
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-connector-dto-"));
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
    brands: ["LT"],
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

describe("employee connector use-surface DTO", () => {
  it("omits credential_* and governance status; hides unauthorized and disabled rows", async () => {
    const employee = await createEmployee("dto-user");
    getConn().prepare(
      "UPDATE connectors SET credential_ref=?, status=? WHERE id='starry'",
    ).run("vault://starry/prod", "configured");
    getConn().prepare(
      "INSERT OR IGNORE INTO connectors (id,label,enabled,status,credential_ref,updated_at) VALUES (?,?,?,?,?,?)",
    ).run("hidden_tool", "Hidden tool", 0, "configured", "vault://hidden", new Date().toISOString());

    await call("PUT", `/api/admin/users/${employee.id}/connectors`, {
      connectors: ["starry:read", "hidden_tool:write", "wecom:admin"],
    });
    await call("PATCH", "/api/admin/connectors/wecom", { enabled: false });

    const cookie = await employeeLogin("dto-user");
    const listed = await call("GET", "/api/connectors", undefined, cookie);
    expect(listed.response.status).toBe(200);
    const rows = listed.json as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual(["starry"]);
    expect(rows).toHaveLength(1);
    for (const row of rows) assertEmployeeConnectorDto(row);
    expect(rows[0]).toMatchObject({ id: "starry", access: "read" });
    expect(rows.some((row) => row.id === "hidden_tool" || row.id === "wecom" || row.id === "claw")).toBe(false);
  });

  it("projects admin grants to write and never returns the word admin", async () => {
    const employee = await createEmployee("admin-grant");
    await call("PUT", `/api/admin/users/${employee.id}/connectors/${"enterprise_mail"}`, {
      access: "admin",
    });
    const cookie = await employeeLogin("admin-grant");
    const listed = await call("GET", "/api/connectors", undefined, cookie);
    const rows = listed.json as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toContain("enterprise_mail");
    const mail = rows.find((row) => row.id === "enterprise_mail");
    expect(mail).toBeTruthy();
    assertEmployeeConnectorDto(mail!);
    expect(mail).toMatchObject({ access: "write" });
  });

  it("employee route sources do not deep-link /admin/connectors", () => {
    const employeeFiles = [
      "frontend/src/pages/ConnectorUse.tsx",
      "frontend/src/pages/SkillHub.tsx",
      "frontend/src/pages/AccountSettings.tsx",
      "frontend/src/layout/Workbench.tsx",
      "frontend/src/connectorUse.ts",
      "frontend/src/components/StarryBindForm.tsx",
    ];
    for (const rel of employeeFiles) {
      const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(source, rel).not.toContain("/admin/connectors");
    }
    const simplePages = fs.readFileSync(path.join(repoRoot, "frontend/src/pages/SimplePages.tsx"), "utf8");
    const skillsSection = simplePages.slice(0, simplePages.indexOf("export function Admin"));
    expect(skillsSection).not.toContain("/admin/connectors");
  });

  it("keeps credential fields on admin serializer endpoints only", async () => {
    getConn().prepare("UPDATE connectors SET credential_ref=? WHERE id='starrykol'").run("vault://starrykol");
    const adminList = await call("GET", "/api/admin/connectors");
    expect(adminList.response.status).toBe(200);
    const adminRows = adminList.json as Record<string, unknown>[];
    const starrykol = adminRows.find((row) => row.id === "starrykol");
    expect(starrykol).toMatchObject({
      credential_ref: "vault://starrykol",
      credential_reference: "vault://starrykol",
      credential_status: "已配置",
    });
    expect(starrykol).toHaveProperty("status");

    const employeeSurface = await call("GET", "/api/connectors");
    const useRows = employeeSurface.json as Record<string, unknown>[];
    expect(useRows.length).toBeGreaterThan(0);
    for (const row of useRows) assertEmployeeConnectorDto(row);
  });
});
