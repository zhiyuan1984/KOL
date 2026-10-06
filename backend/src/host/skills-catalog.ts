import fs from "node:fs";
import { getConn } from "../db.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";

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


export function skillFunnelId(id: string, category?: string, funnel?: string): FunnelId {
  // 漏斗由技能 md 声明；只有没声明时才按分类推断（新建技能表单的默认值）。
  if (funnel && FUNNEL_STAGES.some((stage) => stage.id === funnel)) return funnel as FunnelId;
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
  /** 员工面两段口径与示例：逐字来自 SKILL.md，未登记的技能不带这几个键。 */
  employee_quick?: string;
  employee_agent?: string;
  employee_example?: string[];
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
    employee_quick: definition.employee_quick,
    employee_agent: definition.employee_agent,
    employee_example: definition.employee_example ? [...definition.employee_example] : undefined,
  }));
  catalogCache = { definitions, entries };
  return entries;
}

/** Invalidate after publishing, deleting, or changing market visibility. */
export function clearSkillCatalogCache(): void {
  catalogCache = null;
}

/* ── 说明书：`## 员工口径` 小节的正文 ────────────────────────────────────
   员工面要的「说明书」只能来自技能文件自己写的员工口径，不把 SKILL.md 原文整段发给前端
   （原文里混着引擎实现细节，CONST-10：不拿实现说明冒充员工说明）。
   抽取范围是 Markdown 子集：段落 / `-` 列表项 / `###` 小标题。
   服务端过白名单，整段丢弃含引擎系统词、JSON 片段或英文 snake_case id 的段落 ——
   宁可少一段，也不能把引擎词漏到员工面。没有这一节就返回空字符串。 */

const EMPLOYEE_DOC_ENGINE_WORDS = /MCP|Codex|Thread|MediaCrawler|Starry|Nylas|Host|kolclaw|starrykol|task_result/i;
const EMPLOYEE_DOC_SNAKE_CASE = /[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+/;

function blockedEmployeeDocBlock(block: string): boolean {
  return /[{}]/.test(block) || EMPLOYEE_DOC_ENGINE_WORDS.test(block) || EMPLOYEE_DOC_SNAKE_CASE.test(block);
}

/** 段落＝空行分隔的块；列表块按行（一项一段）过滤，坏的那一项不连坐整张列表。 */
export function employeeDocFromText(text: string): string {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "## 员工口径");
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    body.push(line);
  }
  const kept: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (!block.length) return;
    const isList = block.every((line) => line.trimStart().startsWith("- "));
    const parts = isList ? block.map((line) => [line]) : [block];
    for (const part of parts) {
      const para = part.join("\n").trim();
      if (para && !blockedEmployeeDocBlock(para)) kept.push(para);
    }
    block = [];
  };
  for (const line of body) {
    if (line.trim()) block.push(line);
    else flush();
  }
  flush();
  return kept.join("\n\n");
}

/** `GET /skills/:id` 的员工说明书正文；技能不存在或没写这一节时是空字符串。 */
export function skillEmployeeDoc(id: string): string {
  const definition = taskDefinition(id);
  if (!definition) return "";
  try {
    return employeeDocFromText(fs.readFileSync(definition.path, "utf8"));
  } catch {
    return "";
  }
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
