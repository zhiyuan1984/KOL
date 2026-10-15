import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  listCapabilities,
  registerCapability,
  updateCapability,
} from "../src/capability/registry.js";

beforeEach(async () => {
  await resetConn();
});

afterEach(async () => {
  await resetConn();
});

describe("capabilities native PostgreSQL migration", () => {
  it("parameterizes kind/status/q filters", async () => {
    const created = await registerCapability({
      kind: "skill",
      ref_id: "native-filter-target",
      notes: "Needle Native",
      capability: {},
    }, "test-native");
    const rows = await listCapabilities({ kind: "skill", status: "active", q: "needle" });
    expect(rows.some((row) => String(row.id) === String(created.id))).toBe(true);
    expect(await listCapabilities({ q: "' OR 1=1 --" })).toEqual([]);
  });

  it("rolls back capability update when its audit insert fails", async () => {
    const created = await registerCapability({
      kind: "skill",
      ref_id: "native-audit-rollback",
      notes: "before",
      capability: {},
    }, "test-native");
    const db = getConn();
    await db.query(`
      CREATE OR REPLACE FUNCTION capability_test_audit_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced capability audit failure'; END; $$;
    `);
    await db.query(`
      CREATE TRIGGER capability_test_audit_failure_trigger
      BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION capability_test_audit_failure();
    `);
    try {
      await expect(updateCapability(String(created.id), { notes: "must-not-commit" }, "test-native"))
        .rejects.toThrow("forced capability audit failure");
    } finally {
      await db.query("DROP TRIGGER IF EXISTS capability_test_audit_failure_trigger ON audit_events");
      await db.query("DROP FUNCTION IF EXISTS capability_test_audit_failure()");
    }
    const unchanged = (await db.query("SELECT notes FROM capability_registry WHERE id=$1", [String(created.id)])).rows[0];
    expect(String(unchanged.notes)).toBe("before");
  });
});
