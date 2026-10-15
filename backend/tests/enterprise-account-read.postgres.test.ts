import { beforeEach, describe, expect, it, vi } from "vitest";
import * as legacyDb from "../src/db.js";
import { postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";
import { pgEnterpriseAccount, pgEnterpriseAccounts, pgEnterpriseEmployeeContext } from "../src/postgres/enterprise-account-read-repository.js";

const stamp = "2026-10-14T00:00:00.000Z";

beforeEach(async () => {
  vi.restoreAllMocks();
  const database = await freshTestDatabase();
  // Fixtures must never be inserted into the production DB.
  if (!database.startsWith(`${process.env.TEST_DB_PREFIX || "lingong_t"}_`)) throw new Error("not an isolated test database");
  const pool = postgresPool();
  await pool.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,active,created_at,updated_at)
    VALUES('read-alice','alice','Alice','password-must-not-leak','["employee"]','["LT"]',1,$1,$1),
      ('read-bob','bob','Bob','bob-password-must-not-leak','["employee"]','[]',0,$1,$1)`, [stamp]);
  await pool.query(`INSERT INTO organization_people(person_ref,user_id,display_name,email,employee_no,created_at,updated_at)
    VALUES('read-person','read-alice','Alice','alice@example.com','EMP-1',$1,$1)`, [stamp]);
  await pool.query(`INSERT INTO organization_units(id,company_id,display_name,type,level,created_at,updated_at)
    VALUES('read-unit','read-company','Read Team','department',1,$1,$1)`, [stamp]);
  await pool.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at)
    VALUES('read-member','read-person','read-company','read-unit','primary','active',$1,$1)`, [stamp]);
  await pool.query(`INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,created_at)
    VALUES('read-alice','lead','position',$1)`, [stamp]);
  await pool.query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,mailbox_id,owner_name,bearer_token,is_default,status,updated_at)
    VALUES('read-alice','alice@example.com','mail-1','Alice','bearer-must-not-leak',1,'connected',$1),
      ('read-bob','bob@example.com','mail-2','Bob','bob-bearer-must-not-leak',1,'connected',$1)`, [stamp]);
  await pool.query(`INSERT INTO kol_follow_index(id,company_id,kol_uid,scope_brand,employee_id,status,claimed_at,created_at,updated_at)
    VALUES('read-follow','read-company','read-kol','LT','read-alice','active',$1,$1,$1),
      ('read-follow-ended','read-company','read-kol-ended','LT','read-alice','released',$1,$1,$1),
      ('read-follow-bob','read-company','bob-kol','LT','read-bob','active',$1,$1,$1)`, [stamp]);
});

describe("native enterprise account read repository", () => {
  it("reads normalized account/organization/count summaries without the synchronous bridge", async () => {
    const bridge = vi.spyOn(legacyDb, "getConn").mockImplementation(() => { throw new Error("legacy bridge forbidden"); });
    try {
      const account = await pgEnterpriseAccount("read-alice");
      expect(account).toMatchObject({ id: "read-alice", active: true, status: "active", roles: ["employee"], brands: ["LT"],
        person_ref: "read-person", email: "alice@example.com", employee_no: "EMP-1", primary_org_unit_id: "read-unit",
        org_unit_ids: ["read-unit"], mailbox_count: 1, kol_count: 1,
        approval_roles: [{ role: "lead", kind: "position", valid_from: null, valid_to: null }] });
      expect(bridge).not.toHaveBeenCalled();
    } finally { bridge.mockRestore(); }
  });

  it("keeps directory and single-account projections identical", async () => {
    const rows = await pgEnterpriseAccounts();
    const alice = rows.find((row) => row.id === "read-alice");
    expect(alice).toEqual(await pgEnterpriseAccount("read-alice"));
    expect(rows.find((row) => row.id === "read-bob")).toMatchObject({ active: false, status: "disabled", org_unit_ids: [], primary_org_unit_id: null });
    expect(JSON.stringify(rows)).not.toContain("password-must-not-leak");
    for (const row of rows) expect(row).not.toHaveProperty("password_hash");
  });

  it("returns only the requested employee's mailbox and active KOL metadata", async () => {
    const result = await pgEnterpriseEmployeeContext("read-alice");
    expect(result.mailboxes).toEqual([expect.objectContaining({ mailbox_email: "alice@example.com", is_default: true })]);
    expect(result.kols).toEqual([expect.objectContaining({ kol_uid: "read-kol", display_name: "read-kol" })]);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/bearer-must-not-leak|password-must-not-leak|bob@example.com|bob-kol|read-kol-ended/);
    expect(result.mailboxes).not.toHaveProperty("0.bearer_token");
    expect(result.mailboxes).not.toHaveProperty("0.credential_ref");
  });

  it("returns 404 rather than another account or an empty context for missing users", async () => {
    await expect(pgEnterpriseAccount("missing-user")).rejects.toMatchObject({ status: 404 });
    await expect(pgEnterpriseEmployeeContext("missing-user")).rejects.toMatchObject({ status: 404 });
  });

  it("sees role revocation on the next request without cached permission data", async () => {
    expect((await pgEnterpriseAccount("read-alice")).approval_roles).toHaveLength(1);
    await postgresPool().query("DELETE FROM approval_role_bindings WHERE user_id=$1", ["read-alice"]);
    expect((await pgEnterpriseAccount("read-alice")).approval_roles).toEqual([]);
  });

  it("fails closed if the native database read fails rather than calling a fallback", async () => {
    const bridge = vi.spyOn(legacyDb, "getConn").mockImplementation(() => { throw new Error("legacy bridge forbidden"); });
    await postgresPool().query("ALTER TABLE organization_people RENAME TO missing_org_people");
    try {
      await expect(pgEnterpriseAccounts()).rejects.toMatchObject({ code: "42P01" });
      expect(bridge).not.toHaveBeenCalled();
    } finally { bridge.mockRestore(); }
  });
});
