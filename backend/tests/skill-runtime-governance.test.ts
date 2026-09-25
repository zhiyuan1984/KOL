import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { authMiddleware, authRouter, hashPassword } from "../src/auth.js";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { getToolPolicy } from "../src/runtime/store.js";
import { skillRuntimeRouter } from "../src/routers/skill-runtime.js";
import { runtimeDiscoveryRouter } from "../src/routers/runtime-discovery.js";

let tmp = "";
let app: Hono;
let adminCookie = "";
let employeeCookie = "";

function testApp(): Hono {
  const runtime = new Hono();
  runtime.use("/api/*", authMiddleware);
  runtime.onError((error, c) => {
    if (error instanceof HttpFail) {
      return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 500);
    }
    throw error;
  });
  runtime.route("/api", authRouter);
  runtime.route("/api", skillRuntimeRouter);
  runtime.route("/api", runtimeDiscoveryRouter);
  return runtime;
}

async function request(method: string, url: string, body?: unknown, cookie = adminCookie) {
  const response = await app.request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, unknown> : {},
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

const validConfig = {
  url: "https://mcp.example.test/streamable",
  headers_env: { "X-MCP-API-KEY": "TEST_MCP_API_KEY" },
  timeout_ms: 15_000,
};
const hash = "a".repeat(64);

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-runtime-governance-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  process.env.NODE_ENV = "test";
  resetConn();
  app = testApp();

  const setup = await request("POST", "/api/auth/setup", {
    username: "runtime-admin",
    name: "Runtime Admin",
    password: "admin-password",
    brands: ["LT"],
  }, "");
  expect(setup.status, JSON.stringify(setup.body)).toBe(201);
  adminCookie = setup.cookie;

  const now = new Date().toISOString();
  const employeePassword = await hashPassword("employee-password");
  getConn().prepare(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "usr_runtime_employee",
    "runtime-employee",
    "Runtime Employee",
    employeePassword,
    JSON.stringify(["employee"]),
    JSON.stringify(["LT"]),
    "",
    1,
    now,
    now,
  );
  getConn().prepare(
    "INSERT INTO connectors (id,label,enabled,status,credential_ref,updated_at) VALUES (?,?,?,?,?,?)",
  ).run("runtime_mcp", "Runtime MCP", 1, "configured", null, now);

  const login = await request("POST", "/api/auth/login", {
    username: "runtime-employee",
    password: "employee-password",
  }, "");
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  employeeCookie = login.cookie;
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  delete process.env.NODE_ENV;
  process.env.CODEX_MODE = "stub";
});

