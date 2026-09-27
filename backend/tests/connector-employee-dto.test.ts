import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { setConnectorConfig, setToolPolicy } from "../src/runtime/store.js";

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

/**
 * Per-person connector grants no longer have an administration endpoint
 * (DECISIONS.md ADR-2026-09-27); the retained table is seeded directly so the
 * still-published employee use surface keeps its regression coverage.
 */
function seedConnectorGrant(userId: string, connectorId: string, access: "read" | "write"): void {
  getConn().prepare(
    "INSERT OR REPLACE INTO user_connector_grants (user_id,connector_id,access,created_at) VALUES (?,?,?,?)",
  ).run(userId, connectorId, access, new Date().toISOString());
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
      "UPDATE connectors SET credential_ref=?, status=?, enabled=1 WHERE id='starrykol'",
    ).run("vault://starrykol/prod", "configured");
    getConn().prepare(
      "INSERT OR IGNORE INTO connectors (id,label,enabled,status,credential_ref,updated_at) VALUES (?,?,?,?,?,?)",
    ).run("hidden_tool", "Hidden tool", 0, "configured", "vault://hidden", new Date().toISOString());

    seedConnectorGrant(String(employee.id), "starrykol", "read");
    seedConnectorGrant(String(employee.id), "hidden_tool", "write");

    const cookie = await employeeLogin("dto-user");
    const listed = await call("GET", "/api/connectors", undefined, cookie);
    expect(listed.response.status).toBe(200);
    const rows = listed.json as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual(["starrykol"]);
    expect(rows).toHaveLength(1);
    for (const row of rows) assertEmployeeConnectorDto(row);
    expect(rows[0]).toMatchObject({ id: "starrykol", access: "read" });
    expect(rows.some((row) => row.id === "hidden_tool" || row.id === "claw")).toBe(false);
  });

  it("projects explicit write grants and never returns the word admin", async () => {
    const employee = await createEmployee("admin-grant");
    getConn().prepare(
      "UPDATE connectors SET enabled=1, status='configured' WHERE id='starrykol'",
    ).run();
    seedConnectorGrant(String(employee.id), "starrykol", "write");
    const cookie = await employeeLogin("admin-grant");
    const listed = await call("GET", "/api/connectors", undefined, cookie);
    const rows = listed.json as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toContain("starrykol");
    const connector = rows.find((row) => row.id === "starrykol");
    expect(connector).toBeTruthy();
    assertEmployeeConnectorDto(connector!);
    expect(connector).toMatchObject({ access: "write" });
  });

  it("employee route sources do not deep-link /admin/connectors", () => {
    // The employee connector page itself was retired with the per-person
    // connector use surface (ADR-2026-09-27); the remaining entries stay.
    const employeeFiles = [
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
    getConn().prepare("UPDATE connectors SET credential_ref=?, enabled=1 WHERE id='starrykol'").run("vault://starrykol");
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

    const employee = await createEmployee("serializer-user");
    seedConnectorGrant(String(employee.id), "starrykol", "read");
    const employeeSurface = await call("GET", "/api/connectors", undefined, await employeeLogin("serializer-user"));
    const useRows = employeeSurface.json as Record<string, unknown>[];
    expect(useRows.length).toBeGreaterThan(0);
    for (const row of useRows) assertEmployeeConnectorDto(row);
  });

  it("no longer exposes per-user connector grants or organization/connector scope endpoints", async () => {
    const retired: Array<[string, string]> = [
      ["PUT", "/api/admin/users/usr_missing/connectors/starrykol"],
      ["DELETE", "/api/admin/users/usr_missing/connectors/starrykol"],
      ["PUT", "/api/admin/users/usr_missing/connectors"],
      ["GET", "/api/admin/runtime/connectors/starrykol/connector-scope"],
      ["PUT", "/api/admin/runtime/connectors/starrykol/connector-scope"],
      ["GET", "/api/admin/runtime/connectors/starrykol/organization-scope"],
      ["POST", "/api/admin/runtime/connectors/starrykol/organization-scope/nodes"],
      ["GET", "/api/admin/runtime/connectors/starrykol/tools/pageKolProfiles/scope"],
      ["PUT", "/api/admin/runtime/connectors/starrykol/tools/pageKolProfiles/scope"],
    ];
    for (const [method, url] of retired) {
      const response = await app.request(url, {
        method,
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
        body: method === "PUT" || method === "POST" ? "{}" : undefined,
      });
      expect(response.status, `${method} ${url}`).toBe(404);
    }
  });

  it("reports catalog kind, protocol, icon, and approved tool count", async () => {
    const db = getConn();
    const now = new Date().toISOString();
    for (const id of ["dto_mcp", "dto_http"]) {
      db.prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES(?,?,?,?,?)")
        .run(id, id, 1, "configured", now);
    }
    setConnectorConfig("dto_http", { protocol: "http", url: "https://api.example.com", allow_unauthenticated: true }, 0);
    setToolPolicy("dto_mcp", "list_records", { enabled: true, risk: "L1", access: "read", schema_hash: "b".repeat(64) }, 0);
    db.prepare("UPDATE connectors SET icon_ref='stored-icon.png' WHERE id='dto_mcp'").run();

    const rows = (await call("GET", "/api/admin/connectors")).json as Record<string, unknown>[];
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.starrykol).toMatchObject({ kind: "app", protocol: "mcp", icon_url: "/api/admin/connectors/starrykol/icon" });
    expect(byId.dto_mcp).toMatchObject({
      kind: "custom_mcp",
      protocol: "mcp",
      icon_url: "/api/admin/connectors/dto_mcp/icon",
      approved_tool_count: 1,
    });
    expect(byId.dto_http).toMatchObject({ kind: "custom_api", protocol: "http", icon_url: null, approved_tool_count: 0 });
  });

  it("keeps a declared HTTP API draft classified as custom_api before any runtime config exists", async () => {
    const created = await call("POST", "/api/admin/connectors", {
      id: "e2e-http-draft", label: "HTTP Draft", purpose: "草稿分类", protocol: "http",
    });
    expect(created.response.status).toBe(201);
    expect(created.json).toMatchObject({ kind: "custom_api", protocol: "http" });

    const mcpDraft = await call("POST", "/api/admin/connectors", {
      id: "e2e-mcp-draft", label: "MCP Draft", purpose: "草稿分类",
    });
    expect(mcpDraft.json).toMatchObject({ kind: "custom_mcp", protocol: "mcp" });

    const rejected = await call("POST", "/api/admin/connectors", {
      id: "e2e-bad-draft", label: "Bad Draft", purpose: "草稿分类", protocol: "grpc",
    });
    expect(rejected.response.status).toBe(400);

    const listed = await call("GET", "/api/admin/connectors");
    const row = (listed.json as Record<string, unknown>[]).find((item) => item.id === "e2e-http-draft");
    expect(row).toMatchObject({ kind: "custom_api", protocol: "http" });
  });
});
