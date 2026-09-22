import { getConn } from "../db.js";
import { sopFunnelId, SOP_PACKS } from "../sops.js";
import { taskDefinitions } from "../tasks/registry.js";

export type FunnelId = "reach" | "intent" | "biz" | "sample" | "content" | "settle" | "exception";

export const FUNNEL_STAGES: { id: FunnelId; label: string; hint: string }[] = [
  { id: "reach", label: "建联", hint: "建联 / 画像" },
  { id: "intent", label: "意向", hint: "跟进" },
  { id: "biz", label: "评估报价", hint: "评估 / 报价" },
  { id: "sample", label: "寄样测评", hint: "采集" },
  { id: "content", label: "内容发布", hint: "会话" },
  { id: "settle", label: "结算", hint: "预算" },
  { id: "exception", label: "异常旁路", hint: "风险扫描" },
];

const FUNNEL_BY_ID: Record<string, FunnelId> = {
  creator_profile: "reach",
  creator_discovery: "reach",
  discovery_brief: "reach",
  discovery_plan: "reach",
  creator_scoring: "reach",
  kol_analyze: "reach",
  creator_outreach: "reach",
  creator_library_query: "reach",
  creator_library_all: "reach",
  creator_library_sync: "reach",
  creator_status_update: "reach",
  creator_owner_update: "reach",
  creator_contact_decrypt: "reach",
  creator_filter_options: "reach",
  creator_lifecycle_kanban: "intent",
  creator_daily_tasks: "reach",
  today_plan: "reach",
  today_analyze: "reach",
  todo_plan: "reach",
  confirm_stage: "intent",
  stage_sop: "intent",
  reply_analysis: "intent",
  business_approval: "biz",
  deal_memory: "biz",
  email_compose: "biz",
  email_conversation_read: "biz",
  email_conversation_list: "biz",
  email_mailbox_list: "biz",
  email_app_conversation_list: "biz",
  creator_risk_conversations: "exception",
  creator_budget_report: "settle",
  risk_scan: "exception",
  ...Object.fromEntries(SOP_PACKS.map((pack) => [pack.skill_id, sopFunnelId(pack.stage_code)])),
};

export function skillFunnelId(id: string, category?: string, funnel?: string): FunnelId {
  if (funnel && FUNNEL_STAGES.some((stage) => stage.id === funnel)) return funnel as FunnelId;
  if (FUNNEL_BY_ID[id]) return FUNNEL_BY_ID[id];
  const c = category || "";
  if (/结算|归因|增长|预算/.test(c)) return "settle";
  if (/内容|大纲/.test(c)) return "content";
  if (/寄|物流|地址|采集/.test(c)) return "sample";
  if (/报价|商务|合同|邮件/.test(c)) return "biz";
  if (/跟进|意向|阶段/.test(c)) return "intent";
  if (/风险|超时|异常/.test(c)) return "exception";
  return "reach";
}

/** Compatibility shape for legacy Host callers; values come from SKILL.md. */
export type SkillEntry = {
  id: string;
  label: string;
  aliases: string[];
  in_market: boolean;
  category: string;
  profile: string;
  funnel: FunnelId;
  summary: string;
  source: "bundled" | "published";
  employee_visible: boolean;
};

export const SOP_POLICY = {
  operator_can_edit: false,
  owner: "admin",
  note: "技能说明在管理配置维护。运营在技能页只选用动作，不能改 SOP。",
  edit_path: "/admin",
} as const;

function marketFlags(): Map<string, boolean> {
  try {
    const rows = getConn().prepare("SELECT id, in_market FROM skill_flags").all() as { id: string; in_market: number }[];
    return new Map(rows.map((row) => [String(row.id), Number(row.in_market) === 1]));
  } catch {
    return new Map();
  }
}

let catalogCache: { definitions: ReturnType<typeof taskDefinitions>; entries: SkillEntry[] } | null = null;

