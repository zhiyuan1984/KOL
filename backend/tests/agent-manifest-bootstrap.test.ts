import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { writeRuntimeSkill } from "../src/host/skill-sop.js";
import { getAgentSkills, getSkillConnectors, setAgentSkill } from "../src/runtime/store.js";

let tmp = "";
let previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  previousEnv = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map((key) => [key, process.env[key]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-agent-manifest-bootstrap-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "runtime.sqlite"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "enabled",
    NODE_ENV: "test",
  });
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe("Agent manifest runtime bootstrap", () => {
  it("initializes KOL Agent Skills from agents/kol, never from the KOL Expert, and leaves connector/tool approval explicit", () => {
    const kolSkills = getAgentSkills("agent:kol").filter((row) => row.enabled).map((row) => row.skill_id);
    expect(kolSkills).toEqual(expect.arrayContaining([
      "creator_discovery", "creator_profile", "creator_outreach", "email_compose", "reply_analysis", "stage_sop",
    ]));
    expect(kolSkills).not.toContain("today_plan");
    expect(getAgentSkills("agent:workspace-planner").filter((row) => row.enabled).map((row) => row.skill_id))
      .toEqual(expect.arrayContaining(["today_plan", "todo_plan", "today_analyze"]));

    // Connector declarations describe intended compatible resources only.
    // Nothing is silently authorized before connector and tool review in Admin.
    expect(getSkillConnectors("creator_profile")).toEqual([]);
    const audit = getConn().prepare(
      "SELECT payload FROM audit_events WHERE event_type='runtime.agent_manifest.migrated'",
    ).get() as { payload: string };
    expect(JSON.parse(audit.payload)).toMatchObject({ agent_id: "agent:kol", connectors: ["starrykol", "claw", "kolclaw"] });
    const runtimeSkill = fs.readFileSync(writeRuntimeSkill("creator_profile"), "utf8");
    expect(runtimeSkill).toContain("Only the local `skill_runtime` MCP server is available");
    expect(runtimeSkill).toContain("rt_starrykol__pageKolProfiles_");
  });

  it("never revives an administrator-disabled Agent binding after a restart", () => {
    const current = getAgentSkills("agent:kol").find((row) => row.skill_id === "creator_profile")!;
    setAgentSkill("agent:kol", "creator_profile", false, Number(current.version));
    resetConn();
    expect(getAgentSkills("agent:kol").find((row) => row.skill_id === "creator_profile"))
      .toMatchObject({ enabled: 0, version: 2 });
  });
});
