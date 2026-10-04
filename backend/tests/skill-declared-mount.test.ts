import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authMiddleware } from "../src/auth.js";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
import type { Json } from "../src/types.js";
import { publishFixtureSkills } from "./helpers/skill-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
import { createCredential } from "../src/runtime/credentials.js";
import { getToolPolicy, setToolPolicy } from "../src/runtime/store.js";

const CONNECTOR = "starrykol";
const SKILL = "declared_fixture";
const DEFINED_SKILL = "declared_defined_fixture";
/** 探针目录：L1 读取、L2 预览，以及由管理员显式停用的两个 L3 工具。 */
const PROBE_TOOLS: Json[] = [
  { name: "pageKolProfiles", inputSchema: { type: "object" } },
  { name: "previewEmailDraft", inputSchema: { type: "object" } },
  { name: "decryptKolContact", inputSchema: { type: "object" } },
  { name: "sendEmailNow", inputSchema: { type: "object" } },
];
const UNKNOWN_POLICY = { tool_name: "pageMailboxes", reason: "policy_unregistered" };
const BLOCKED_POLICY = { tool_name: "decryptKolContact", reason: "policy_disabled" };
const UNKNOWN_CONNECTOR = { tool_name: "get_collaboration", reason: "unknown_connector" };

let tmp = "";
let app: Hono;
let adminCookie = "";
let previousMasterKey: string | undefined;
const numericEnabled = (row: any) => ({ ...row, enabled: Number(row?.enabled) });

type ApiResult = { status: number; body: Record<string, any> };

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

/** 探针是外部目录读取；用例只替换 inspector，其余路由与鉴权都是真实的。 */
function probeHost(): Hono {
  const host = new Hono();
  host.use("/api/*", authMiddleware);
  host.onError((error, c) => error instanceof HttpFail
    ? c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 500 | 502)
    : c.json({ detail: "unexpected" }, 500));
  host.route("/api", createConnectorOperationsRouter(async () => PROBE_TOOLS));
  return host;
}

async function probeConnector(): Promise<void> {
  const response = await probeHost().request(`/api/admin/runtime/connectors/${CONNECTOR}/probe`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  expect(response.status, await response.text()).toBe(200);
}

function coverageUrl(connectorId?: string): string {
  return `/api/admin/runtime/skills/coverage${connectorId ? `?connector_id=${connectorId}` : ""}`;
}

function mount(body?: unknown): Promise<ApiResult> {
  return call("POST", `/api/admin/runtime/connectors/${CONNECTOR}/mount-declared`, body);
}

async function coverageSkill(skillId: string, connectorId?: string): Promise<Record<string, any>> {
  const listed = await call("GET", coverageUrl(connectorId));
  expect(listed.status).toBe(200);
  const skill = (listed.body.skills as Record<string, any>[]).find((entry) => entry.skill_id === skillId);
  expect(skill, `${skillId} missing from coverage`).toBeTruthy();
  return skill!;
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skill-mount-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "real";
  process.env.AUTH_MODE = "enabled";
  process.env.NODE_ENV = "test";
  previousMasterKey = process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "34".repeat(32);
  // 夹具技能只能经数据目录下的 published-skills 进入 taskDefinitions。
  publishFixtureSkills(tmp, [SKILL, DEFINED_SKILL]);
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

  const credential = createCredential({ type: "organization_secret", secret: "mount-test-key" }, "admin");
  const config = await call("PUT", `/api/admin/runtime/connectors/${CONNECTOR}/config`, {
    url: "https://mcp.example.test/streamable",
    headers_secret_refs: { "X-MCP-API-KEY": credential.id },
    expected_version: 0,
  });
  expect(config.status, JSON.stringify(config.body)).toBe(200);
  await probeConnector();
  for (const name of ["decryptKolContact", "sendEmailNow"]) {
    const policy = getToolPolicy(CONNECTOR, name)!;
    expect(policy).toMatchObject({ risk: "L3", access: "write" });
    setToolPolicy(CONNECTOR, name, { enabled: false, risk: "L3", access: "write", schema_hash: String(policy.schema_hash) }, Number(policy.version));
  }

  // 夹具技能上线：Agent 绑定走真实路由，发布阶段直接写生命周期表（阶段流转自带前后置条件）。
  const bound = await call("PUT", `/api/admin/runtime/agents/agent:kol/skills/${SKILL}`, {
    enabled: true, expected_version: 0,
  });
  expect(bound.status, JSON.stringify(bound.body)).toBe(200);
  getConn().prepare("INSERT INTO skill_lifecycle (skill_id,stage,origin,updated_at) VALUES (?,?,?,?)")
    .run(SKILL, "published", "official", new Date().toISOString());
});

