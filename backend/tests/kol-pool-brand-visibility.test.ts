import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { resolveLeadBrand } from "../src/ticket-domain/kol-leads.js";
import { isGroupLeader, leaderMemberUserIds, poolViewerBrands } from "../src/host/inbound-scope.js";
import { ensureOrganizationTree, leaderScopeForUser } from "../src/runtime/organization-tree.js";
import type { AppUser } from "../src/auth.js";

type BrandFixture = {
  zhang: string; zhong: string; ye: string; ltMember: string; leafMember: string;
  pqMember: string; roMember: string; l1: string; l2: string; l3: string; l4: string;
};

let fixture: BrandFixture;
let fixtureSerial = 0;

function fixtureId(label: string): string {
  return `pool_brand_fixture_${fixtureSerial}_${label}`;
}

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
  const personRef = `person:${id}`;
  (await getConn().query("INSERT INTO organization_people (person_ref,display_name,user_id,status,created_at,updated_at) VALUES ($1,$2,$3,'active','now','now')",[personRef,name,id]));
  return personRef;
}

async function insertUnit(id: string, displayName: string, level: number, parentId: string | null, headPersonRef: string | null) {
  (await getConn().query("INSERT INTO organization_units\n       (id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,created_at,updated_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 'active','now','now')",[id,"company:amperetime",displayName,"department",parentId,level,headPersonRef,headPersonRef]));
}

async function addMember(personRef: string, unitId: string) {
  (await getConn().query("INSERT INTO organization_memberships\n       (id,person_ref,company_id,org_unit_id,relation,status,created_at,updated_at)\n     VALUES ($1,$2,$3,$4, 'primary','active','now','now')",[`m:${personRef}:${unitId}`,personRef,"company:amperetime",unitId]));
}

beforeEach(async () => {
  fixtureSerial += 1;
  fixture = {
    zhang: fixtureId("u_zhang"), zhong: fixtureId("u_zhong"), ye: fixtureId("u_ye"),
    ltMember: fixtureId("u_lt"), leafMember: fixtureId("u_leaf"),
    pqMember: fixtureId("u_pq"), roMember: fixtureId("u_ro"),
    l1: fixtureId("org_l1"), l2: fixtureId("org_l2"),
    l3: fixtureId("org_l3"), l4: fixtureId("org_l4"),
  };
  (await resetConn());
  getConn();
  (await ensureOrganizationTree());
  // 四级组织：一级中心 → 二级推广部 → 三级LT组 → 四级投放小组
  const zhang = (await insertUser(fixture.zhang, "张慧玲"));
  const zhong = (await insertUser(fixture.zhong, "钟剑奎"));
  const ye = (await insertUser(fixture.ye, "叶观旺", ["LT"]));
  const ltMember = (await insertUser(fixture.ltMember, "LT普通成员", ["LT"]));
  const leafMember = (await insertUser(fixture.leafMember, "成员B", ["LT"]));
  const pqMember = (await insertUser(fixture.pqMember, "PQ普通成员", ["PQ"]));
  const roMember = (await insertUser(fixture.roMember, "RO普通成员", ["RO"]));
  (await insertUnit(fixture.l1, "品牌与用户增长中心", 1, null, zhang));
  (await insertUnit(fixture.l2, "推广部", 2, fixture.l1, zhong));
  (await insertUnit(fixture.l3, "LT组", 3, fixture.l2, ye));
  (await insertUnit(fixture.l4, "投放小组", 4, fixture.l3, null));
  (await addMember(zhang, fixture.l1));
  (await addMember(zhong, fixture.l2));
  (await addMember(ye, fixture.l3));
  (await addMember(ltMember, fixture.l3));
  (await addMember(leafMember, fixture.l4));
  (await addMember(pqMember, fixture.l4));
  (await addMember(roMember, fixture.l4));
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
    expect((await leaderScopeForUser(fixture.ye)).isLeader).toBe(true); // 三级 LT组组长
    expect((await leaderScopeForUser(fixture.zhong)).isLeader).toBe(true); // 二级 推广部组长
    expect((await leaderScopeForUser(fixture.zhang)).isLeader).toBe(true); // 一级 中心组长
    expect((await leaderScopeForUser(fixture.ltMember)).isLeader).toBe(false); // 普通成员
    expect((await leaderScopeForUser("nope")).isLeader).toBe(false);
  });

  it("scopes a leader to their unit plus all descendant units", async () => {
    const ye = (await leaderScopeForUser(fixture.ye));
    expect(new Set(ye.unitIds)).toEqual(new Set([fixture.l3, fixture.l4]));
    expect(new Set(ye.memberUserIds)).toEqual(new Set([
      fixture.ye, fixture.ltMember, fixture.leafMember, fixture.pqMember, fixture.roMember,
    ]));
  });

  it("gives superiors a strictly larger scope（组长的上级权限更多）", async () => {
    const ye = new Set((await leaderScopeForUser(fixture.ye)).memberUserIds);
    const zhong = new Set((await leaderScopeForUser(fixture.zhong)).memberUserIds);
    const zhang = new Set((await leaderScopeForUser(fixture.zhang)).memberUserIds);
    for (const id of ye) expect(zhong.has(id)).toBe(true);
    expect(zhong.has(fixture.zhong)).toBe(true);
    for (const id of zhong) expect(zhang.has(id)).toBe(true);
    expect(zhang.has(fixture.zhang)).toBe(true);
    expect(zhang.size).toBeGreaterThan(zhong.size);
    expect(zhong.size).toBeGreaterThan(ye.size);
  });
});

describe("isGroupLeader / poolViewerBrands", () => {
  it("treats admins and any-level heads as leaders (pool: no brand filter)", async () => {
    expect((await isGroupLeader(user(fixture.ye, { name: "叶观旺" })))).toBe(true);
    expect((await isGroupLeader(user(fixture.zhong, { name: "钟剑奎" })))).toBe(true);
    const admin = user(fixtureId("u_admin"), { roles: ["employee", "admin"], brands: ["LT"] });
    expect((await isGroupLeader(admin))).toBe(true);
    expect((await poolViewerBrands(user(fixture.ye, { name: "叶观旺", brands: ["LT"] })))).toBeNull();
    expect((await poolViewerBrands(admin))).toBeNull();
  });

  it("keeps the brand filter for ordinary members", async () => {
    const ltMember = user(fixture.ltMember, { name: "LT普通成员", brands: ["LT"] });
    const pqMember = user(fixture.pqMember, { name: "PQ普通成员", brands: ["PQ"] });
    const roMember = user(fixture.roMember, { name: "RO普通成员", brands: ["RO"] });
    expect((await isGroupLeader(ltMember))).toBe(false);
    expect((await isGroupLeader(pqMember))).toBe(false);
    expect((await isGroupLeader(roMember))).toBe(false);
    expect((await poolViewerBrands(ltMember))).toEqual(["LT"]);
    expect((await poolViewerBrands(pqMember))).toEqual(["PQ"]);
    expect((await poolViewerBrands(roMember))).toEqual(["RO"]);
    expect((await poolViewerBrands(undefined))).toBeUndefined();
  });

  it("exposes leader member ids for the lead list scope", async () => {
    expect(new Set((await leaderMemberUserIds(user(fixture.ye))))).toEqual(new Set([
      fixture.ye, fixture.ltMember, fixture.leafMember, fixture.pqMember, fixture.roMember,
    ]));
    expect((await leaderMemberUserIds(user(fixture.ltMember)))).toEqual([]);
    expect((await leaderMemberUserIds(undefined))).toEqual([]);
  });
});
