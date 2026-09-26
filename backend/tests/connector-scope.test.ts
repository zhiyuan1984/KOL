import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import {
  addOrganizationScopeNode,
  connectorHasAnyScope,
  connectorScopeConfigured,
  getConnectorScopeSnapshot,
  getOrganizationScopeSnapshot,
  replaceConnectorScope,
  replaceToolScope,
  userConnectorScopeAccess,
} from "../src/runtime/organization.js";
import { ensureRuntimeSchema, setConnectorConfig, setToolPolicy } from "../src/runtime/store.js";

let tmp = "";
let previous: Record<string, string | undefined> = {};

beforeEach(() => {
  previous = Object.fromEntries(
    ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV", "CODEX_MODE"].map((key) => [key, process.env[key]]),
  );
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "connector-scope-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  ensureRuntimeSchema();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

const ADMIN = "usr_scope_admin";

function seedConnector(id: string, status = "verified"): string {
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES(?,?,0,?,?)")
    .run(id, `${id} fixture`, status, "now");
  return id;
}

function seedUser(id: string, position = "", active = 1): string {
  getConn().prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,position,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, id, id, "x", '["employee"]', "[]", "", position, active, "now", "now");
  return id;
}

function addNode(connectorId: string, input: { name?: string; level: number; parent_id?: string; user_id?: string }): string {
  const before = new Set(getOrganizationScopeSnapshot(connectorId).nodes.map((node) => node.id));
  const nodes = addOrganizationScopeNode(connectorId, input).nodes;
  const created = nodes.find((node) => !before.has(node.id));
  if (!created) throw new Error("scope node was not created");
  return created.id;
}

function countRows(table: "runtime_connector_scope_policies" | "runtime_connector_scope_bindings" | "runtime_connector_scope_modes", connectorId: string): number {
  const row = getConn().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE connector_id=?`).get(connectorId) as { n: number };
  return Number(row.n);
}

function failure(run: () => unknown): { status: number | undefined; code: string | undefined } {
  try {
    run();
  } catch (error) {
    const thrown = error as { status?: number; detail?: { code?: string } };
    return { status: thrown.status, code: thrown.detail?.code };
  }
  throw new Error("expected the call to fail");
}

describe("connector-level organization scope", () => {
  it("resolves selected department, team, and person bindings down the node tree", () => {
    const connectorId = seedConnector("scope_tree");
    seedUser(ADMIN);
    seedUser("usr_scope_a");
    seedUser("usr_scope_b");
    seedUser("usr_scope_other");
    const department = addNode(connectorId, { name: "营销中心", level: 1 });
    const team = addNode(connectorId, { name: "达人合作部", level: 2, parent_id: department });
    addNode(connectorId, { level: 3, parent_id: team, user_id: "usr_scope_a" });
    const otherDepartment = addNode(connectorId, { name: "品牌中心", level: 1 });
    const otherTeam = addNode(connectorId, { name: "品牌传播部", level: 2, parent_id: otherDepartment });
    const otherPerson = addNode(connectorId, { level: 3, parent_id: otherTeam, user_id: "usr_scope_b" });

    expect(connectorScopeConfigured(connectorId)).toBe(false);
    expect(connectorHasAnyScope(connectorId)).toBe(false);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_a")).toBeNull();

    const departmentBinding = replaceConnectorScope(connectorId, "selected", [{ node_id: department }], ADMIN);
    expect(departmentBinding.bindings).toEqual([{ node_id: department, access: "read" }]);
    expect(connectorScopeConfigured(connectorId)).toBe(true);
    expect(connectorHasAnyScope(connectorId)).toBe(true);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_a")).toBe("read");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_b")).toBeNull();
    expect(userConnectorScopeAccess(connectorId, "usr_scope_other")).toBeNull();

    replaceConnectorScope(connectorId, "selected", [
      { node_id: department },
      { node_id: otherPerson, access: "write" },
    ], ADMIN);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_a")).toBe("read");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_b")).toBe("write");

    // A child write binding wins over the read binding on its parent department.
    replaceConnectorScope(connectorId, "selected", [
      { node_id: department, access: "read" },
      { node_id: team, access: "write" },
    ], ADMIN);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_a")).toBe("write");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_b")).toBeNull();
    expect(countRows("runtime_connector_scope_modes", connectorId)).toBe(0);
  });

  it("matches a level-three position node against the user's position", () => {
    const connectorId = seedConnector("scope_position");
    seedUser(ADMIN);
    seedUser("usr_scope_kol", "KOL 经理");
    seedUser("usr_scope_buyer", "采购经理");
    const department = addNode(connectorId, { name: "营销中心", level: 1 });
    const team = addNode(connectorId, { name: "达人合作部", level: 2, parent_id: department });
    const position = addNode(connectorId, { name: "KOL 经理", level: 3, parent_id: team });

    replaceConnectorScope(connectorId, "selected", [{ node_id: department }], ADMIN);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_kol")).toBe("read");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_buyer")).toBeNull();

    replaceConnectorScope(connectorId, "selected", [{ node_id: position, access: "write" }], ADMIN);
    expect(userConnectorScopeAccess(connectorId, "usr_scope_kol")).toBe("write");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_buyer")).toBeNull();
  });

  it("grants read to every active user in all mode and nothing for unset", () => {
    const connectorId = seedConnector("scope_all");
    seedUser(ADMIN);
    seedUser("usr_scope_active");
    seedUser("usr_scope_inactive", "", 0);

    expect(getConnectorScopeSnapshot(connectorId)).toMatchObject({ mode: "unset", bindings: [], coverage: { users: 0, read: 0, write: 0 } });

    const snapshot = replaceConnectorScope(connectorId, "all", [], ADMIN);
    expect(snapshot).toMatchObject({ mode: "all", updated_by: ADMIN, bindings: [], coverage: { users: 2, read: 2, write: 0 } });
    expect(userConnectorScopeAccess(connectorId, "usr_scope_active")).toBe("read");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_inactive")).toBeNull();
    expect(userConnectorScopeAccess(connectorId, "usr_scope_missing")).toBeNull();
    expect(snapshot.updated_at).toBeTruthy();
  });

  it("clears the policy row and bindings when the scope returns to unset", () => {
    const connectorId = seedConnector("scope_unset");
    seedUser(ADMIN);
    const member = seedUser("usr_scope_member");
    const department = addNode(connectorId, { name: "营销中心", level: 1 });
    const team = addNode(connectorId, { name: "达人合作部", level: 2, parent_id: department });
    addNode(connectorId, { level: 3, parent_id: team, user_id: member });

    replaceConnectorScope(connectorId, "selected", [{ node_id: department, access: "write" }], ADMIN);
    expect(userConnectorScopeAccess(connectorId, member)).toBe("write");
    expect(countRows("runtime_connector_scope_policies", connectorId)).toBe(1);
    expect(countRows("runtime_connector_scope_bindings", connectorId)).toBe(1);

    const cleared = replaceConnectorScope(connectorId, "unset", [], ADMIN);
    expect(cleared).toMatchObject({ mode: "unset", updated_by: null, updated_at: null, bindings: [], coverage: { users: 0, read: 0, write: 0 } });
    expect(connectorScopeConfigured(connectorId)).toBe(false);
    expect(connectorHasAnyScope(connectorId)).toBe(false);
    expect(userConnectorScopeAccess(connectorId, member)).toBeNull();
    expect(countRows("runtime_connector_scope_policies", connectorId)).toBe(0);
    expect(countRows("runtime_connector_scope_bindings", connectorId)).toBe(0);
  });

  it("rejects invalid modes, bindings, nodes, and access levels", () => {
    const connectorId = seedConnector("scope_validation");
    seedUser(ADMIN);
    const department = addNode(connectorId, { name: "营销中心", level: 1 });

    expect(failure(() => replaceConnectorScope(connectorId, "everyone", [], ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_invalid_mode" });
    expect(failure(() => replaceConnectorScope(connectorId, "selected", [], ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_bindings_required" });
    expect(failure(() => replaceConnectorScope(connectorId, "selected", "scope_missing", ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_invalid_bindings" });
    expect(failure(() => replaceConnectorScope(connectorId, "selected", [{ node_id: "scope_missing" }], ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_node_unknown" });
    expect(failure(() => replaceConnectorScope(connectorId, "selected", [{ node_id: department, access: "admin" }], ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_invalid_access" });
    expect(failure(() => replaceConnectorScope(connectorId, "all", [{ node_id: "scope_missing" }], ADMIN)))
      .toEqual({ status: 400, code: "runtime_connector_scope_node_unknown" });
    expect(countRows("runtime_connector_scope_policies", connectorId)).toBe(0);

    // The first occurrence of a duplicated node wins, and access defaults to read.
    const deduped = replaceConnectorScope(connectorId, "selected", [
      { node_id: department, access: "read" },
      { node_id: department, access: "write" },
    ], ADMIN);
    expect(deduped.bindings).toEqual([{ node_id: department, access: "read" }]);
    expect(replaceConnectorScope(connectorId, "selected", [{ node_id: department }], ADMIN).bindings)
      .toEqual([{ node_id: department, access: "read" }]);
  });

  it("previews how many users a selected scope reaches at each level", () => {
    const connectorId = seedConnector("scope_coverage");
    seedUser(ADMIN);
    seedUser("usr_scope_first");
    seedUser("usr_scope_second", "KOL 经理");
    seedUser("usr_scope_third");
    const department = addNode(connectorId, { name: "营销中心", level: 1 });
    const team = addNode(connectorId, { name: "达人合作部", level: 2, parent_id: department });
    addNode(connectorId, { level: 3, parent_id: team, user_id: "usr_scope_first" });
    const position = addNode(connectorId, { name: "KOL 经理", level: 3, parent_id: team });
    const otherTeam = addNode(connectorId, { name: "品牌传播部", level: 2, parent_id: department });
    addNode(connectorId, { level: 3, parent_id: otherTeam, user_id: "usr_scope_third" });

    expect(replaceConnectorScope(connectorId, "selected", [{ node_id: department }], ADMIN).coverage)
      .toEqual({ users: 3, read: 3, write: 0 });

    const mixed = replaceConnectorScope(connectorId, "selected", [
      { node_id: department, access: "read" },
      { node_id: position, access: "write" },
    ], ADMIN);
    expect(mixed.coverage).toEqual({ users: 3, read: 2, write: 1 });
    expect(mixed.bindings).toHaveLength(2);
    expect(mixed.bindings).toContainEqual({ node_id: department, access: "read" });
    expect(mixed.bindings).toContainEqual({ node_id: position, access: "write" });
    expect(userConnectorScopeAccess(connectorId, "usr_scope_second")).toBe("write");
    expect(userConnectorScopeAccess(connectorId, "usr_scope_first")).toBe("read");
  });

  it("keeps connector and tool scopes as independent gates", () => {
    const connectorId = seedConnector("scope_independent");
    seedUser(ADMIN);
    const department = addNode(connectorId, { name: "营销中心", level: 1 });
    setToolPolicy(connectorId, "pageKolProfiles", { enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64) }, 0);
    replaceToolScope(connectorId, "pageKolProfiles", [department], ADMIN);
    expect(connectorScopeConfigured(connectorId)).toBe(false);
    expect(connectorHasAnyScope(connectorId)).toBe(true);

    replaceConnectorScope(connectorId, "all", [], ADMIN);
    expect(connectorHasAnyScope(connectorId)).toBe(true);
    expect(getConnectorScopeSnapshot(connectorId).mode).toBe("all");
  });
});

describe("connector scope API and enable gate", () => {
  let app: Hono;
  const headers = { "Content-Type": "application/json" };

  beforeEach(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  function call(method: string, url: string, body?: unknown) {
    return app.request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function addNodeThroughApi(connectorId: string, body: Record<string, unknown>): Promise<string> {
    const response = await call("POST", `/api/admin/runtime/connectors/${connectorId}/organization-scope/nodes`, body);
    expect(response.status).toBe(201);
    const snapshot = await response.json() as { nodes: Array<{ id: string; name: string; level: number }> };
    const created = snapshot.nodes.find((node) => node.level === body.level && node.name === body.name);
    if (!created) throw new Error("scope node was not created");
    return created.id;
  }

  it("stores a selected connector scope and audits the update", async () => {
    const connectorId = seedConnector("scope_api");
    const nodeId = await addNodeThroughApi(connectorId, { name: "营销中心", level: 1 });
    const scopeUrl = `/api/admin/runtime/connectors/${connectorId}/connector-scope`;

    const stored = await call("PUT", scopeUrl, { mode: "selected", bindings: [{ node_id: nodeId, access: "write" }] });
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({
      connector_id: connectorId,
      mode: "selected",
      bindings: [{ node_id: nodeId, access: "write" }],
      coverage: { users: 0, read: 0, write: 0 },
    });

    const read = await call("GET", scopeUrl);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ mode: "selected", bindings: [{ node_id: nodeId, access: "write" }] });

    const rejected = await call("PUT", scopeUrl, { mode: "all", unknown_field: true });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ detail: { code: "runtime_organization_invalid_request" } });
    const invalidMode = await call("PUT", scopeUrl, { mode: "everyone" });
    expect(invalidMode.status).toBe(400);
    expect(await invalidMode.json()).toMatchObject({ detail: { code: "runtime_connector_scope_invalid_mode" } });

    const events = getConn().prepare(
      "SELECT actor,payload FROM audit_events WHERE event_type='runtime.connector_scope.updated' ORDER BY id",
    ).all() as Array<{ actor: string; payload: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("sriphy");
    expect(JSON.parse(events[0].payload)).toMatchObject({ connector_id: connectorId, mode: "selected", bindings: 1 });
  });

  it("enables a verified connector that only has a connector-level scope", async () => {
    const connectorId = seedConnector("scope_gate_connector");
    expect((await call("PUT", `/api/admin/runtime/connectors/${connectorId}/connector-scope`, { mode: "all" })).status).toBe(200);
    const enabled = await call("PATCH", `/api/admin/connectors/${connectorId}`, { enabled: true });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ id: connectorId, enabled: true });
  });

  it("enables a verified connector that only has a tool-level scope", async () => {
    const connectorId = seedConnector("scope_gate_tool");
    const nodeId = await addNodeThroughApi(connectorId, { name: "营销中心", level: 1 });
    setToolPolicy(connectorId, "pageKolProfiles", { enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64) }, 0);
    replaceToolScope(connectorId, "pageKolProfiles", [nodeId], ADMIN);
    expect(connectorScopeConfigured(connectorId)).toBe(false);
    const enabled = await call("PATCH", `/api/admin/connectors/${connectorId}`, { enabled: true });
    expect(enabled.status).toBe(200);
  });

  it("keeps the 409 gate for a verified connector without any scope", async () => {
    const connectorId = seedConnector("scope_gate_none");
    const response = await call("PATCH", `/api/admin/connectors/${connectorId}`, { enabled: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ detail: { code: "connector_tool_scope_required", connector_id: connectorId } });
  });

  it("reports catalog kind, protocol, icon, and approved tool count", async () => {
    seedConnector("scope_dto_mcp");
    seedConnector("scope_dto_http");
    setConnectorConfig("scope_dto_http", { protocol: "http", url: "https://api.example.com", allow_unauthenticated: true }, 0);
    setToolPolicy("scope_dto_mcp", "list_records", { enabled: true, risk: "L1", access: "read", schema_hash: "b".repeat(64) }, 0);
    getConn().prepare("UPDATE connectors SET icon_ref='stored-icon.png' WHERE id='scope_dto_mcp'").run();

    const rows = await (await call("GET", "/api/admin/connectors")).json() as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.starrykol).toMatchObject({ kind: "app", protocol: "mcp", icon_url: null });
    expect(byId.scope_dto_mcp).toMatchObject({
      kind: "custom_mcp",
      protocol: "mcp",
      icon_url: "/api/admin/connectors/scope_dto_mcp/icon",
      approved_tool_count: 1,
    });
    expect(byId.scope_dto_http).toMatchObject({ kind: "custom_api", protocol: "http", icon_url: null, approved_tool_count: 0 });
  });

  it("keeps the registry canonical id on a manually added unit node", () => {
    const connectorId = seedConnector("scope_registry_node");
    const snapshot = addOrganizationScopeNode(connectorId, {
      name: "品牌与用户增长中心",
      level: 1,
      external_id: "org:brand_user_growth_center",
    });
    const node = snapshot.nodes.find((row) => row.name === "品牌与用户增长中心");
    expect(node?.external_id).toBe("org:brand_user_growth_center");
    const manual = addOrganizationScopeNode(connectorId, { name: "临时部门", level: 1 }).nodes.find((row) => row.name === "临时部门");
    expect(String(manual?.external_id)).not.toContain("org:");
  });
});
