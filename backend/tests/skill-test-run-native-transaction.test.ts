import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { clearTaskRegistryCache } from "../src/tasks/registry.js";
import { skillCatalog } from "../src/host/skills-catalog.js";
import { createSkillTest, deleteSkillTest, recordSkillTestRun } from "../src/host/skill-lifecycle.js";
let skillId: string;
let testId: string;
beforeEach(async () => {
  await freshTestDatabase();
  process.env.AUTH_MODE = "disabled";
  clearTaskRegistryCache();
  const registered = await skillCatalog();
  if (!registered.length) throw new Error("A real registered packaged skill is required for this fixture");
  skillId = registered[0].id;
  testId = String((await createSkillTest(skillId, { name: "owned isolated fixture", input: "no remote action", expected: "stored verdict" })).id);
});
afterEach(async () => { await resetConn(); });
const runs = async () => (await getConn().query("SELECT * FROM skill_test_runs WHERE skill_id=$1", [skillId])).rows;
const audits = async () => (await getConn().query("SELECT * FROM audit_events WHERE event_type='skill.test.run'", [])).rows;

describe("native skill test result and audit transaction", () => {
  it("records the real supplied verdict and its audit after the commit", async () => {
    expect(await recordSkillTestRun(skillId, [{ test_id: testId, passed: false, fail_reason: "operator rejected" }], 2))
      .toEqual({ total: 1, passed: 0, failed: 1 });
    expect(await runs()).toHaveLength(1);
    expect((await runs())[0]).toMatchObject({ test_id: testId, version: 2, passed: 0, fail_reason: "operator rejected" });
    expect(await audits()).toHaveLength(1);
  });
  it("rolls back earlier results if a later test does not exist", async () => {
    await expect(recordSkillTestRun(skillId, [{ test_id: testId, passed: true }, { test_id: "missing-owned-test", passed: true }]))
      .rejects.toMatchObject({ status: 404 });
    expect(await runs()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
  it("rolls back all result facts when the audit insert fails", async () => {
    const db = getConn();
    await db.query(`CREATE FUNCTION reject_owned_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_type='skill.test.run' THEN RAISE EXCEPTION 'injected owned audit failure'; END IF;
      RETURN NEW; END $$`);
    await db.query("CREATE TRIGGER reject_owned_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_owned_test_audit()");
    await expect(recordSkillTestRun(skillId, [{ test_id: testId, passed: true }])).rejects.toThrow("injected owned audit failure");
    expect(await runs()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
  it("awaits the skill existence check before producing any test run", async () => {
    await expect(recordSkillTestRun("unregistered-no-such-skill", [{ test_id: testId, passed: true }])).rejects.toMatchObject({ status: 404 });
    expect(await runs()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
  it("does not delete a run belonging to a different skill", async () => {
    const other = (await skillCatalog()).find(entry => entry.id !== skillId);
    if (!other) throw new Error("Two real registered skills are required for the scope fixture");
    await getConn().query("INSERT INTO skill_test_runs (id,skill_id,test_id,test_name,passed,ran_at) VALUES ($1,$2,$3,$4,$5,$6)",
      ["other-skill-run", other.id, testId, "different owned scope", 1, nowIso()]);
    await deleteSkillTest(skillId, testId);
    expect((await getConn().query("SELECT id FROM skill_tests WHERE id=$1", [testId])).rows).toEqual([]);
    expect((await getConn().query("SELECT id FROM skill_test_runs WHERE id=$1", ["other-skill-run"])).rows).toHaveLength(1);
    expect((await getConn().query("SELECT id FROM audit_events WHERE event_type='skill.test.delete'", [])).rows).toHaveLength(1);
  });
});
