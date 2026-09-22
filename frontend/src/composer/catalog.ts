import { canonicalExpertId, ROLE_EXPERT_IDS, expertRoleCopy, type Expert } from "../experts";
import { skillLabel } from "../knowledgeCopy";

export const SKILL_GROUPS = [
  { id: "discover", label: "发现" },
  { id: "profile", label: "画像与评估" },
  { id: "follow", label: "跟进 SOP" },
  { id: "mail", label: "邮件与审批" },
  { id: "other", label: "其他" },
] as const;

export type SkillGroupId = (typeof SKILL_GROUPS)[number]["id"];

const WRITE_SKILL_IDS = new Set([
  "creator_contact_decrypt",
  "email_compose",
  "confirm_stage",
  "creator_library_sync",
  "creator_owner_update",
  "creator_status_update",
  "email_send",
  "stage_mail",
]);

const WRITE_SKILL_HINT = /decrypt|contact_decrypt|write.?mail|email_compose|confirm_stage|propose.?stage|sync.?ingest|library_sync|owner_update|status_update|发信|写合作|阶段变更|同步入库|更新负责人/;

const GROUP_MATCHERS: Record<Exclude<SkillGroupId, "other">, RegExp> = {
  discover: /discover|discovery|crawl|采集|发现/,
  profile: /profile|scoring|portrait|画像|评分|评估/,
  follow: /follow|sop|outreach|lifecycle|kanban|跟进|建联|生命周期/,
  mail: /email|mail|reply|approval|approv|邮件|审批|回复/,
};

export type CatalogSkill = {
  id: string;
  title: string;
  label?: string;
  aliases?: string[];
  in_market?: boolean;
  granted?: boolean;
  /** false = 内部技能（只被 pipeline / 定时任务 / 旅程调用），不进员工可选清单。 */
  employee_visible?: boolean;
};

export function labelOfSkill(skill: CatalogSkill): string {
  return skill.label || skill.title || skillLabel(skill.id) || skill.id;
}

export function isWriteSkill(skill: CatalogSkill): boolean {
  if (WRITE_SKILL_IDS.has(skill.id)) return true;
  return WRITE_SKILL_HINT.test(`${skill.id} ${labelOfSkill(skill)}`);
}

export function skillGroupOf(skill: CatalogSkill): SkillGroupId {
  const blob = `${skill.id} ${labelOfSkill(skill)} ${(skill.aliases || []).join(" ")}`;
  for (const group of SKILL_GROUPS) {
    if (group.id === "other") continue;
    if (GROUP_MATCHERS[group.id].test(blob)) return group.id;
  }
  return "other";
}

export function groupSkills(skills: CatalogSkill[]): { id: SkillGroupId; label: string; items: CatalogSkill[] }[] {
  const buckets = new Map<SkillGroupId, CatalogSkill[]>();
  for (const group of SKILL_GROUPS) buckets.set(group.id, []);
  for (const skill of skills) {
    buckets.get(skillGroupOf(skill))?.push(skill);
  }
  return SKILL_GROUPS.map((group) => ({
    ...group,
    items: buckets.get(group.id) || [],
  })).filter((group) => group.items.length > 0);
}

export function matchesSkillQuery(skill: CatalogSkill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const blob = `${skill.id} ${labelOfSkill(skill)} ${(skill.aliases || []).join(" ")}`.toLowerCase();
  return blob.includes(q) || labelOfSkill(skill).toLowerCase().startsWith(q);
}

export const DIGITAL_EMPLOYEES: { id: string; label: string }[] = [
  { id: "expert:kol", label: "KOL推广" },
  { id: "expert:crawler", label: "爬虫工程师" },
  { id: "expert:approver", label: "审批员" },
];

export function expertChipLabel(id: string, experts: Expert[] = []): string {
  const canonical = canonicalExpertId(id);
  const hit = experts.find((row) => canonicalExpertId(row.id) === canonical);
  if (hit) return expertRoleCopy(hit);
  return DIGITAL_EMPLOYEES.find((row) => row.id === canonical)?.label || canonical.replace(/^expert:/, "");
}

export function shortKbName(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}

export { ROLE_EXPERT_IDS };
