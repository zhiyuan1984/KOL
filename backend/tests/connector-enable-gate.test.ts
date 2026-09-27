import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";

let tmp = "";
let app: Hono;
let adminCookie = "";

const SKILL = "creator_profile";

type ApiResult = { status: number; body: unknown };

function isJson(response: Response): boolean {
  return String(response.headers.get("content-type") || "").includes("json");
}

async function call(method: string, url: string, body?: unknown): Promise<ApiResult> {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...(adminCookie ? { Cookie: adminCookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: isJson(response) && text ? JSON.parse(text) : {} };
}

async function bindingVersion(listUrl: string, connectorId: string): Promise<number> {
  const listed = await call("GET", listUrl);
  expect(listed.status).toBe(200);
  const row = (listed.body as Array<Record<string, unknown>>).find((entry) => entry.connector_id === connectorId);
  return Number(row?.version || 0);
}

function setEnabled(connectorId: string, expected: number, code?: string): Promise<ApiResult> {
  return call("PATCH", `/api/admin/connectors/${connectorId}`, { enabled: true }).then((result) => {
    expect(result.status, JSON.stringify(result.body)).toBe(expected);
    if (code) expect(result.body).toMatchObject({ detail: { code } });
    return result;
  });
}

/** Create a draft connector, then mark it verified so only the Skill gate remains. */
async function verifiedConnector(id: string): Promise<void> {
  const created = await call("POST", "/api/admin/connectors", { id, label: id, purpose: "启用门禁用例" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const verified = await call("PATCH", `/api/admin/connectors/${id}`, { status: "verified" });
  expect(verified.status).toBe(200);
}

async function bindTool(id: string, toolName = "list_records"): Promise<void> {
  const linked = await call("PUT", `/api/admin/runtime/skills/${SKILL}/connectors/${id}`, { enabled: true, expected_version: 0 });
  expect(linked.status).toBe(200);
  const policy = await call("PUT", `/api/admin/runtime/connectors/${id}/tools/${toolName}`, {
    enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64), expected_version: 0,
  });
  expect(policy.status).toBe(200);
  const mount = await call("PUT", `/api/admin/runtime/skills/${SKILL}/tools/${id}/${toolName}`, { enabled: true, expected_version: 0 });
  expect(mount.status).toBe(200);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-connector-gate-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  process.env.NODE_ENV = "test";
  resetConn();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const setup = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", name: "Admin", password: "admin-password", brands: ["LT"] }),
  });
  expect(setup.status).toBe(201);
  adminCookie = setup.headers.get("set-cookie")?.split(";")[0] || "";
  expect(adminCookie).toBeTruthy();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  process.env.CODEX_MODE = "stub";
});

describe("connector enable gate follows Skill bindings only", () => {
  it("requires verification plus enabled Skill→Connector and Skill→Tool bindings", async () => {
    const draft = await call("POST", "/api/admin/connectors", { id: "gate_draft", label: "Gate Draft", purpose: "启用门禁用例" });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    await setEnabled("gate_draft", 409, "connector_verification_required");

    await verifiedConnector("gate_mcp");
    await setEnabled("gate_mcp", 409, "connector_skill_binding_required");

    // A Skill→Connector binding alone mounts nothing: one tool must be bound too.
    const linked = await call("PUT", `/api/admin/runtime/skills/${SKILL}/connectors/gate_mcp`, { enabled: true, expected_version: 0 });
    expect(linked.status).toBe(200);
    await setEnabled("gate_mcp", 409, "connector_skill_binding_required");

    const policy = await call("PUT", "/api/admin/runtime/connectors/gate_mcp/tools/list_records", {
      enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64), expected_version: 0,
    });
    expect(policy.status).toBe(200);
    await setEnabled("gate_mcp", 409, "connector_skill_binding_required");

    const mount = await call("PUT", `/api/admin/runtime/skills/${SKILL}/tools/gate_mcp/list_records`, { enabled: true, expected_version: 0 });
    expect(mount.status).toBe(200);
    const enabled = await setEnabled("gate_mcp", 200);
    expect(enabled.body).toMatchObject({ id: "gate_mcp", enabled: true });
  });

  it("returns to the 409 gate once either Skill binding is disabled", async () => {
    await verifiedConnector("gate_toggle");
    await bindTool("gate_toggle");
    const connectorsUrl = `/api/admin/runtime/skills/${SKILL}/connectors`;
    const toolsUrl = `/api/admin/runtime/skills/${SKILL}/tools`;

    const unlinked = await call("PUT", `/api/admin/runtime/skills/${SKILL}/connectors/gate_toggle`, {
      enabled: false, expected_version: await bindingVersion(connectorsUrl, "gate_toggle"),
    });
    expect(unlinked.status).toBe(200);
    await setEnabled("gate_toggle", 409, "connector_skill_binding_required");

    await call("PUT", `/api/admin/runtime/skills/${SKILL}/connectors/gate_toggle`, {
      enabled: true, expected_version: await bindingVersion(connectorsUrl, "gate_toggle"),
    });
    const unmounted = await call("PUT", `/api/admin/runtime/skills/${SKILL}/tools/gate_toggle/list_records`, {
      enabled: false, expected_version: await bindingVersion(toolsUrl, "gate_toggle"),
    });
    expect(unmounted.status).toBe(200);
    await setEnabled("gate_toggle", 409, "connector_skill_binding_required");

    const remounted = await call("PUT", `/api/admin/runtime/skills/${SKILL}/tools/gate_toggle/list_records`, {
      enabled: true, expected_version: await bindingVersion(toolsUrl, "gate_toggle"),
    });
    expect(remounted.status).toBe(200);
    await setEnabled("gate_toggle", 200);
  });
});