describe("skill runtime governance", () => {
  it("lets an authenticated admin configure versioned bindings, reference-only config, and policies", async () => {
    const binding = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: true,
      expected_version: 0,
    });
    expect(binding.status, JSON.stringify(binding.body)).toBe(200);
    expect(binding.body).toMatchObject({ agent_id: "agent:creator", skill_id: "creator_profile", enabled: 1, version: 1 });

    const listedBindings = await request("GET", "/api/admin/runtime/agents/agent:creator/skills");
    expect(listedBindings.status).toBe(200);
    expect(listedBindings.body).toEqual([expect.objectContaining({ skill_id: "creator_profile", enabled: 1, version: 1 })]);

    const linked = await request("PUT", "/api/admin/runtime/skills/creator_profile/connectors/runtime_mcp", {
      enabled: true,
      expected_version: 0,
    });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ skill_id: "creator_profile", connector_id: "runtime_mcp", enabled: 1, version: 1 });

    const config = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      ...validConfig,
      expected_version: 0,
    });
    expect(config.status).toBe(200);
    expect(config.body).toEqual({ config: validConfig, version: 1 });
    expect(JSON.stringify(config.body)).not.toContain("raw-secret");
    expect(JSON.stringify(config.body)).not.toContain("config_json");

    const fetchedConfig = await request("GET", "/api/admin/runtime/connectors/runtime_mcp/config");
    expect(fetchedConfig.status).toBe(200);
    expect(fetchedConfig.body).toEqual({ config: validConfig, version: 1 });

    const policy = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/tools/newly_discovered_tool", {
      enabled: true,
      risk: "L1",
      access: "read",
      schema_hash: hash,
      expected_version: 0,
    });
    expect(policy.status).toBe(200);
    expect(policy.body).toMatchObject({ tool_name: "newly_discovered_tool", enabled: 1, risk: "L1", access: "read", schema_hash: hash, version: 1 });

    const events = getConn().prepare(
      "SELECT event_type,payload FROM audit_events WHERE event_type LIKE 'runtime.%' ORDER BY id",
    ).all() as { event_type: string; payload: string }[];
    expect(events.map((event) => event.event_type)).toEqual([
      "runtime.binding.updated",
      "runtime.binding.updated",
      "runtime.config.updated",
      "runtime.tool_policy.updated",
    ]);
    expect(events.map((event) => event.payload).join("\n")).not.toContain("TEST_MCP_API_KEY");
    expect(events.map((event) => event.payload).join("\n")).not.toContain("mcp.example.test");
  });

  it("rejects an actual authenticated employee", async () => {
    const read = await request("GET", "/api/admin/runtime/agents/agent:creator/skills", undefined, employeeCookie);
    expect(read.status).toBe(403);
    const mutation = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: true,
      expected_version: 0,
    }, employeeCookie);
    expect(mutation.status).toBe(403);
  });

  it("preserves disabled tombstones and rejects stale versions without changing the row", async () => {
    const created = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: true,
      expected_version: 0,
    });
    expect(created.body.version).toBe(1);

    const duplicateCreate = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: true, expected_version: 0,
    });
    expect(duplicateCreate.status).toBe(409);

    const disabled = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: false,
      expected_version: 1,
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ enabled: 0, version: 2 });

    const stale = await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", {
      enabled: true,
      expected_version: 0,
    });
    expect(stale.status).toBe(409);

    const listed = await request("GET", "/api/admin/runtime/agents/agent:creator/skills");
    expect(listed.body).toEqual([expect.objectContaining({ enabled: 0, version: 2 })]);
  });

  it("describes only current authorized skills and never exposes resource secrets or claims LIVE", async () => {
    await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", { enabled: true, expected_version: 0 });
    await request("PUT", "/api/admin/runtime/skills/creator_profile/connectors/runtime_mcp", { enabled: true, expected_version: 0 });
    await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", { ...validConfig, expected_version: 0 });
    expect((await request("GET", "/api/agents/agent:creator/capabilities", undefined, employeeCookie)).body.capabilities).toEqual([]);
    getConn().prepare("INSERT INTO user_skill_grants(user_id,skill_id,created_at) VALUES(?,?,?)")
      .run("usr_runtime_employee", "creator_profile", "now");
    let result = await request("GET", "/api/agents/agent:creator/capabilities", undefined, employeeCookie);
    expect(result.body.capabilities).toEqual([expect.objectContaining({ skill_id: "creator_profile", unavailable_resources: 1, live_verified: false })]);
    getConn().prepare("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES(?,?,?,?)")
      .run("usr_runtime_employee", "runtime_mcp", "read", "now");
    result = await request("GET", "/api/agents/agent:creator/capabilities", undefined, employeeCookie);
    expect(result.body.capabilities).toEqual([expect.objectContaining({ configured_resources: 1, unavailable_resources: 0, live_verified: false })]);
    expect(JSON.stringify(result.body)).not.toMatch(/TEST_MCP_API_KEY|mcp.example.test|credential|headers_env/);
    await request("PUT", "/api/admin/runtime/agents/agent:creator/skills/creator_profile", { enabled: false, expected_version: 1 });
    expect((await request("GET", "/api/agents/agent:creator/capabilities", undefined, employeeCookie)).body.capabilities).toEqual([]);
  });

  it("rejects raw secrets, malformed endpoints, unknown fields, and malformed tool schema hashes", async () => {
    const badUrl = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      ...validConfig,
      url: "https://user:pass@mcp.example.test/x",
      expected_version: 0,
    });
    expect(badUrl.status).toBe(400);

    const queryUrl = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      ...validConfig,
      url: "https://mcp.example.test/x?token=nope",
      expected_version: 0,
    });
    expect(queryUrl.status).toBe(400);

    const rawSecret = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      url: "https://mcp.example.test/x",
      headers: { Authorization: "Bearer raw-secret" },
      expected_version: 0,
    });
    expect(rawSecret.status).toBe(400);

    const unregisteredProvider = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      url_env: "RUNTIME_MCP_URL",
      credential_provider: "vault-direct",
      expected_version: 0,
    });
    expect(unregisteredProvider.status).toBe(400);

    const badHash = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/tools/new_tool", {
      enabled: true,
      risk: "L1",
      access: "read",
      schema_hash: "deadbeef",
      expected_version: 0,
    });
    expect(badHash.status).toBe(400);
  });

  it("defaults unknown discovered tools to deny, records L3 only as policy metadata, and cascades connector deletion", async () => {
    expect(getToolPolicy("runtime_mcp", "newly_discovered_tool")).toBeUndefined();

    const l3 = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/tools/side_effect", {
      enabled: true,
      risk: "L3",
      access: "write",
      schema_hash: hash,
      expected_version: 0,
    });
    expect(l3.status).toBe(200);
    // This router has no execution endpoint: L3 registration remains metadata;
    // the parent-owned Gateway is the only formal action path.
    expect(getToolPolicy("runtime_mcp", "side_effect")).toMatchObject({ enabled: 1, risk: "L3", access: "write" });

    const config = await request("PUT", "/api/admin/runtime/connectors/runtime_mcp/config", {
      ...validConfig,
      expected_version: 0,
    });
    expect(config.status).toBe(200);
    const linked = await request("PUT", "/api/admin/runtime/skills/creator_profile/connectors/runtime_mcp", {
      enabled: true,
      expected_version: 0,
    });
    expect(linked.status).toBe(200);

    getConn().prepare("DELETE FROM connectors WHERE id=?").run("runtime_mcp");
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM runtime_skill_connectors WHERE connector_id=?").get("runtime_mcp")).toMatchObject({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM runtime_connector_config WHERE connector_id=?").get("runtime_mcp")).toMatchObject({ n: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS n FROM runtime_tool_policies WHERE connector_id=?").get("runtime_mcp")).toMatchObject({ n: 0 });
  });
});
