/**
 * 把 `config/org-registry.yaml` 的组织事实重放进运行时表。
 *
 * 首次启动的回填由 app_state 门控、只跑一次（见 runtime/organization-tree.ts），
 * 所以已建库不会自动取到 registry 的新声明。本脚本是那个「显式重放」入口：
 * 按 canonical id upsert 组织单元、人员、成员关系与范围关系，不删除任何行。
 *
 * 组织事实真的变了才自增组织版本，旧授权按新版本复核（CONST-05）；重放本身写审计。
 * 默认只报告（用事务回滚，不改库）。
 *
 * 重命名过 person_ref（如 person:xi_chucong → person:diao_chucong）时，库里会留下
 * 不再被声明的孤儿行；默认只列出，加 --retire-orphans 才把它们标为离职并结束成员关系
 * （仍不删行，历史保留）。
 *
 *   cd backend && npx tsx scripts/org-registry-replay.ts                       # 只报告
 *   cd backend && npx tsx scripts/org-registry-replay.ts --apply               # 写入并记审计
 *   cd backend && npx tsx scripts/org-registry-replay.ts --apply --retire-orphans
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit, pgTransaction, postgresDb } from "../src/postgres/access.js";
import { bumpOrgVersion, currentOrgVersion, listOrganizationMemberships, listOrganizationPeople, listOrganizationUnits, listScopeMemberships, reseedOrganizationTreeFromRegistry, } from "../src/runtime/organization-tree.js";
const apply = process.argv.includes("--apply");
const retireOrphans = process.argv.includes("--retire-orphans");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function declared() {
  const text = fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8").replace(/^\uFEFF/, "");
  const registry = JSON.parse(text) as {
    organization_units?: {
      id?: string;
    }[];
    confirmed_people?: {
      person_ref?: string;
    }[];
  };
  return {
    units: new Set((registry.organization_units || []).map((unit) => String(unit.id))),
    people: new Set((registry.confirmed_people || []).map((person) => String(person.person_ref)).filter(Boolean)),
  };
}
async function fingerprint(): Promise<string> {
  const [units, people, memberships, scopes] = await Promise.all([
    listOrganizationUnits(), listOrganizationPeople(), listOrganizationMemberships(), listScopeMemberships(),
  ]);
  const unitRows = units.map((unit) => `${unit.id}|${unit.display_name}|${unit.parent_id}|${unit.level}|${unit.head_person_ref}`);
  const peopleRows = people.map((person) => `${person.person_ref}|${person.display_name}|${person.status}|${person.user_id}|${person.avatar_url}`);
  const membershipRows = memberships.map((row) => `${row.person_ref}|${row.org_unit_id}|${row.relation}|${row.position}|${row.status}`);
  const scopeRows = scopes.map((row) => `${row.subject_type}|${row.subject_id}|${row.brand_id}|${row.region_id}`);
  return JSON.stringify([unitRows.sort(), peopleRows.sort(), membershipRows.sort(), scopeRows.sort()]);
}
async function snapshot() {
  const [units, people, memberships, scopes] = await Promise.all([
    listOrganizationUnits(), listOrganizationPeople(), listOrganizationMemberships(), listScopeMemberships(),
  ]);
  return {
    units: units.length,
    people: people.filter((person) => person.status !== "left").length,
    with_avatar: people.filter((person) => person.status !== "left" && person.avatar_url).length,
    linked_accounts: people.filter((person) => person.status !== "left" && person.user_id).length,
    memberships: memberships.length,
    scopes: scopes.length,
    org_version: await currentOrgVersion(String(units[0]?.company_id || "")),
  };
}
/** 只读地算出「重放后会变成什么」，不改库。 */
class PreviewRollback extends Error {
  constructor(readonly result: {
    before: string;
    beforeSnap: Awaited<ReturnType<typeof snapshot>>;
    afterSnap: Awaited<ReturnType<typeof snapshot>>;
    after: string;
  }) {
    super("org_registry_preview_complete");
  }
}
async function preview() {
  const before = await fingerprint();
  const beforeSnap = await snapshot();
  try {
    await pgTransaction(async () => {
      await reseedOrganizationTreeFromRegistry();
      throw new PreviewRollback({ before, beforeSnap, afterSnap: await snapshot(), after: await fingerprint() });
    });
  }
  catch (error) {
    if (error instanceof PreviewRollback)
      return error.result;
    throw error;
  }
}
async function main(): Promise<void> {
  postgresDb();
  const dl = declared();
  const plan = await preview();
  const [people, memberships] = await Promise.all([listOrganizationPeople(), listOrganizationMemberships()]);
  const orphans = people.filter((person) => !dl.people.has(person.person_ref) && person.status !== "left");
  const orphanMemberships = memberships.filter((row) => orphans.some((person) => person.person_ref === row.person_ref));
  const changed = plan.after !== plan.before;
  console.log(`库中现状：${JSON.stringify(plan.beforeSnap)}`);
  console.log(`重放后：  ${JSON.stringify(plan.afterSnap)}`);
  console.log(changed
    ? `组织事实有变化：单元 ${plan.beforeSnap.units}→${plan.afterSnap.units}、在册人员 ${plan.beforeSnap.people}→${plan.afterSnap.people}`
    : "组织事实无变化（registry 与库中一致）");
  console.log(`registry 声明：${dl.units.size} 个单元、${dl.people.size} 人`);
  if (orphans.length) {
  console.log(`孤儿行（库中有、registry 未声明）${orphans.length} 条：`);
    for (const person of orphans)
      console.log(`  ${person.person_ref} ${person.display_name}（成员关系 ${orphanMemberships.filter((row) => row.person_ref === person.person_ref).length} 条）`);
  console.log(retireOrphans ? "  → 将标为离职并结束其成员关系（不删行）" : "  → 默认不动；加 --retire-orphans 才处理");
  }
  if (!apply) {
  console.log("dry-run：本次未写库（事务已回滚）。确认差异后重跑并加 --apply。");
    return;
  }
  await reseedOrganizationTreeFromRegistry();
  const units = await listOrganizationUnits();
  const company = String(units[0]?.company_id || "");
  if (changed && plan.beforeSnap.org_version > 0) {
    const next = await bumpOrgVersion(company, "重放 config/org-registry.yaml 的组织声明", "cli:org-registry-replay");
  console.log(`组织版本 ${plan.beforeSnap.org_version} → ${next}，旧授权按新版本复核（CONST-05）。`);
  }
  else if (changed) {
  console.log("库中原本没有组织版本记录（首次回填），不自增版本。");
  }
  if (orphans.length && retireOrphans) {
    const db = postgresDb();
  for (const person of orphans) {
      await db.execute("UPDATE organization_people SET status = 'left', updated_at = $1 WHERE person_ref = $2", new Date().toISOString(), person.person_ref);
      await db.execute("UPDATE organization_memberships SET status = 'ended', updated_at = $1 WHERE person_ref = $2 AND status = 'active'", new Date().toISOString(), person.person_ref);
  }
  console.log(`已标为离职：${orphans.map((person) => person.person_ref).join("、")}`);
  }
  await audit("cli:org-registry-replay", "org_registry.replayed", {
  changed,
  retired_orphans: retireOrphans ? orphans.map((person) => person.person_ref) : [],
  before: plan.beforeSnap,
    after: await snapshot(),
  source: "config/org-registry.yaml",
  });
  console.log("已写入：(1) 组织事实 (2) 组织版本（如适用）(3) 孤儿行处置（如适用）(4) 审计事件 org_registry.replayed。");
}
try {
  await main();
}
finally {
  await postgresDb().close();
}
