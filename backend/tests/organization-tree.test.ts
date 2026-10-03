import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  bumpOrgVersion,
  canUseAgent,
  canUseSkill,
  createAgentBinding,
  currentOrgVersion,
  effectiveAgentUsers,
  listAgentBindings,
  listOrganizationMemberships,
  listOrganizationPeople,
  listOrganizationUnits,
  listScopeMemberships,
  revokeAgentBinding,
  visibleSkillIdsForUser,
} from "../src/runtime/organization-tree.js";
import { ensureRuntimeSchema } from "../src/runtime/store.js";

let tmp = "";

const COMPANY = "company:amperetime";

function bind(target_type: "organization_unit" | "person", target_id: string, agent = "agent:kol") {
  return createAgentBinding({ agent_id: agent, target_type, target_id, company_id: COMPANY, source: "test" });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-organization-tree-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "db.sqlite"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
  });
  resetConn();
  getConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"]) delete process.env[key];
});

describe("organization tree persistence", () => {
  it("回填三级组织单元、人员外部引用、成员关系与来源", () => {
    const units = listOrganizationUnits(COMPANY);
    const byName = new Map(units.map((unit) => [unit.display_name, unit]));
    expect(units).toHaveLength(6);
    expect(byName.get("品牌与用户增长中心")).toMatchObject({ level: 1, type: "center", parent_id: null, head_person_ref: "person:zhang_huiling" });
    expect(byName.get("推广部")).toMatchObject({ level: 2, parent_id: "org:brand_user_growth_center", head_person_ref: "person:zhong_jiankui" });
    expect(byName.get("LT组")).toMatchObject({ level: 3, parent_id: "org:promotion_department", head_person_ref: null });
    expect(byName.get("PQ-RO-TB组")).toMatchObject({ level: 3, parent_id: "org:promotion_department" });
    expect(byName.get("品牌项目组")).toMatchObject({ level: 2 });
    expect(byName.get("市场部")).toMatchObject({ level: 2 });
    expect(units.every((unit) => unit.source && unit.company_id === COMPANY)).toBe(true);
  });

  it("人员、成员关系与范围关系按组织图落库，未提供的字段保持为空", () => {
    const people = listOrganizationPeople();
    expect(people).toHaveLength(14);
    const zhang = people.find((person) => person.person_ref === "person:zhang_huiling");
    expect(zhang).toMatchObject({ display_name: "张慧玲", user_id: null, user_ref: null });
    expect(people.find((person) => person.person_ref === "person:liu_min")?.user_ref).toBe("user:liu_min");

    const memberships = listOrganizationMemberships(COMPANY);
    expect(memberships).toHaveLength(13);
    const zhong = memberships.find((row) => row.person_ref === "person:zhong_jiankui");
    expect(zhong).toMatchObject({ org_unit_id: "org:promotion_department", position: "推广部主管", relation: "primary", status: "active" });
    expect(zhong?.effective_from).toBeNull();
    expect(memberships.find((row) => row.person_ref === "person:zhang_huiling")?.position).toBe("高级副总裁");

    const scopes = listScopeMemberships();
    const personScope = (ref: string) => scopes.filter((row) => row.subject_type === "person" && row.subject_id === ref);
    expect(personScope("person:ye_guanwang")).toHaveLength(12);
    expect(personScope("person:yue_jialin")).toHaveLength(12);
    expect(personScope("person:gu_jiarui")).toHaveLength(1);
    expect(personScope("person:gu_jiarui")[0]).toMatchObject({ brand_id: "brand:lt", region_id: "region:eu" });
    expect(personScope("person:zhang_gan")[0]).toMatchObject({ brand_id: "brand:lt", region_id: "region:ca_au" });
    expect(personScope("person:zhang_huiling")).toHaveLength(0);
    const unitScope = scopes.filter((row) => row.subject_type === "organization_unit");
    expect(unitScope.map((row) => `${row.subject_id}:${row.brand_id}`).sort()).toEqual([
      "org:lt_team:brand:lt",
      "org:pq_ro_tb_team:brand:pq",
      "org:pq_ro_tb_team:brand:ro",
      "org:pq_ro_tb_team:brand:tb",
    ]);
    expect(currentOrgVersion(COMPANY)).toBe(1);
  });

  it("回填是幂等的：重复执行不产生重复行", () => {
    const before = listOrganizationUnits(COMPANY).length + listOrganizationMemberships(COMPANY).length + listScopeMemberships().length;
    resetConn();
    getConn();
    const after = listOrganizationUnits(COMPANY).length + listOrganizationMemberships(COMPANY).length + listScopeMemberships().length;
    expect(after).toBe(before);
  });
});