afterEach(() => {
  if (previousMasterKey === undefined) delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
  else process.env.RUNTIME_CREDENTIAL_MASTER_KEY = previousMasterKey;
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  process.env.CODEX_MODE = "stub";
});

describe("skill coverage over declared MCP tools", () => {
  it("reports probed tools as available, blocked by policy, unregistered, or unknown", async () => {
    const coverage = await call("GET", coverageUrl(CONNECTOR));
    expect(coverage.status, JSON.stringify(coverage.body)).toBe(200);
    expect(coverage.body.connectors).toEqual([
      { id: CONNECTOR, label: "Starry KOL MCP", enabled: false, status: "verified", approved_tool_count: 2 },
    ]);

    const skill = await coverageSkill(SKILL, CONNECTOR);
    expect(skill).toMatchObject({
      stage: "published",
      agents: ["agent:kol"],
      agent_bound: true,
      implementation: "live",
      declared_tools: 4,
      mounted_tools: 0,
      pending_tools: 4,
    });
    expect(skill.tools.map((tool: Record<string, unknown>) => [tool.tool_name, tool.state])).toEqual([
      ["pageKolProfiles", "available"],
      ["previewEmailDraft", "available"],
      ["decryptKolContact", "blocked_by_policy"],
      ["pageMailboxes", "unregistered"],
    ]);
    expect(skill.tools[0]).toMatchObject({ policy_risk: "L1", policy_enabled: true, connector_enabled: false });
    expect(skill.tools[2]).toMatchObject({ policy_risk: "L3", policy_enabled: false });
    expect(skill.tools[3]).not.toHaveProperty("policy_risk");

    // 遗留 starry 不在连接器目录里：工具标 unknown_connector，且不冒充一个连接器。
    const all = await call("GET", coverageUrl());
    const legacy = (all.body.skills as Record<string, any>[])
      .flatMap((entry) => entry.tools)
      .find((tool) => tool.declared_as === "starry.get_collaboration");
    expect(legacy).toMatchObject({ connector_id: "starry", state: "unknown_connector" });
    expect(legacy).not.toHaveProperty("connector_label");
    expect(all.body.connectors.map((connector: Record<string, unknown>) => connector.id)).not.toContain("starry");

    // 管理员显式禁用的 L3 目录行，覆盖率不得把它算作可挂载。
    const disabled = getConn().prepare(
      "SELECT risk,enabled FROM runtime_tool_policies WHERE connector_id=? AND tool_name='sendEmailNow'",
    ).get(CONNECTOR);
    expect(numericEnabled(disabled)).toMatchObject({ risk: "L3", enabled: 0 });
  });

  it("mounts declared tools, skips the rest, stays idempotent, then opens the enable gate", async () => {
    // 挂载前闸门仍关：没有启用的工具绑定就没有「在用」连接器。
    const gated = await call("PATCH", `/api/admin/connectors/${CONNECTOR}`, { enabled: true });
    expect(gated.status).toBe(409);
    expect(gated.body).toMatchObject({ detail: { code: "connector_skill_binding_required" } });

    const listed = await call("GET", coverageUrl(CONNECTOR));
    const target = (listed.body.skills as Record<string, any>[]).find((entry) => entry.skill_id === SKILL);
    expect(target?.implementation).toBe("live");

    const mounted = await mount({ skill_ids: [SKILL] });
    expect(mounted.status, JSON.stringify(mounted.body)).toBe(200);
    // 报告只覆盖目标连接器声明的工具；其它连接器（遗留 starry）的工具不属于这次挂载。
    expect(mounted.body).toEqual({
      connector_id: CONNECTOR,
      summary: { skills: 1, mounted_tools: 2, unchanged_tools: 0, skipped_tools: 2 },
      skills: [{
        skill_id: SKILL,
        connector_bound: true,
        connector_created: true,
        mounted: ["pageKolProfiles", "previewEmailDraft"],
        unchanged: [],
        skipped: [BLOCKED_POLICY, UNKNOWN_POLICY],
      }],
    });

    expect(numericEnabled(getConn().prepare(
      "SELECT enabled FROM runtime_skill_connectors WHERE skill_id=? AND connector_id=?",
    ).get(SKILL, CONNECTOR))).toMatchObject({ enabled: 1 });
    expect(getConn().prepare(
      "SELECT tool_name,enabled FROM runtime_skill_tools WHERE skill_id=? AND connector_id=? ORDER BY tool_name",
    ).all(SKILL, CONNECTOR).map(numericEnabled)).toEqual([
      { tool_name: "pageKolProfiles", enabled: 1 },
      { tool_name: "previewEmailDraft", enabled: 1 },
    ]);
    // 挂载不放行策略行，也不启用连接器本体。
    expect(numericEnabled(getConn().prepare(
      "SELECT enabled FROM runtime_tool_policies WHERE connector_id=? AND tool_name='decryptKolContact'",
    ).get(CONNECTOR))).toMatchObject({ enabled: 0 });
    expect(numericEnabled(getConn().prepare("SELECT enabled FROM connectors WHERE id=?").get(CONNECTOR))).toMatchObject({ enabled: 0 });

    const events = getConn().prepare(
      "SELECT event_type,payload FROM audit_events WHERE event_type='runtime.skill_mount.declared' ORDER BY id",
    ).all() as { payload: string }[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toEqual({
      connector_id: CONNECTOR,
      skill_id: SKILL,
      mounted: ["pageKolProfiles", "previewEmailDraft"],
      unchanged: [],
      skipped: [BLOCKED_POLICY, UNKNOWN_POLICY],
    });

    const again = await mount({ skill_ids: [SKILL] });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({
      summary: { skills: 1, mounted_tools: 0, unchanged_tools: 2, skipped_tools: 2 },
      skills: [{
        skill_id: SKILL,
        connector_bound: true,
        connector_created: false,
        mounted: [],
        unchanged: ["pageKolProfiles", "previewEmailDraft"],
      }],
    });

    const enabled = await call("PATCH", `/api/admin/connectors/${CONNECTOR}`, { enabled: true });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
    expect(enabled.body).toMatchObject({ id: CONNECTOR, enabled: true });
  });

  it("scans live skills only when skill_ids is omitted", async () => {
    const defined = await coverageSkill(DEFINED_SKILL, CONNECTOR);
    expect(defined).toMatchObject({ implementation: "defined", agent_bound: false, declared_tools: 1 });

    const scanned = await mount();
    expect(scanned.status, JSON.stringify(scanned.body)).toBe(200);
    const scannedIds = (scanned.body.skills as Record<string, any>[]).map((entry) => entry.skill_id);
    expect(scannedIds).toContain(SKILL);
    expect(scannedIds).not.toContain(DEFINED_SKILL);
    expect(scanned.body.summary.mounted_tools).toBeGreaterThan(0);

    const listed = await call("GET", coverageUrl());
    const implementation = new Map(
      (listed.body.skills as Record<string, any>[]).map((entry) => [entry.skill_id, entry.implementation]),
    );
    for (const skillId of scannedIds) expect(implementation.get(skillId)).toBe("live");
  });

  it("rejects unknown skills and unsupported fields before writing anything", async () => {
    const unknownBody = await mount({ skill_ids: [SKILL, "no_such_skill"] });
    expect(unknownBody.status).toBe(400);
    expect(unknownBody.body).toMatchObject({ detail: { code: "unknown_skill", skill_id: "no_such_skill" } });

    const extraField = await mount({ skill_ids: [SKILL], force: true });
    expect(extraField.status).toBe(400);
    expect(extraField.body).toMatchObject({ detail: "unsupported request field" });

    const malformed = await mount({ skill_ids: "declared_fixture" });
    expect(malformed.status).toBe(400);

    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM runtime_skill_connectors WHERE skill_id=?",
    ).get(SKILL) as { n: unknown }).n)).toBe(0);
  });

  it("skips every declared tool when the connector is absent from the catalog", async () => {
    const legacy = await call("POST", "/api/admin/runtime/connectors/starry/mount-declared", { skill_ids: [SKILL] });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(legacy.body).toEqual({
      connector_id: "starry",
      summary: { skills: 1, mounted_tools: 0, unchanged_tools: 0, skipped_tools: 1 },
      skills: [{
        skill_id: SKILL,
        connector_bound: false,
        connector_created: false,
        mounted: [],
        unchanged: [],
        skipped: [UNKNOWN_CONNECTOR],
      }],
    });
    expect(Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM runtime_skill_connectors WHERE connector_id='starry'",
    ).get() as { n: unknown }).n)).toBe(0);
  });
});
