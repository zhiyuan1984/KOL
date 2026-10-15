import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { resolveLeadBrand } from "../src/ticket-domain/kol-leads.js";
import { isGroupLeader, leaderMemberUserIds, poolViewerBrands } from "../src/host/inbound-scope.js";
import { ensureOrganizationTree, leaderScopeForUser, syncUserOrganization } from "../src/runtime/organization-tree.js";
import type { AppUser } from "../src/auth.js";
import { freshTestDatabase } from "./support/pg.js";

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

async function insertUser(id: string, name: string, brands: string[] = []) {
  (await getConn().query("INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,1,'now','now')",[id,id,name,"x",JSON.stringify(["employee"]),JSON.stringify(brands)]));
  return `person:user:${id}`;
}

async function insertUnit(id: string, displayName: string, level: number, parentId: string | null, headPersonRef: string | null) {
  (await getConn().query("INSERT INTO organization_units\n       (id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,created_at,updated_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 'active','now','now')",[id,"company:amperetime",displayName,"department",parentId,level,headPersonRef,headPersonRef]));
}

beforeEach(async () => {
  // A fresh native clone is required for the fixed fixture ids below. Reclaim
  // only this worker's completed clone; never replay retired SQLite DDL.
  await freshTestDatabase({ reclaimPrevious: true });
  (await ensureOrganizationTree());
  // 四级组织：一级中心 → 二级推广部 → 三级LT组 → 四级投放小组
  const zhang = (await insertUser("u_zhang", "张慧玲"));
  const zhong = (await insertUser("u_zhong", "钟剑奎"));
  const ye = (await insertUser("u_ye", "叶观旺", ["LT"]));
  const a = (await insertUser("u_a", "成员A", ["LT"]));
  const b = (await insertUser("u_b", "成员B", ["LT"]));
  (await insertUnit("org:l1", "品牌与用户增长中心", 1, null, zhang));
  (await insertUnit("org:l2", "推广部", 2, "org:l1", zhong));
  (await insertUnit("org:l3", "LT组", 3, "org:l2", ye));
  (await insertUnit("org:l4", "投放小组", 4, "org:l3", null));
  for (const [id, unitId] of [["u_zhang", "org:l1"], ["u_zhong", "org:l2"], ["u_ye", "org:l3"], ["u_a", "org:l3"], ["u_b", "org:l4"]] as const) {
    await syncUserOrganization(id, unitId);
  }
});

afterEach(async () => {
  (await resetConn());
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
  it("recognizes unit heads at any level as 组长", async () => {
    expect((await leaderScopeForUser("u_ye")).isLeader).toBe(true); // 三级 LT组组长
    expect((await leaderScopeForUser("u_zhong")).isLeader).toBe(true); // 二级 推广部组长
    expect((await leaderScopeForUser("u_zhang")).isLeader).toBe(true); // 一级 中心组长
    expect((await leaderScopeForUser("u_a")).isLeader).toBe(false); // 普通成员
    expect((await leaderScopeForUser("nope")).isLeader).toBe(false);
  });

  it("scopes a leader to their unit plus all descendant units", async () => {
    const ye = (await leaderScopeForUser("u_ye"));
    expect(new Set(ye.unitIds)).toEqual(new Set(["org:l3", "org:l4"]));
    expect(new Set(ye.memberUserIds)).toEqual(new Set(["u_ye", "u_a", "u_b"]));
  });

  it("gives superiors a strictly larger scope（组长的上级权限更多）", async () => {
    const ye = new Set((await leaderScopeForUser("u_ye")).memberUserIds);
    const zhong = new Set((await leaderScopeForUser("u_zhong")).memberUserIds);
    const zhang = new Set((await leaderScopeForUser("u_zhang")).memberUserIds);
    for (const id of ye) expect(zhong.has(id)).toBe(true);
    expect(zhong.has("u_zhong")).toBe(true);
    for (const id of zhong) expect(zhang.has(id)).toBe(true);
    expect(zhang.has("u_zhang")).toBe(true);
    expect(zhang.size).toBeGreaterThan(zhong.size);
    expect(zhong.size).toBeGreaterThan(ye.size);
  });
});

describe("isGroupLeader / poolViewerBrands", () => {
  it("treats admins and any-level heads as leaders (pool: no brand filter)", async () => {
    expect((await isGroupLeader(user("u_ye", { name: "叶观旺" })))).toBe(true);
    expect((await isGroupLeader(user("u_zhong", { name: "钟剑奎" })))).toBe(true);
    expect((await isGroupLeader(user("u_admin", { roles: ["employee", "admin"] })))).toBe(true);
    expect((await poolViewerBrands(user("u_ye", { name: "叶观旺", brands: ["LT"] })))).toBeNull();
  });

  it("keeps the brand filter for ordinary members", async () => {
    expect((await isGroupLeader(user("u_a", { name: "成员A", brands: ["LT"] })))).toBe(false);
    expect((await poolViewerBrands(user("u_a", { name: "成员A", brands: ["LT"] })))).toEqual(["LT"]);
    expect((await poolViewerBrands(undefined))).toBeUndefined();
  });

  it("exposes leader member ids for the lead list scope", async () => {
    expect(new Set((await leaderMemberUserIds(user("u_ye"))))).toEqual(new Set(["u_ye", "u_a", "u_b"]));
    expect((await leaderMemberUserIds(user("u_a")))).toEqual([]);
    expect((await leaderMemberUserIds(undefined))).toEqual([]);
  });
});
