import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { resolveLeadBrand } from "../src/ticket-domain/kol-leads.js";
import { isGroupLeader, leaderMemberUserIds, poolViewerBrands } from "../src/host/inbound-scope.js";
import { ensureOrganizationTree, leaderScopeForUser } from "../src/runtime/organization-tree.js";
import type { AppUser } from "../src/auth.js";

let tmp = "";

function user(id: string, overrides: Partial<AppUser> = {}): AppUser {
  return {
    id,
    username: id,
    name: id,
    handle: id,
    roles: ["employee"],
    role: "employee",
    brands: [],
    site: "test",
    manager_user_id: null,
    active: true,
    ...overrides,
  } as AppUser;
}

function insertUser(id: string, name: string, brands: string[] = []) {
  getConn().prepare(
    "INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'now','now')",
  ).run(id, id, name, "x", JSON.stringify(["employee"]), JSON.stringify(brands));
  const personRef = `person:${id}`;
  getConn().prepare(
    "INSERT INTO organization_people (person_ref,display_name,user_id,status,created_at,updated_at) VALUES (?,?,?,'active','now','now')",
  ).run(personRef, name, id);
  return personRef;
}

function insertUnit(id: string, displayName: string, level: number, parentId: string | null, headPersonRef: string | null) {
  getConn().prepare(
    `INSERT INTO organization_units
       (id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'active','now','now')`,
  ).run(id, "company:amperetime", displayName, "department", parentId, level, headPersonRef, headPersonRef);
}

function addMember(personRef: string, unitId: string) {
  getConn().prepare(
    `INSERT INTO organization_memberships
       (id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at)
     VALUES (?,?,?,?, 'primary','active','now','now')`,
  ).run(`m:${personRef}:${unitId}`, personRef, "company:amperetime", unitId);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-pool-brand-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "db.sqlite"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
  });
  resetConn();
  getConn();
  ensureOrganizationTree();
  // 四级组织：一级中心 → 二级推广部 → 三级LT组 → 四级投放小组
  const zhang = insertUser("u_zhang", "张慧玲");
  const zhong = insertUser("u_zhong", "钟剑奎");
  const ye = insertUser("u_ye", "叶观旺", ["LT"]);
  const a = insertUser("u_a", "成员A", ["LT"]);
  const b = insertUser("u_b", "成员B", ["LT"]);
  insertUnit("org:l1", "品牌与用户增长中心", 1, null, zhang);
  insertUnit("org:l2", "推广部", 2, "org:l1", zhong);
  insertUnit("org:l3", "LT组", 3, "org:l2", ye);
  insertUnit("org:l4", "投放小组", 4, "org:l3", null);
  addMember(zhang, "org:l1");
  addMember(zhong, "org:l2");
  addMember(ye, "org:l3");
  addMember(a, "org:l3");
  addMember(b, "org:l4");
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"]) delete process.env[key];
});

describe("resolveLeadBrand", () => {
  it("prefers the explicit brand (normalized to upper code)", () => {
    expect(resolveLeadBrand("lt", ["PQ"])).toBe("LT");
    expect(resolveLeadBrand("  pq ", null)).toBe("PQ");
  });

  it("falls back to the actor's single brand", () => {
    expect(resolveLeadBrand(undefined, ["lt"])).toBe("LT");
    expect(resolveLeadBrand("", ["RO"])).toBe("RO");
  });

  it("leaves brand empty for multi-brand / all-brand / brand-less actors (no lock)", () => {
    expect(resolveLeadBrand(undefined, ["LT", "PQ"])).toBe("");
    expect(resolveLeadBrand(undefined, null)).toBe("");
    expect(resolveLeadBrand(undefined, [])).toBe("");
    expect(resolveLeadBrand(null, undefined)).toBe("");
  });
});

describe("leaderScopeForUser（department_head 即组长，不限层级）", () => {
  it("recognizes unit heads at any level as 组长", () => {
    expect(leaderScopeForUser("u_ye").isLeader).toBe(true); // 三级 LT组组长
    expect(leaderScopeForUser("u_zhong").isLeader).toBe(true); // 二级 推广部组长
    expect(leaderScopeForUser("u_zhang").isLeader).toBe(true); // 一级 中心组长
    expect(leaderScopeForUser("u_a").isLeader).toBe(false); // 普通成员
    expect(leaderScopeForUser("nope").isLeader).toBe(false);
  });

  it("scopes a leader to their unit plus all descendant units", () => {
    const ye = leaderScopeForUser("u_ye");
    expect(new Set(ye.unitIds)).toEqual(new Set(["org:l3", "org:l4"]));
    expect(new Set(ye.memberUserIds)).toEqual(new Set(["u_ye", "u_a", "u_b"]));
  });

  it("gives superiors a strictly larger scope（组长的上级权限更多）", () => {
    const ye = new Set(leaderScopeForUser("u_ye").memberUserIds);
    const zhong = new Set(leaderScopeForUser("u_zhong").memberUserIds);
    const zhang = new Set(leaderScopeForUser("u_zhang").memberUserIds);
    for (const id of ye) expect(zhong.has(id)).toBe(true);
    expect(zhong.has("u_zhong")).toBe(true);
    for (const id of zhong) expect(zhang.has(id)).toBe(true);
    expect(zhang.has("u_zhang")).toBe(true);
    expect(zhang.size).toBeGreaterThan(zhong.size);
    expect(zhong.size).toBeGreaterThan(ye.size);
  });
});

describe("isGroupLeader / poolViewerBrands", () => {
  it("treats admins and any-level heads as leaders (pool: no brand filter)", () => {
    expect(isGroupLeader(user("u_ye", { name: "叶观旺" }))).toBe(true);
    expect(isGroupLeader(user("u_zhong", { name: "钟剑奎" }))).toBe(true);
    expect(isGroupLeader(user("u_admin", { roles: ["employee", "admin"] }))).toBe(true);
    expect(poolViewerBrands(user("u_ye", { name: "叶观旺", brands: ["LT"] }))).toBeNull();
  });

  it("keeps the brand filter for ordinary members", () => {
    expect(isGroupLeader(user("u_a", { name: "成员A", brands: ["LT"] }))).toBe(false);
    expect(poolViewerBrands(user("u_a", { name: "成员A", brands: ["LT"] }))).toEqual(["LT"]);
    expect(poolViewerBrands(undefined)).toBeUndefined();
  });

  it("exposes leader member ids for the lead list scope", () => {
    expect(new Set(leaderMemberUserIds(user("u_ye")))).toEqual(new Set(["u_ye", "u_a", "u_b"]));
    expect(leaderMemberUserIds(user("u_a"))).toEqual([]);
    expect(leaderMemberUserIds(undefined)).toEqual([]);
  });
});
