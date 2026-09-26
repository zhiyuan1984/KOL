import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  addOrganizationScopeNode,
  connectorHasOrganizationScopes,
  replaceToolScope,
  userHasToolScope,
} from "../src/runtime/organization.js";

let tmp = "";
let previous: Record<string, string | undefined> = {};

beforeEach(() => {
  previous = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map((key) => [key, process.env[key]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "organization-scope-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

describe("department and position tool scope", () => {
  it("authorizes a position through its selected department ancestry", () => {
    const db = getConn();
    const admin = { id: "usr_position_scope" };
    db.prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,position,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      admin.id, "position.scope", "岗位测试", "test", '["employee"]', "[]", "", "KOL 经理", 1, "now", "now",
    );
    const department = addOrganizationScopeNode("starrykol", { name: "营销中心", level: 1 }).nodes.find((node) => node.name === "营销中心")!;
    const team = addOrganizationScopeNode("starrykol", { name: "达人合作部", level: 2, parent_id: department.id }).nodes.find((node) => node.name === "达人合作部")!;
    const position = addOrganizationScopeNode("starrykol", { name: "KOL 经理", level: 3, parent_id: team.id }).nodes.find((node) => node.name === "KOL 经理")!;

    expect(connectorHasOrganizationScopes("starrykol")).toBe(false);
    replaceToolScope("starrykol", "pageKolProfiles", [department.id], admin.id);
    expect(connectorHasOrganizationScopes("starrykol")).toBe(true);
    expect(userHasToolScope("starrykol", "pageKolProfiles", admin.id)).toBe(true);
    expect(userHasToolScope("starrykol", "pageKolProfiles", "unknown")).toBe(false);
    expect(position.parent_id).toBe(team.id);
  });
});
