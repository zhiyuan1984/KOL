import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { importOrganizationAccounts } from "../src/runtime/org-account-import.js";
import { effectiveAgentUsers, listOrganizationPeople, reseedOrganizationTreeFromRegistry } from "../src/runtime/organization-tree.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-org-account-import-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, NODE_ENV: "test" });
  resetConn();
  getConn().prepare(`INSERT INTO users
    (id,username,name,password_hash,roles,brands,active,email,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run("sriphy", "sriphy", "鄢棽", "existing-hash", '["employee","admin"]', "[]", 1,
      "sriphy.yan@amperetime.com", "now", "now");
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "NODE_ENV"]) delete process.env[key];
});

describe("organization person account import", () => {
  it("dry run leaves accounts untouched; apply links 20 people and preserves existing credentials", () => {
    expect(importOrganizationAccounts().filter((row) => row.action === "create")).toHaveLength(19);
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);

    const applied = importOrganizationAccounts(true);
    expect(applied.filter((row) => row.action === "create")).toHaveLength(19);
    expect(applied.filter((row) => row.action === "update")).toHaveLength(1);
    expect((getConn().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(20);
    expect(listOrganizationPeople().filter((row) => row.user_id)).toHaveLength(20);
    expect(getConn().prepare("SELECT password_hash,roles FROM users WHERE id='sriphy'").get()).toEqual({
      password_hash: "existing-hash", roles: '["employee","admin"]',
    });
    expect(getConn().prepare("SELECT username,site,position,active FROM users WHERE id='usr_org_ye_guanwang'").get())
      .toMatchObject({ username: "robertson.ye@amperetime.com", site: "org:lt_team", position: "联盟营销组长", active: 1 });
    expect(getConn().prepare("SELECT username,email,site,position,active,roles,brands FROM users WHERE id='usr_org_wang_xiang'").get())
      .toMatchObject({ username: "xiang.wang@amperetime.com", email: "xiang.wang@amperetime.com", site: "org:ai_product",
        position: "AI产品经理", active: 1, roles: '["employee"]', brands: "[]" });
    expect(listOrganizationPeople().find((row) => row.person_ref === "person:wang_xiang")).toMatchObject({
      user_id: "usr_org_wang_xiang", employee_no: "1083", avatar_url: "/avatars/employees/wang_xiang.png",
    });
    expect(effectiveAgentUsers("agent:kol").user_ids).not.toContain("usr_org_wang_xiang");

    expect(importOrganizationAccounts(true).filter((row) => row.action === "create")).toHaveLength(0);
    reseedOrganizationTreeFromRegistry();
    expect(listOrganizationPeople().filter((row) => row.user_id)).toHaveLength(20);
  });
});
