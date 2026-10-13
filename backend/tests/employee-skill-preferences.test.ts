import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../src/postgres/pool.js", () => ({ postgresQuery: query }));
import { employeeSkillPreferences, recordEmployeeSkillView, setEmployeeSkillFavorite } from "../src/host/employee-skill-preferences.js";

beforeEach(() => { query.mockReset(); query.mockResolvedValue([]); });
describe("employee skill preferences", () => {
  it("queries only the authenticated owner's currently visible skills and actual started tasks", async () => {
    query.mockResolvedValue([{skill_id:"skill-a",favorite:true,viewed_at:null,use_count:"3",used_at:"2026-10-13"}]);
    const rows = await employeeSkillPreferences("alice",["skill-a"]);
    expect(query.mock.calls[0][1]).toEqual(["alice",["skill-a"]]);
    expect(query.mock.calls[0][0]).toContain("owner_user_id=$1");
    expect(query.mock.calls[0][0]).toContain("started_at IS NOT NULL");
    expect(query.mock.calls[0][0]).toContain("p.user_id=$1"); expect(rows[0].use_count).toBe(3);
  });
  it("does no preference read with an empty authorized projection", async () => {
    expect(await employeeSkillPreferences("alice",[])).toEqual([]); expect(query).not.toHaveBeenCalled();
  });
  it("favorites and views are distinct idempotent writes scoped by employee, without grants or fake usage", async () => {
    await setEmployeeSkillFavorite("alice","skill-a",true); await recordEmployeeSkillView("bob","skill-a");
    expect(query.mock.calls[0][1]).toEqual(["alice","skill-a",true]); expect(query.mock.calls[1][1]).toEqual(["bob","skill-a"]);
    expect(query.mock.calls.every(([sql]) => !/grants|runtime_agent_skills|use_count/.test(sql))).toBe(true);
  });
});
