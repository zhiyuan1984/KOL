import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, nowIso, resetConn } from "../src/db.js";
import {
  parseDeclaredMcp,
  skillCoverage,
  skillImplementation,
  toolMountState,
  type DeclaredTool,
} from "../src/runtime/skill-coverage.js";
import { connectorInUseBySkill, ensureRuntimeSchema, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { SKILL_FIXTURES_ROOT, publishFixtureSkills } from "./helpers/skill-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";

const DECLARED: DeclaredTool = {
  connector_id: "starrykol",
  tool_name: "pageKolProfiles",
  declared_as: "starrykol.pageKolProfiles",
};
const HASH = "a".repeat(64);
let tmp = "";
let env: Record<string, string | undefined>;

function policy(connectorId: string, toolName: string, enabled: boolean, risk: "L1" | "L2" | "L3"): void {
  setToolPolicy(connectorId, toolName, { enabled, risk, access: risk === "L1" ? "read" : "write", schema_hash: HASH }, 0);
}

beforeEach(async () => {
  await freshTestDatabase();
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map((key) => [key, process.env[key]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "test.db"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
  });
  publishFixtureSkills(tmp, ["declared_fixture", "declared_defined_fixture"]);
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("parseDeclaredMcp", () => {
  it("splits connector-prefixed declarations and keeps the input order", () => {
    expect(parseDeclaredMcp(["starrykol.pageKolProfiles", "starry.get_collaboration"])).toEqual([
      { connector_id: "starrykol", tool_name: "pageKolProfiles", declared_as: "starrykol.pageKolProfiles" },
      { connector_id: "starry", tool_name: "get_collaboration", declared_as: "starry.get_collaboration" },
    ]);
  });
  it("tolerates declarations without a prefix instead of throwing", () => {
    expect(parseDeclaredMcp(["pageKolProfiles"])).toEqual([
      { connector_id: "", tool_name: "pageKolProfiles", declared_as: "pageKolProfiles" },
    ]);
  });
  it("trims padding, drops blank entries and de-duplicates by declared_as", () => {
    expect(parseDeclaredMcp(["", "   ", "\t", " starrykol.pageKolProfiles ", "starrykol.pageKolProfiles", "starrykol.getKolProfileDetail"]))
      .toEqual([
        { connector_id: "starrykol", tool_name: "pageKolProfiles", declared_as: "starrykol.pageKolProfiles" },
        { connector_id: "starrykol", tool_name: "getKolProfileDetail", declared_as: "starrykol.getKolProfileDetail" },
      ]);
    expect(parseDeclaredMcp(["starrykol."])).toEqual([]);
  });
});

describe("toolMountState", () => {
  it("judges mounted before the catalog, then policy registration, then policy enablement", () => {
    expect(toolMountState({ declared: DECLARED, bound: true, policyConnectorExists: true, policy: { enabled: 0 } }))
      .toBe("mounted");
    expect(toolMountState({ declared: DECLARED, bound: false, policyConnectorExists: false, policy: null }))
      .toBe("unknown_connector");
    expect(toolMountState({ declared: DECLARED, bound: false, policyConnectorExists: true, policy: null }))
      .toBe("unregistered");
    expect(toolMountState({ declared: DECLARED, bound: false, policyConnectorExists: true, policy: { enabled: 0, risk: "L3" } }))
      .toBe("blocked_by_policy");
    expect(toolMountState({ declared: DECLARED, bound: false, policyConnectorExists: true, policy: { enabled: 1, risk: "L1" } }))
      .toBe("available");
  });
});

describe("skillImplementation", () => {
  it("is live only with an Agent binding and the published stage", () => {
    expect(skillImplementation({ agentBound: true, stage: "published" })).toBe("live");
    expect(skillImplementation({ agentBound: true, stage: "testing" })).toBe("defined");
    expect(skillImplementation({ agentBound: false, stage: "published" })).toBe("defined");
    expect(skillImplementation({ agentBound: true, stage: null })).toBe("defined");
  });
});

describe("skillCoverage read model", () => {
  it("reads per-tool mount state from the connector catalog and the skill bindings", () => {
    policy("starrykol", "pageKolProfiles", true, "L1");
    policy("starrykol", "previewEmailDraft", true, "L2");
    policy("starrykol", "decryptKolContact", false, "L3");
    setSkillConnector("declared_fixture", "starrykol", true, 0);
    setSkillTool("declared_fixture", "starrykol", "pageKolProfiles", true, 0);

    const coverage = skillCoverage({ root: SKILL_FIXTURES_ROOT, connectorId: "starrykol" });
    expect(coverage.summary).toEqual({
      skills: 2,
      live: 0,
      defined: 2,
      declared_tools: 5,
      mounted_tools: 1,
      pending_tools: 4,
    });
    expect(coverage.connectors).toEqual([
      { id: "starrykol", label: "Starry KOL MCP", enabled: false, status: "draft", approved_tool_count: 2 },
    ]);

    const skill = coverage.skills.find((entry) => entry.skill_id === "declared_fixture");
    expect(skill?.tools.map((tool) => [tool.tool_name, tool.state])).toEqual([
      ["pageKolProfiles", "mounted"],
      ["previewEmailDraft", "available"],
      ["decryptKolContact", "blocked_by_policy"],
      ["pageMailboxes", "unregistered"],
    ]);
    const [mounted, available, blocked, unregistered] = skill!.tools;
    expect(mounted).toMatchObject({
      connector_label: "Starry KOL MCP",
      policy_risk: "L1",
      policy_enabled: true,
      connector_enabled: false,
      connector_status: "draft",
    });
    expect(available).toMatchObject({ state: "available", policy_risk: "L2", policy_enabled: true });
    expect(blocked).toMatchObject({ state: "blocked_by_policy", policy_risk: "L3", policy_enabled: false });
    expect(unregistered).toMatchObject({ state: "unregistered" });
    expect(unregistered).not.toHaveProperty("policy_risk");
    expect(unregistered).not.toHaveProperty("policy_enabled");
  });

  it("keeps a legacy connector out of the catalog list and marks its tools unknown", () => {
    const coverage = skillCoverage({ root: SKILL_FIXTURES_ROOT });
    const legacy = coverage.skills
      .flatMap((skill) => skill.tools)
      .find((tool) => tool.declared_as === "starry.get_collaboration");
    expect(legacy).toMatchObject({ connector_id: "starry", state: "unknown_connector" });
    expect(legacy).not.toHaveProperty("connector_label");
    expect(legacy).not.toHaveProperty("connector_status");
    expect(coverage.connectors.map((connector) => connector.id)).toEqual(["starrykol"]);
  });

  it("marks a skill live only with an enabled Agent binding plus a published stage and version", () => {
    const now = nowIso();
    // 运行目录表由 store 惰性建；直接写表前先显式建表。
    ensureRuntimeSchema();
    getConn().prepare("INSERT INTO skill_lifecycle (skill_id,stage,origin,updated_at) VALUES (?,?,?,?)")
      .run("declared_fixture", "published", "official", now);
    getConn().prepare("INSERT INTO runtime_agent_skills (agent_id,skill_id,enabled,version,updated_at) VALUES (?,?,?,?,?)")
      .run("agent:kol", "declared_fixture", 1, 1, now);
    getConn().prepare("INSERT INTO skill_versions (id,skill_id,version,status,published_at) VALUES (?,?,?,?,?)")
      .run("sv_fixture", "declared_fixture", 3, "published", now);

    const coverage = skillCoverage({ root: SKILL_FIXTURES_ROOT, connectorId: "starrykol" });
    expect(coverage.skills.find((entry) => entry.skill_id === "declared_fixture")).toMatchObject({
      stage: "published",
      published_version: 3,
      agents: ["agent:kol"],
      agent_bound: true,
      implementation: "live",
    });
    expect(coverage.skills.find((entry) => entry.skill_id === "declared_defined_fixture")).toMatchObject({
      stage: null,
      published_version: null,
      agents: [],
      agent_bound: false,
      implementation: "defined",
    });
    expect(coverage.summary.live).toBe(1);
    expect(coverage.summary.defined).toBe(1);
  });

  it("does not call a tool mounted while its connector binding is disabled", () => {
    policy("starrykol", "pageKolProfiles", true, "L1");
    setSkillConnector("declared_fixture", "starrykol", true, 0);
    setSkillTool("declared_fixture", "starrykol", "pageKolProfiles", true, 0);
    setSkillConnector("declared_fixture", "starrykol", false, 1);

    const coverage = skillCoverage({ root: SKILL_FIXTURES_ROOT, connectorId: "starrykol" });
    expect(coverage.skills.find((entry) => entry.skill_id === "declared_fixture")?.tools[0]).toMatchObject({
      tool_name: "pageKolProfiles",
      state: "available",
      policy_enabled: true,
    });
    expect(coverage.summary.mounted_tools).toBe(0);
    expect(connectorInUseBySkill("starrykol")).toBe(false);
  });
});
