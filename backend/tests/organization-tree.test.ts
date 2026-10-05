import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  avatarUrlForUser,
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
  reseedOrganizationTreeFromRegistry,
  revokeAgentBinding,
  visibleSkillIdsForUser,
} from "../src/runtime/organization-tree.js";
import { ensureRuntimeSchema } from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";

const COMPANY = "company:amperetime";

function bind(target_type: "organization_unit" | "person", target_id: string, agent = "agent:kol") {
  return createAgentBinding({ agent_id: agent, target_type, target_id, company_id: COMPANY, source: "test" });
}

function insertUser(id: string, name: string, active = 1) {
  getConn().prepare(
    "INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(id, id, name, "x", JSON.stringify(["employee"]), "[]", active, "now", "now");
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-organization-tree-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "db.sqlite"),
    LINGONG_DATA: tmp,
    AUTH_MODE: "disabled",
    NODE_ENV: "test",
  });
  await freshTestDatabase();
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
    expect(units).toHaveLength(13);
    expect(byName.get("品牌与用户增长中心")).toMatchObject({ level: 1, type: "center", parent_id: null, head_person_ref: "person:zhang_huiling" });
    expect(byName.get("推广部")).toMatchObject({ level: 2, parent_id: "org:brand_user_growth_center", head_person_ref: "person:zhong_jiankui" });
    expect(byName.get("广告投放部")).toMatchObject({ level: 2, parent_id: "org:brand_user_growth_center", head_person_ref: "person:zhong_jiankui" });
    expect(byName.get("LT组")).toMatchObject({ level: 3, parent_id: "org:promotion_department", head_person_ref: "person:ye_guanwang" });
    expect(byName.get("PQ-RO-TB组")).toMatchObject({ level: 3, parent_id: "org:promotion_department", head_person_ref: "person:zhong_jiankui" });
    expect(byName.get("品牌项目组")).toMatchObject({ level: 2 });
    expect(byName.get("市场部")).toMatchObject({ level: 2 });
    expect(byName.get("研究院")).toMatchObject({ level: 1, parent_id: null, head_person_ref: "person:lu_haijun" });
    expect(byName.get("数字智能中心")).toMatchObject({ level: 2, parent_id: "org:research_institute", head_person_ref: "person:huang_qiyou" });
    expect(byName.get("产品部")).toMatchObject({ level: 3, parent_id: "org:digital_intelligence_center" });
    expect(byName.get("AI产品组")).toMatchObject({ level: 4, parent_id: "org:product_department" });
    expect(byName.get("后端组")).toMatchObject({ level: 3, parent_id: "org:digital_intelligence_center" });
    expect(byName.get("测试组")).toMatchObject({ level: 3, parent_id: "org:digital_intelligence_center", head_person_ref: "person:wei_yinping" });
    expect(units.every((unit) => unit.source && unit.company_id === COMPANY)).toBe(true);
  });

  it("人员、成员关系与范围关系按组织图落库，未提供的字段保持为空", () => {
    const people = listOrganizationPeople();
    expect(people).toHaveLength(19);
    const zhang = people.find((person) => person.person_ref === "person:zhang_huiling");
    expect(zhang).toMatchObject({ display_name: "张慧玲", user_id: null, user_ref: null });
    expect(people.find((person) => person.person_ref === "person:liu_min")?.user_ref).toBe("user:liu_min");
    expect(people.find((person) => person.person_ref === "person:ye_guanwang")?.avatar_url).toBe("/avatars/employees/ye_guanwang.png");
    expect(people.find((person) => person.person_ref === "person:liu_min")?.avatar_url).toBeNull();
    expect(people.filter((person) => person.avatar_url)).toHaveLength(18);

    const memberships = listOrganizationMemberships(COMPANY);
    expect(memberships).toHaveLength(19);
    const zhong = memberships.find((row) => row.person_ref === "person:zhong_jiankui");
    expect(zhong).toMatchObject({ org_unit_id: "org:promotion_department", position: "广告投放主管", relation: "primary", status: "active" });
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

  it("账号关联后按 user_id 解析个人头像 URL；未关联账号或该人员无人像时为 null", () => {
    expect(avatarUrlForUser("usr_ye")).toBeNull();
    expect(avatarUrlForUser(null)).toBeNull();
    expect(avatarUrlForUser(undefined)).toBeNull();
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_ye", "person:ye_guanwang");
    expect(avatarUrlForUser("usr_ye")).toBe("/avatars/employees/ye_guanwang.png");
    expect(avatarUrlForUser("usr_missing")).toBeNull();
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_liu", "person:liu_min");
    expect(avatarUrlForUser("usr_liu")).toBeNull();
  });

  it("重放回填时按 account_username 认领账号，头像随登录账号可达", () => {
    const db = getConn();
    expect(avatarUrlForUser("usr_sriphy")).toBeNull();
    db.prepare(
      "INSERT INTO users (id,username,name,password_hash,roles,brands,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("usr_sriphy", "sriphy", "鄢棽", "x", JSON.stringify(["employee"]), "[]", 1, "now", "now");
    reseedOrganizationTreeFromRegistry();
    expect(listOrganizationPeople().find((person) => person.person_ref === "person:yan_chen")?.user_id).toBe("usr_sriphy");
    expect(avatarUrlForUser("usr_sriphy")).toBe("/avatars/employees/yan_chen.png");
  });
});

describe("effective Agent users", () => {
  it("绑定三级组：成员 + 逐级上级负责人（含 registry 声明的试点绑定）", () => {
    bind("organization_unit", "org:lt_team");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(11);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:ye_guanwang")).toMatchObject({ via: "unit_head", via_unit_id: "org:lt_team", display_name: "叶观旺" });
    expect(byRef.get("person:gu_jiarui")?.via).toBe("unit_member");
    expect(byRef.get("person:zhong_jiankui")).toMatchObject({ via: "ancestor_head", via_unit_id: "org:promotion_department" });
    expect(byRef.get("person:zhang_huiling")).toMatchObject({ via: "ancestor_head", via_unit_id: "org:brand_user_growth_center" });
    expect(byRef.get("person:yan_chen")).toMatchObject({ via: "binding_target", display_name: "鄢棽" });
    expect(byRef.get("person:huang_qiyou")).toMatchObject({ via: "binding_target", via_unit_id: "org:digital_intelligence_center" });
    expect(byRef.get("person:lu_haijun")).toMatchObject({ via: "ancestor_head", via_unit_id: "org:research_institute" });
    expect(byRef.has("person:chen_bingbing")).toBe(false);
    expect(effective.org_version).toBe(1);
  });

  it("today_plan 归属：绑定 LT组组长后，本人与各级上级负责人可用", () => {
    const effective = effectiveAgentUsers("agent:workspace-planner");
    expect(effective.person_refs.sort()).toEqual(["person:ye_guanwang", "person:zhang_huiling", "person:zhong_jiankui"]);
    expect(effective.user_ids).toEqual([]);
  });

  it("绑定二级部门：本部门负责人、本部门与三级组成员、一级负责人", () => {
    bind("organization_unit", "org:promotion_department");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(16);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:zhong_jiankui")?.via).toBe("unit_head");
    expect(byRef.get("person:liu_min")?.via).toBe("unit_member");
    expect(byRef.get("person:chen_bingbing")?.via).toBe("unit_member");
    expect(byRef.get("person:zhang_huiling")?.via).toBe("ancestor_head");
  });

  it("绑定一级部门：本部门负责人与全部下级成员，无更上级负责人", () => {
    bind("organization_unit", "org:brand_user_growth_center");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.users).toHaveLength(16);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:zhang_huiling")?.via).toBe("unit_head");
    expect(byRef.get("person:liu_min")).toMatchObject({ via: "unit_member", via_unit_id: "org:promotion_department" });
    expect(byRef.get("person:ye_guanwang")?.via_unit_id).toBe("org:lt_team");
    // 本绑定不产生 ancestor_head；registry 的人员试点绑定（yan_chen / huang_qiyou）沿研究院链路带上负责人。
    // 黄启友自 2026-10-05 起是 registry 声明的直接绑定目标，因此只剩陆海军是继承来的负责人。
    const ancestorHeads = effective.users.filter((user) => user.via === "ancestor_head").map((user) => user.person_ref).sort();
    expect(ancestorHeads).toEqual(["person:lu_haijun"]);
  });

  it("绑定人员：本人 + 所属单元与各级上级负责人，不含同事", () => {
    bind("person", "person:gu_jiarui");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.person_refs.sort()).toEqual([
      "person:gu_jiarui",
      "person:huang_qiyou",
      "person:lu_haijun",
      "person:yan_chen",
      "person:ye_guanwang",
      "person:zhang_huiling",
      "person:zhong_jiankui",
    ]);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:ye_guanwang")).toMatchObject({ via: "unit_head", via_unit_id: "org:lt_team" });
    expect(effective.person_refs).not.toContain("person:li_weiyu");
  });

  it("撤绑后立即不再覆盖；绑定目标必须存在", () => {
    const binding = bind("organization_unit", "org:lt_team");
    expect(effectiveAgentUsers("agent:kol").users).toHaveLength(11);
    expect(revokeAgentBinding(binding.id)).toBe(true);
    expect([...effectiveAgentUsers("agent:kol").person_refs].sort()).toEqual(["person:huang_qiyou", "person:lu_haijun", "person:yan_chen"]);
    expect(listAgentBindings("agent:kol")).toHaveLength(2);
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
    insertUser("usr_ye", "叶观旺");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(false);
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_ye", "person:ye_guanwang");
    const effective = effectiveAgentUsers("agent:kol");
    expect(effective.user_ids).toContain("usr_ye");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(true);
    expect(canUseAgent(null, "agent:kol")).toBe(false);
    expect(canUseAgent("usr_other", "agent:kol")).toBe(false);
    expect(canUseAgent("usr_ye", "agent:other")).toBe(false);
  });

  it("账号停用后立即失去资格（不削弱已发布 + 在职闸门）", () => {
    bind("organization_unit", "org:lt_team");
    insertUser("usr_ye", "叶观旺");
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("usr_ye", "person:ye_guanwang");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(true);
    getConn().prepare("UPDATE users SET active = 0 WHERE id = ?").run("usr_ye");
    expect(canUseAgent("usr_ye", "agent:kol")).toBe(false);
  });

  it("技能资格经 Agent 装配派生，不回到按人授权", () => {
    ensureRuntimeSchema();
    bind("organization_unit", "org:lt_team");
    insertUser("usr_gu", "顾嘉瑞");
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
    getConn().prepare("UPDATE organization_memberships SET status = 'ended' WHERE person_ref = ?").run("person:yan_chen");
    const effective = effectiveAgentUsers("agent:kol");
    // 另有 huang_qiyou 的 registry 试点绑定（2026-10-05）覆盖其本人与上级负责人；
    // 这里只校验 yan_chen 的本人覆盖：无成员关系时 via_unit_id 为空，不虚构上级。
    expect([...effective.person_refs].sort()).toEqual(["person:huang_qiyou", "person:lu_haijun", "person:yan_chen"]);
    const byRef = new Map(effective.users.map((user) => [user.person_ref, user]));
    expect(byRef.get("person:yan_chen")).toMatchObject({ via: "binding_target", display_name: "鄢棽", via_unit_id: "" });
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
    });
    expect(people.find((person) => person.person_ref === "person:ye_guanwang")).toMatchObject({
      starry_open_id: "289",
      email: "robertson.ye@amperetime.com",
      employee_no: "1028",
    });
    expect(people.find((person) => person.person_ref === "person:yan_chen")).toMatchObject({
      starry_open_id: "282",
      email: "sriphy.yan@amperetime.com",
      employee_no: "0999",
    });
    expect(people.find((person) => person.person_ref === "person:zhang_gan")?.starry_open_id).toBeNull();
    expect(people.find((person) => person.person_ref === "person:ye_guanwang")?.user_id).toBeNull();
    bind("person", "person:yan_chen");
    expect(canUseAgent("sriphy", "agent:kol")).toBe(true);
  });
});
