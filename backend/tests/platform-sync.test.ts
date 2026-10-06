import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { createCredential } from "../src/runtime/credentials.js";
import { assertRuntimeSkill, runtimeAgentCandidates, toolSchemaHash } from "../src/runtime/execution.js";
import { listManagedAgents } from "../src/runtime/managed-agents.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { runPlatformSkillTool } from "../src/runtime/platform-run.js";
import {
  ensureRuntimeSchema, getAgentSkills, getSkillTool, setConnectorConfig, setSkillConnector, setSkillTool, setToolPolicy,
} from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
const tool = { name: "listAllKolProfiles", description: "红人全量查询（字段白名单）", inputSchema: { type: "object", properties: {} } };
let calls = 0;
const fake = () => ({
  listTools: async () => [tool],
  callToolRaw: async () => { calls += 1; return { content: [{ type: "text", text: JSON.stringify({ list: [{ kolUid: "K1", kolName: "Alice" }] }) }] }; },
  close: async () => undefined,
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-platform-sync-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test", CODEX_MODE: "real",
    RUNTIME_CREDENTIAL_MASTER_KEY: process.env.RUNTIME_CREDENTIAL_MASTER_KEY || "a".repeat(64),
  });
  await freshTestDatabase();
  resetConn();
  ensureRuntimeSchema();
  calls = 0;
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "CODEX_MODE"]) delete process.env[key];
});

function mountLibraryTool(): void {
  getConn().prepare("UPDATE connectors SET enabled=1,status='verified' WHERE id='starrykol'").run();
  const credential = createCredential({ type: "organization_secret", label: "probe", purpose: "probe", secret: "k-123" }, "admin");
  setConnectorConfig("starrykol", { url: "https://starry.example.test/mcp", headers_secret_refs: { "X-MCP-API-KEY": credential.id } }, 0);
  setToolPolicy("starrykol", "listAllKolProfiles", { enabled: true, risk: "L1", access: "read", schema_hash: toolSchemaHash(tool) }, 0);
  setSkillConnector("creator_library_all", "starrykol", true, 0);
  setSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", true, 0);
}

describe("platform sync Agent", () => {
  it("ships a published, person-free platform Agent with the read-only library skill", () => {
    expect(listManagedAgents().find((agent) => agent.id === "agent:platform-sync")?.status).toBe("published");
    expect(getAgentSkills("agent:platform-sync").some((row) => row.skill_id === "creator_library_all" && Number(row.enabled) === 1)).toBe(true);
  });

  it("runs the library sync through the mounted skill chain and stops when the tool is unmounted", async () => {
    await expect(runPlatformSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", {}, fake)).rejects.toBeTruthy();
    expect(calls).toBe(0);
    mountLibraryTool();
    const result = await runPlatformSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", {}, fake);
    expect(JSON.stringify(result)).toContain("K1");
    expect(calls).toBe(1);
    const binding = getSkillTool("creator_library_all", "starrykol", "listAllKolProfiles")!;
    setSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", false, Number(binding.version));
    await expect(runPlatformSkillTool("creator_library_all", "starrykol", "listAllKolProfiles", {}, fake)).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });

  it("is never usable or bindable by people, and never offered as an employee choice", () => {
    expect(() => assertRuntimeSkill({ agentId: "agent:platform-sync", skillId: "creator_library_all", userId: "admin", runId: "x" })).toThrow();
    expect(() => createAgentBinding({
      agent_id: "agent:platform-sync", target_type: "organization_unit", target_id: "org:research_institute", company_id: "company:amperetime",
    })).toThrow();
    const admin = getConn().prepare("SELECT id FROM users WHERE roles LIKE '%admin%' AND active=1 LIMIT 1").get() as { id?: string } | undefined;
    if (admin?.id) expect(runtimeAgentCandidates("creator_library_all", admin.id)).not.toContain("agent:platform-sync");
  });
});