describe("effective Agent users", () => {
  it("绑定三级组：成员 + 逐级上级负责人（含 registry 声明的试点绑定）", () => {
    bind("organization_unit", "org:lt_team");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(9);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:ye_guanwang")).toMatchObject({ via: "unit_member", via_unit_id: "org:lt_team", display_name: "叶观旺" });
    expect(byRef.get("person:gu_jiarui")?.via).toBe("unit_member");
    expect(byRef.get("person:zhong_jiankui")).toMatchObject({ via: "ancestor_head", via_unit_id: "org:promotion_department" });
    expect(byRef.get("person:zhang_huiling")).toMatchObject({ via: "ancestor_head", via_unit_id: "org:brand_user_growth_center" });
    expect(byRef.get("person:yan_chen")).toMatchObject({ via: "binding_target", display_name: "鄢棽" });
    expect(byRef.has("person:chen_bingbing")).toBe(false);
    expect(effective.org_version).toBe(1);
  });

  it("绑定二级部门：本部门负责人、本部门与三级组成员、一级负责人", () => {
    bind("organization_unit", "org:promotion_department");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(14);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:zhong_jiankui")?.via).toBe("unit_head");
    expect(byRef.get("person:liu_min")?.via).toBe("unit_member");
    expect(byRef.get("person:chen_bingbing")?.via).toBe("unit_member");
    expect(byRef.get("person:zhang_huiling")?.via).toBe("ancestor_head");
  });

  it("绑定一级部门：本部门负责人与全部下级成员，无更上级负责人", () => {
    bind("organization_unit", "org:brand_user_growth_center");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(14);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:zhang_huiling")?.via).toBe("unit_head");
    expect(byRef.get("person:liu_min")).toMatchObject({ via: "unit_member", via_unit_id: "org:promotion_department" });
    expect(byRef.get("person:ye_guanwang")?.via_unit_id).toBe("org:lt_team");
    expect(effective.users.every((user) => user.via !== "ancestor_head")).toBe(true);
  });

  it("绑定人员：本人 + 所属各级上级负责人，不含同事", () => {
    bind("person", "person:gu_jiarui");
    const refs = effectiveAgentUsers("agent:kol").person_refs.sort();
    expect(refs).toEqual(["person:gu_jiarui", "person:yan_chen", "person:zhang_huiling", "person:zhong_jiankui"]);
    expect(refs).not.toContain("person:li_weiyu");
  });

  it("撤绑后立即不再覆盖；绑定目标必须存在", () => {
    const binding = bind("organization_unit", "org:lt_team");
    expect(effectiveAgentUsers("agent:kol").users).toHaveLength(9);
    expect(revokeAgentBinding(binding.id)).toBe(true);
    expect(effectiveAgentUsers("agent:kol").person_refs).toEqual(["person:yan_chen"]);
    expect(listAgentBindings("agent:kol")).toHaveLength(1);
    expect(() => bind("organization_unit", "org:not_exists")).toThrow(/unknown organization unit/);
    expect(() => bind("person", "person:not_exists")).toThrow(/unknown person/);
    expect(() => createAgentBinding({ agent_id: "agent:kol", target_type: "organization_unit", target_id: "org:lt_team", company_id: "company:other" })).toThrow(
      /outside the company/,
    );
  });

  it("人员离开部门（成员关系结束）后不再覆盖，组织版本可递增", () => {
    bind("organization_unit", "org:lt_team");
    expect(effectiveAgentUsers("agent:kol").person_refs).toContain("person:li_weiyu");
    getConn().prepare("UPDATE organization_memberships SET status = 'ended' WHERE person_ref = ?").run("person:li_weiyu");
    expect(effectiveAgentUsers("agent:kol").person_refs).not.toContain("person:li_weiyu");
    expect(bumpOrgVersion(COMPANY, "测试：组织变动")).toBe(2);
    expect(effectiveAgentUsers("agent:kol").org_version).toBe(2);
  });
});

describe("Agent use authorization", () => {
  it("只有挂到组织人员上的账号才获得资格", () => {
    bind("organization_unit", "org:lt_team");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(false);
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_ye", "person:ye_guanwang");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.user_ids).toContain("usr_ye");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(true);
    expect(canUseAgent(null, "agent:kol")).toBe(false);
    expect(canUseAgent("usr_other", "agent:kol")).toBe(false);
    expect(canUseAgent("usr_ye", "agent:other")).toBe(false);
  });

  it("技能资格经 Agent 装配派生，不回到按人授权", () => {
    ensureRuntimeSchema();
    bind("organization_unit", "org:lt_team");
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_gu", "person:gu_jiarui");
    const db = getConn();
    db.prepare("DELETE FROM runtime_agent_skills WHERE agent_id = ? AND skill_id = ?").run("agent:kol", "creator_discovery");
    db.prepare("INSERT INTO runtime_agent_skills (agent_id, skill_id, enabled, version, updated_at) VALUES (?, ?, 1, 0, ?)").run(
      "agent:kol",
      "creator_discovery",
      new Date().toISOString(),
    );
    expect(canUseSkill("usr_gu", "creator_discovery")).toBe(true);
    expect(canUseSkill("usr_other", "creator_discovery")).toBe(false);
    expect(visibleSkillIdsForUser("usr_gu")).toContain("creator_discovery");
    expect(visibleSkillIdsForUser("usr_gu").length).toBeGreaterThan(0);
    expect(visibleSkillIdsForUser("usr_other")).toEqual([]);
  });
});

describe("person binding and Starry account facts", () => {
  it("绑定人员即使没有组织关系也覆盖本人，且不虚构上级负责人", () => {
    bind("person", "person:yan_chen");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.person_refs).toEqual(["person:yan_chen"]);
    expect(effective.users[0]).toMatchObject({ via: "binding_target", display_name: "鄢棽", via_unit_id: "" });
  });

  it("registry 的 account_username 落为登录账号，未建账号的人保持为空", () => {
    const db = getConn();
    db.prepare(
      "INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("sriphy", "sriphy", "鄢棽", "x", JSON.stringify(["employee"]), "[]", 1, "now", "now");
    const people = listOrganizationPeople();
    expect(people.find((person) => person.person_ref === "person:yan_chen")).toMatchObject({
      display_name: "鄢棽",
      user_id: "sriphy",
      starry_open_id: null,
    });
    expect(people.find((person) => person.person_ref === "person:zhang_gan")?.starry_open_id).toBe("289");
    expect(people.find((person) => person.person_ref === "person:ye_guanwang")?.user_id).toBeNull();
    bind("person", "person:yan_chen");
    expect(canUseAgent("sriphy", "agent:kol")).toBe(true);
  });
});