export function skillCatalog(root?: string): SkillEntry[] {
  const definitions = taskDefinitions(root);
  if (catalogCache?.definitions === definitions) return catalogCache.entries;
  const flags = marketFlags();
  const entries = definitions.map((definition) => ({
    id: definition.id,
    label: definition.title,
    aliases: [...definition.aliases],
    in_market: flags.get(definition.id) ?? definition.in_market,
    category: definition.category,
    profile: definition.profile,
    funnel: skillFunnelId(definition.id, definition.category, definition.funnel),
    // 员工面优先用 employee_summary（业务专家填的业务语言）；缺省回落到引擎描述。
    summary: definition.employee_summary || definition.description,
    source: definition.source,
    employee_visible: definition.employee_visible,
  }));
  catalogCache = { definitions, entries };
  return entries;
}

/** Invalidate after publishing, deleting, or changing market visibility. */
export function clearSkillCatalogCache(): void {
  catalogCache = null;
}

/** Live catalog. Array methods always read the current bundled + published skills. */
export const SKILL_CATALOG: SkillEntry[] = new Proxy([] as SkillEntry[], {
  get(_target, prop) {
    const list = skillCatalog();
    const value = Reflect.get(list, prop, list);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(list) : value;
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(skillCatalog(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(skillCatalog());
  },
  has(_target, prop) {
    return Reflect.has(skillCatalog(), prop);
  },
});

export const SKILL_ROUTE: Record<string, { type: string; skill: string; needs: true }> = new Proxy(
  {} as Record<string, { type: string; skill: string; needs: true }>,
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const entry = skillCatalog().find((row) => row.id === prop);
      return entry ? { type: entry.id, skill: entry.id, needs: true as const } : undefined;
    },
  },
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namesFor(entry: SkillEntry): string[] {
  return [entry.label, ...entry.aliases];
}

export function mentionNamesLongestFirst(): { name: string; id: string }[] {
  const rows: { name: string; id: string }[] = [];
  for (const s of SKILL_CATALOG) {
    for (const name of namesFor(s)) rows.push({ name, id: s.id });
  }
  rows.sort((a, b) => b.name.length - a.name.length);
  return rows;
}

export function matchSkillId(text: string): string | null {
  const t = text || "";
  for (const { name, id } of mentionNamesLongestFirst()) {
    if (t.includes(`/${name}`) || t.includes(`@${name}`) || t.includes(name)) return id;
  }
  for (const s of SKILL_CATALOG) {
    if (new RegExp(`(^|\\s)[/@]${escapeRe(s.id)}(?=$|\\s)`, "i").test(t)) return s.id;
  }
  return null;
}

export function stripSkillMentions(text: string): string {
  let out = text || "";
  for (const { name } of mentionNamesLongestFirst()) {
    out = out.replace(new RegExp(`[/@]?${escapeRe(name)}`, "g"), " ");
  }
  for (const s of SKILL_CATALOG) {
    out = out.replace(new RegExp(`[/@]${escapeRe(s.id)}\\b`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export function isSkillHandleToken(token: string): boolean {
  const t = (token || "").replace(/^[/@]+/, "").trim();
  if (!t) return true;
  if (SKILL_CATALOG.some((s) => s.id.toLowerCase() === t.toLowerCase())) return true;
  if (mentionNamesLongestFirst().some((n) => n.name === t || n.name.startsWith(`${t} `))) return true;
  return false;
}

export function catalogPublic(): {
  id: string; title: string; label: string; aliases: string[]; in_market: boolean; category: string; profile: string; funnel: FunnelId; summary: string; source: "bundled" | "published";
}[] {
  return skillCatalog().map((s) => ({
    id: s.id,
    title: s.label,
    label: s.label,
    aliases: s.aliases,
    in_market: s.in_market,
    category: s.category,
    profile: s.profile,
    funnel: s.funnel,
    summary: s.summary,
    source: s.source,
  }));
}
