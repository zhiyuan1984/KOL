import type { InputRef } from "antd";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { isWriteSkill } from "../composer/catalog";
import { applyComposerDraft } from "../composer/draft";
import { skillFillText } from "../composer/skillFill";
import { RECOMMENDED_SKILL_IDS as RECOMMENDED_IDS } from "../composer/recommended";
import { rememberJourney } from "../journey";
import { type SkillRow } from "./SkillHub";
import { DEFAULT_SKILL_ICON, SKILL_ICON_LIBRARY } from "../skillIcons";

// 分组配置
// hint 只写组名说不出来的增量信息：`评估达人质量与合作可能性` 这类与组名同义的提示删掉
// （2026-09-23 UI/UX 裁定：列表上方两行字说同一件事＝噪声），渲染处按 hint 是否为空输出。
const GROUPS: { id: string; label: string; hint: string; funnel: string[] }[] = [
  { id: "reach", label: "建联阶段", hint: "寻找目标达人，建立初步联系", funnel: ["reach"] },
  { id: "intent", label: "意向评估", hint: "", funnel: ["intent"] },
  { id: "biz", label: "报价与寄样", hint: "", funnel: ["biz", "sample"] },
  { id: "settle", label: "成交与沉淀", hint: "完善合作并沉淀数据资产", funnel: ["settle"] },
  { id: "content", label: "内容发布", hint: "", funnel: ["content"] },
  { id: "exception", label: "异常旁路", hint: "风险扫描与异常处理", funnel: ["exception"] },
];

// 筛选条分两类（shadcn TabsList ×2）：
//   mode  = 取数口径（全部 / 常用 / 最近 / 推荐），彼此并列；
//   stage = 业务阶段漏斗（建联 → 意向 → 报价 → 寄样 → 成交 → 内容），有先后递进关系，
//           渲染时用 › 分隔，把这层递进显式表达出来（此前只是一排等权胶囊）。
const TABS: { id: string; label: string; kind: "mode" | "stage" }[] = [
  { id: "all", label: "全部", kind: "mode" },
  { id: "frequent", label: "常用", kind: "mode" },
  { id: "recent", label: "最近使用", kind: "mode" },
  { id: "recommend", label: "推荐", kind: "mode" },
  { id: "reach", label: "建联", kind: "stage" },
  { id: "intent", label: "意向", kind: "stage" },
  { id: "biz", label: "报价", kind: "stage" },
  { id: "sample", label: "寄样", kind: "stage" },
  { id: "settle", label: "成交", kind: "stage" },
  { id: "content", label: "内容发布", kind: "stage" },
];

const USAGE_KEY = "skill:usage";
const RECENT_KEY = "skill:recent";

function loadUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUsage(usage: Record<string, number>) {
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(recent: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function recordUsage(skillId: string) {
  const usage = loadUsage();
  usage[skillId] = (usage[skillId] || 0) + 1;
  saveUsage(usage);

  const recent = loadRecent().filter((id) => id !== skillId);
  recent.unshift(skillId);
  saveRecent(recent.slice(0, 20));
}

// 默认预览技能
const DEFAULT_SKILL_ID = "creator_outreach";




/**
 * 图标砖的类别色：按技能 md 声明的来源徽章（badge）分四类，未知一律回落「平台内置」（中性石墨）。
 * 依据 `docs/DESIGN.md` §颜色 的「类别」职责：只用于图标砖淡底 / 描边与砖内字形，
 * 不承担交互（选中 / 可点仍是辅助色）与状态（风险档仍走状态色 + 形状信号）。
 */
const SOURCE_TONE: Record<string, string> = {
  "达人库": "library",
  "AI 助理": "assistant",
  "平台采集": "crawl",
  "平台内置": "builtin",
};

function skillTone(skill: Pick<SkillRow, "badge">): string {
  return SOURCE_TONE[skillSource(skill)] || "builtin";
}

// 分组图标（SVG paths）
const GROUP_ICONS: Record<string, string> = {
  reach: "M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z",
  intent: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
  biz: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z",
  settle: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
  content: "M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15h14v2H5zm0-4h14v2H5zm0-4h14v2H5z",
  exception: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
};

function SkillIcon({ icon }: { icon?: string | null }) {
  const d = (icon && SKILL_ICON_LIBRARY[icon]) || DEFAULT_SKILL_ICON;
  return (
    <svg viewBox="0 0 24 24" className="skill-row-svg" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function GroupIcon({ id }: { id: string }) {
  const d = GROUP_ICONS[id] || GROUP_ICONS.reach;
  return (
    <svg viewBox="0 0 24 24" className="skill-group-svg" aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/**
 * 来源徽章：来自技能 md 的 `badge`，只用业务语言（specs/UX-EMPLOYEE.md 员工禁词）。
 * 未声明的技能一律落到中性词——兜底**不得**回落到引擎名或内部系统名。
 */
function skillSource(skill: Pick<SkillRow, "badge">): string {
  return skill.badge || "平台内置";
}

function skillOrigin(skill: SkillRow): "official" | "third_party" {
  return skill.origin === "third_party" ? "third_party" : "official";
}

/**
 * 工具风险档只区分「只读」与「需确认」两档。
 * 细分 L2（草稿）/ L3（敏感写入）须按 `docs/07-mcp-data-contract.md` 的工具风险目录逐条登记后再拆，
 * **不得按技能名猜**（AGENTS.md「凭文件名猜法律层级」禁令）。
 */
const RISK_LABEL: Record<"read" | "write", string> = { read: "只读", write: "需确认" };

/* 员工向词表：员工表面不摊引擎词（specs/UX-EMPLOYEE.md §员工禁词：MCP / Codex / Thread /
   英文 Skill 时序 / 原始堆栈）。下面四张表把接口返回的 id 翻成业务语言；查不到时回落到
   业务兜底，**绝不回落成原始 id**。 */
const ACTION_LABEL: Record<string, string> = {
  analyze: "读取授权范围内的信息并分析",
  present_sop: "展示这项技能的标准流程",
  update: "更新你指定的字段",
  sync: "同步最新数据",
  propose_stage: "生成阶段变更建议（需你确认）",
  create_draft: "生成草稿（需你确认）",
  create_approval: "发起审批（需你确认）",
  claim_follow: "认领跟进",
  compose_draft: "生成回复草稿",
  confirm_send: "发送前确认",
  confirm_stage: "阶段写入前确认",
  open_thread: "打开对应会话",
  release_follow: "释放跟进",
  handoff: "交接给同事",
  retry_sync: "失败后重试同步",
  none: "无额外步骤",
};

/* 产出词表：只登记有业务含义的产出名，查不到即「没有业务映射」。
   `task_result` 是引擎的默认兜底值（后端 `output` 字段没写时给的就是它），把「任务结果」
   印在员工面上等于没说，所以**不入表** —— 调用处据「查不到」不再输出「结果：…」。
   （员工禁词：引擎词连同它的修饰译名都不该出现在员工面，specs/UX-EMPLOYEE.md。） */
const OUTPUT_LABEL: Record<string, string> = {
  today_brief: "今日任务简报",
  propose_stage: "阶段变更建议",
  kol_analyze_brief: "达人分析简报",
  crawl_plan: "采集计划",
};

/**
 * 「使用步骤」的空样板有两种，都不渲染（2026-09-23 UI/UX 裁定）：
 *  1) 技能没登记 `actions` 时，后端 `backend/src/routers/misc.ts` 给的是同一段兜底话；
 *  2) 登记了 `actions` 但全是引擎通用动作（`analyze` / `present_sop` 之类），翻成业务语言后
 *     仍然只有一句放之四海皆准的话。
 */
const FALLBACK_STEPS = ["理解你的目标", "读取授权范围内的信息", "生成结果并展示依据"];

const GENERIC_STEP_LABELS = new Set([
  "读取授权范围内的信息并分析",
  "展示这项技能的标准流程",
  "无额外步骤",
]);

function isFallbackSteps(steps: string[]): boolean {
  return steps.length === FALLBACK_STEPS.length
    && steps.every((step, index) => step === FALLBACK_STEPS[index]);
}

const TOOL_LABEL: Record<string, string> = {
  "starry.get_collaboration": "合作记录查询",
  "starry.list_collaborations": "合作记录列表",
  "starry.deal_memory": "成交记忆",
  "starrykol.getKolProfileDetail": "达人详情",
  "starrykol.pageKolProfiles": "达人库分页查询",
  "starrykol.listAllKolProfiles": "达人库全量列表",
  "starrykol.getKolProfileSidebarMetrics": "达人库侧栏指标",
  "starrykol.addKolProfile": "新增达人",
  "starrykol.updateKolProfile": "更新达人资料",
  "starrykol.listKolPlatformData": "平台数据查询",
  "starrykol.decryptKolContact": "解密达人联系方式（受控）",
  "starrykol.pageRiskConversations": "风险对话列表",
  "starrykol.summarizeRiskConversations": "风险对话摘要",
  "starrykol.listRiskTagOptions": "风险标签字典",
  "starrykol.getStageRiskMatrix": "阶段风险矩阵",
  "starrykol.pageEmailConversations": "邮件会话列表",
  "starrykol.pageAppEmailConversations": "应用邮件会话",
  "starrykol.getEmailConversation": "邮件会话详情",
  "starrykol.getEmailConversationSubjectGroups": "邮件主题分组",
  "starrykol.translateEmailToChinese": "邮件翻译",
  "starrykol.previewEmailDraft": "邮件草稿预览",
  "starrykol.pageMailboxes": "邮箱列表",
  "starrykol.listNylasAccounts": "邮箱账号列表",
  "starrykol.pageLifecycleKanban": "生命周期看板",
  "starrykol.listCooperationStageOptions": "合作阶段字典",
  "starrykol.listDictionaryOptions": "业务字典查询",
  "kolclaw.list_creators": "达人任务列表",
  "kolclaw.get_daily_tasks": "每日任务",
  "kolclaw.get_budget_report": "预算报表",
};

const PERMISSION_LABEL: Record<string, string> = {
  "starrykol:read": "达人库读取",
  "starrykol:write": "达人库写入",
  "kolclaw:read": "业绩与任务读取",
  "claw:write": "业绩与任务写入",
};

/**
 * 员工面上的原始文本：已知动作 id 走词表翻成业务语言；已经是中文的说明原样保留；
 * 纯 ASCII 的未知 id 一律**不渲染**（员工表面不摊英文 Skill 时序与字段名，
 * specs/UX-EMPLOYEE.md §员工禁词）。步骤与「需要你提供」共用同一条规则。
 */
function employeeText(value: string): string {
  return ACTION_LABEL[value] ?? (/^[\x20-\x7E]+$/.test(value) ? "" : value);
}

/** 工具行名称：业务名优先，其次动作词表，最后只留连接器 / 平台动作 —— 不摊原始 ref。 */
function toolLabel(ref: string, kind?: string): string {
  return TOOL_LABEL[ref] || ACTION_LABEL[ref] || (kind === "mcp" ? "平台连接器" : "平台动作");
}

/**
 * 异步作业：同一时间只跑一个，必须有进度 / 取消 / 重试。
 * 依据 `docs/07-mcp-data-contract.md`「MediaCrawler 是异步作业…不得把它伪装成同步 Skill」。
 */
const ASYNC_SKILL_IDS = new Set(["creator_discovery"]);


function SkillCard({
  skill,
  onSelect,
  isFrequent,
  selected,
}: {
  skill: SkillRow;
  onSelect: (skill: SkillRow) => void;
  isFrequent: boolean;
  selected: boolean;
}) {
  const tier = isWriteSkill(skill) ? "write" : "read";
  const isAsync = ASYNC_SKILL_IDS.has(skill.id);
  // 规则 10「只标例外」：只读是默认态，不标注。文字标记只留 L3「需确认」；异步不再挂文字标签
  // （2026-09-23 UI/UX 裁定），改由图标砖虚线边框承担形状信号 —— 本页动作是「填入输入框」，
  // 不执行作业，执行面契约未变（docs/07-mcp-data-contract.md）。
  const marks: { cls: string; text: string }[] = [];
  if (tier === "write") marks.push({ cls: "is-write", text: RISK_LABEL.write });
  return (
    <div
      className={
        "skill-row"
        + (selected ? " is-selected" : "")
        + (tier === "write" ? " is-write" : "")
        + (isAsync ? " is-async" : "")
      }
      data-skill-id={skill.id}
      onClick={() => onSelect(skill)}
    >
      {/* 图标砖的类别色走 data-tone（docs/DESIGN.md §颜色 · 类别职责）。 */}
      <div className="skill-row-icon" data-tone={skillTone(skill)}>
        <SkillIcon icon={skill.icon} />
      </div>
      {/* 名称是行的键盘可达入口，同时暴露选中态（选中只靠颜色不合规，docs/DESIGN.md §不变量 4）。
          ★ 只在非「常用」分组出现——那一组整块都是常用，逐行再标一次等于把例外信号用成装饰。 */}
      <button
        type="button"
        className="skill-row-name"
        aria-pressed={selected}
        onClick={() => onSelect(skill)}
      >
        <span className="skill-row-name-text">{skill.title}</span>
        {isFrequent && <span className="skill-row-star" aria-hidden>★</span>}
      </button>
      {/* 描述缺失或与标题相同时不渲染：同一信息不重复出现（不变量 6）。 */}
      {skill.summary && skill.summary !== skill.title && (
        <p className="skill-row-desc">{skill.summary}</p>
      )}
      {marks.length > 0 && (
        <div className="skill-row-marks">
          {marks.map((m) => (
            <span key={m.cls} className={"skill-mark " + m.cls}>{m.text}</span>
          ))}
        </div>
      )}
      {/* 行内不再有动作（2026-09-23 UI/UX 裁定）：51 行 × 每行一个「填入输入框」既是噪声，
          也把唯一的主 CTA 稀释成 51 个。行只负责「选中 / 预览」，填技能只剩右栏详情列的实底主 CTA；
          键盘路径因此是 行名 → 下一行行名（不用跨过每行的第二个焦点）。 */}
    </div>
  );
}

/** 展开 / 收窄的语义图标：向外箭头＝展开，向内箭头＝收窄。 */
function ExpandIcon({ wide }: { wide: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="skill-detail-toggle-svg" aria-hidden>
      <path
        d={
          wide
            ? "M20 10h-6V4M4 14h6v6M14 10 20 4M10 14 4 20"
            : "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 关闭图标：用 SVG，并落在本页图标阶梯（--icon-sm / --icon-md）里。 */
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="skill-detail-close-svg" aria-hidden>
      <path
        d="M6.5 6.5l11 11M17.5 6.5l-11 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 未登记入口口径的技能（`backend/skills/` 里没有 `employee_quick` / `employee_agent` 的那 6 个）：
 * 措辞照 `docs/BUSINESS.md`「快捷查询与思考覆盖表」的登记原文 —— 待业务专家补齐，不给推测口径。
 */
const ENTRY_PENDING = "这项技能的业务入口口径待业务专家补齐，不给出推测口径";

/**
 * 说明书：选中时按 id 拉一次 `GET /skills/:id` 的 `employee_doc`（后端从该技能 SKILL.md 的
 * `## 员工口径` 小节抽正文并过白名单）。拿不到就保持空串，调用处据空串整节不渲染。
 * 状态带上 id，切技能时绝不会把上一项的说明书挂到这一项下面。
 */
function useEmployeeDoc(id: string): string {
  const [doc, setDoc] = useState<{ id: string; text: string }>({ id: "", text: "" });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.skill(id)
      .then((data: unknown) => {
        const value = (data as { employee_doc?: unknown } | null)?.employee_doc;
        if (alive) setDoc({ id, text: typeof value === "string" ? value : "" });
      })
      .catch(() => {
        if (alive) setDoc({ id, text: "" });
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return doc.id === id ? doc.text : "";
}

/**
 * 说明书正文：只认服务端约定好的 Markdown 子集（`###` 小标题 / `-` 列表 / 段落）。
 * 一行一段 —— 服务端的白名单就是按段抽的，这里不合并、不再做二次猜测，也不解析 HTML。
 */
type DocBlock = { kind: "heading" | "list" | "paragraph"; lines: string[] };

function parseDocBlocks(text: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const last = blocks[blocks.length - 1];
    if (line.startsWith("### ")) blocks.push({ kind: "heading", lines: [line.slice(4).trim()] });
    else if (line.startsWith("- ")) {
      if (last?.kind === "list") last.lines.push(line.slice(2).trim());
      else blocks.push({ kind: "list", lines: [line.slice(2).trim()] });
    } else blocks.push({ kind: "paragraph", lines: [line] });
  }
  return blocks;
}

function EmployeeDoc({ text, maxBlocks }: { text: string; maxBlocks?: number }) {
  const blocks = parseDocBlocks(text);
  const shown = maxBlocks === undefined ? blocks : blocks.slice(0, maxBlocks);
  return (
    <>
      {shown.map((block, index) => {
        if (block.kind === "heading") {
          return <p className="skill-doc-heading" key={index}>{block.lines[0]}</p>;
        }
        if (block.kind === "list") {
          return (
            <ul className="skill-doc-list" key={index}>
              {block.lines.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          );
        }
        return <p className="skill-doc-para" key={index}>{block.lines[0]}</p>;
      })}
    </>
  );
}

/**
 * 装配 Agent（只读投影）：该技能经由哪些数字员工可用。
 * 后端 `GET /api/skills/:id/agents` 只返回调用者有资格使用的已发布 Agent（id＋name），
 * 拿不到就保持空数组 —— 调用处据"未加载"不渲染整节，不拿空壳冒充。
 * 依据 IA §2#4：技能面回答"当前有资格使用的 Agent 装配了哪项能力"。
 */
function useSkillAgents(id: string): { agents: Array<{ id: string; name: string }>; loaded: boolean } {
  const [state, setState] = useState<{ id: string; agents: Array<{ id: string; name: string }> }>({ id: "", agents: [] });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoaded(false);
    api.skillAgents(id)
      .then((data: unknown) => {
        const agents = (data as { agents?: unknown } | null)?.agents;
        if (alive) {
          setState({
            id,
            agents: Array.isArray(agents)
              ? agents.filter((a): a is { id: string; name: string } =>
                  typeof a === "object" && a !== null
                  && typeof (a as { id: unknown }).id === "string"
                  && typeof (a as { name: unknown }).name === "string")
              : [],
          });
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) {
          setState({ id, agents: [] });
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return state.id === id ? { agents: state.agents, loaded } : { agents: [], loaded: false };
}

/** 一行提示：前缀一个小图标（走本页图标阶梯的 --icon-sm），替代原先的大块浅底 callout。 */
function DetailHint({ children }: { children: ReactNode }) {
  return (
    <p className="skill-detail-hint">
      <svg viewBox="0 0 24 24" className="skill-detail-hint-svg" aria-hidden>
        <path
          d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-5h2v2h-2v-2zm0-7h2v5h-2V8z"
          fill="currentColor"
        />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function SkillDetail({
  skill,
  onInsert,
  wide,
  onToggleWide,
  onClose,
}: {
  skill: SkillRow | null;
  onInsert: (skill: SkillRow) => void;
  wide: boolean;
  onToggleWide: () => void;
  onClose: () => void;
}) {
  // 说明书：选中时按 id 拉一次；拉不到、或后端在技能文件里找不到 `## 员工口径` 小节的正文，
  // 都得到空串 —— 那一节整节不渲染，不做 loading 假动作、也不拿空壳冒充说明书。
  const doc = useEmployeeDoc(skill?.id || "");
  // 装配 Agent：选中时按 id 拉一次（只读投影，只含调用者有资格使用的已发布 Agent）。
  const { agents, loaded: agentsLoaded } = useSkillAgents(skill?.id || "");
  // 说明书默认折叠：详情正文按决策顺序排，说明书是参考材料，首屏只给前两段。
  const [docOpen, setDocOpen] = useState(false);
  useEffect(() => {
    setDocOpen(false);
  }, [skill?.id]);

  if (!skill) {
    return (
      <div className="skill-detail-empty">
        <p>在左侧选择一项技能，这里会展开它的用法、需要你提供的信息和产出。</p>
      </div>
    );
  }

  const tier = isWriteSkill(skill) ? "write" : "read";
  const isAsync = ASYNC_SKILL_IDS.has(skill.id);
  const learning = skill.learning;
  const execution = skill.execution;
  // 入口口径与示例：逐字来自该技能自己的 SKILL.md（`employee_quick` / `employee_agent` /
  // `employee_example`），页面不再手抄一份 —— 文件是员工面的唯一真相。
  const quick = skill.employee_quick || "";
  const agent = skill.employee_agent || "";
  const inputs = (learning?.inputs || []).map(employeeText).filter(Boolean);
  const examples = skill.employee_example || [];
  // 产出：只印词表里的业务语言。查不到（含引擎兜底值 `task_result`）就不渲染这一节 ——
  // 旧实现直出 `skill.output`，会把引擎词印到员工面上。
  const outputLabel = skill.output ? OUTPUT_LABEL[skill.output] : undefined;
  // 步骤与输入项走同一条规则：已知动作 id → 业务语言；已经是中文的原样保留；纯 ASCII 的未知 id
  // **不渲染**（员工表面不摊英文 Skill 时序与字段名，specs/UX-EMPLOYEE.md §员工禁词）。
  const rawSteps = learning?.steps || [];
  const steps = rawSteps.map(employeeText).filter(Boolean);
  // 空样板（后端兜底 / 只剩引擎通用动作翻出来的话）不含这项技能自己的信息 → 不渲染「使用步骤」。
  const showSteps = Boolean(learning)
    && steps.length > 0
    && !isFallbackSteps(rawSteps)
    && !steps.every((step) => GENERIC_STEP_LABELS.has(step));
  // 「结果」只在 learning.result 有业务映射时才说（`task_result` 不在词表里 → 这半句不发）。
  const resultLabel = learning?.result ? OUTPUT_LABEL[learning.result] : undefined;
  // 示例与说明书都没补录 → 一行说明，不把空壳说成完整（CONST-10 实施诚实）。
  const missingSample = examples.length === 0 && !doc;

  return (
    <div className="skill-detail" data-skill-detail>
      {/* 三段式：头（图标 + 名 + 展开/关闭 + 标签行，固定）/ 正文（自己滚）/ 底（唯一实底 CTA，
          固定），段与段之间各一条发丝线。正文滚动时头与底不动。 */}
      <div className="skill-detail-head">
        <div className="skill-detail-title">
          <div className="skill-row-icon" data-tone={skillTone(skill)}>
            <SkillIcon icon={skill.icon} />
          </div>
          <h2>{skill.title}</h2>
          <button
            type="button"
            className="skill-detail-toggle"
            aria-expanded={wide}
            aria-label={wide ? "收窄技能详情" : "展开技能详情"}
            title={wide ? "收窄" : "展开"}
            onClick={onToggleWide}
          >
            <ExpandIcon wide={wide} />
          </button>
          <button
            type="button"
            className="skill-detail-close"
            aria-label="关闭技能详情"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* 只标例外：来源只在第三方时标注（官方是默认态）；「自建/技能」是治理语言，不进员工面。 */}
        <div className="skill-detail-marks">
          {skillOrigin(skill) === "third_party" && (
            <span className="skill-detail-chip is-source">第三方</span>
          )}
          <span className={"skill-mark is-" + tier}>{RISK_LABEL[tier]}</span>
          {isAsync && <span className="skill-mark is-async">异步 · 可取消</span>}
          {/* 内部技能：由 pipeline / 定时任务 / 旅程调用，不在提问框的可选清单里出现。 */}
          {skill.employee_visible === false && <span className="skill-mark" data-skill-internal>内部</span>}
        </div>
      </div>

      <div className="skill-detail-body">

        {/* 段落次序按员工的决策顺序排：先回答「经由哪个数字员工能用 / 我自己能查到什么 /
            哪些要找人」，再是「我要准备什么 / 能拿到什么 / 怎么用」，最后是能力边界与调用关系。 */}
        {/* 装配 Agent：IA §2#4 要求技能面回答"当前有资格使用的 Agent 装配了哪项能力"。
            未加载完成时不渲染整节，不拿空壳占位。 */}
        {agentsLoaded && (
          <div className="skill-detail-section">
            <h4>可经由以下数字员工使用</h4>
            {agents.length > 0 ? (
              <div className="skill-detail-tags">
                {agents.map((a) => (
                  <span key={a.id} className="skill-detail-chip is-agent">{a.name}</span>
                ))}
              </div>
            ) : (
              <p className="skill-detail-value muted">暂无数字员工装配此技能</p>
            )}
          </div>
        )}

        {quick && (
          <div className="skill-detail-section">
            <h4>可以直接查到</h4>
            <p className="skill-detail-value">{quick}</p>
          </div>
        )}

        {agent && (
          <div className="skill-detail-section">
            <h4>需要走确认或 AI 助理</h4>
            <p className="skill-detail-value">{agent}</p>
          </div>
        )}

        {/* 未登记入口口径的技能（docs/BUSINESS.md 覆盖表没列）不给推测口径，
            照实说明待业务专家补齐 —— 页面不替它编一句。 */}
        {!quick && !agent && <p className="skill-detail-hint">{ENTRY_PENDING}</p>}

        {inputs.length > 0 && (
          <div className="skill-detail-section">
            <h4>需要你提供</h4>
            <div className="skill-detail-tags">
              {inputs.map((s) => (
                <span key={s} className="skill-detail-chip">{s}</span>
              ))}
            </div>
          </div>
        )}

        {outputLabel && (
          <div className="skill-detail-section">
            <h4>产出</h4>
            <div className="skill-detail-tags">
              <span className="skill-detail-chip">{outputLabel}</span>
            </div>
          </div>
        )}

        {showSteps && (
          <div className="skill-detail-section">
            <h4>使用步骤</h4>
            <ol className="skill-detail-steps">
              {steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
            </ol>
          </div>
        )}

        {learning && (
          <div className="skill-detail-section">
            <h4>执行边界</h4>
            {/* 标签 + 值同行：label 走 12px muted，value 走 13px 墨色，不再一 label 一 value 竖排两行。 */}
            {resultLabel && (
              <p className="skill-detail-field">
                <span className="skill-detail-field-label">结果</span>
                <span className="skill-detail-value">{resultLabel}</span>
              </p>
            )}
            <p className="skill-detail-field">
              <span className="skill-detail-field-label">确认</span>
              <span className="skill-detail-value">{learning.confirmation || "按当前权限执行"}</span>
            </p>
          </div>
        )}

        {/* 说明书：正文来自该技能 SKILL.md 的 `## 员工口径` 小节（服务端已按白名单整段滤掉
            含引擎系统词 / JSON 片段 / 英文 snake_case id 的段落）。为空则整节不渲染。
            默认折叠只给前两段：正文是参考材料，不挤占决策信息的首屏（L3 文字按钮展开）。 */}
        {(doc || examples.length > 0) && (
          <div className="skill-detail-section">
            <h4>说明书</h4>
            {doc && <EmployeeDoc text={doc} maxBlocks={docOpen ? undefined : 2} />}
            {docOpen && examples.length > 0 && (
              <>
                <h4 className="skill-doc-subhead">示例</h4>
                <ul className="skill-detail-examples">
                  {examples.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                </ul>
              </>
            )}
            {/* 折叠态藏起了内容（正文超两段，或示例被收起）才给展开入口。 */}
            {(doc ? parseDocBlocks(doc).length > 2 : false) || examples.length > 0 ? (
              <button
                type="button"
                className="skill-text-btn"
                aria-expanded={docOpen}
                onClick={() => setDocOpen((v) => !v)}
              >
                {docOpen ? "收起说明书" : "展开说明书"}
              </button>
            ) : null}
          </div>
        )}

        {execution && (
          <details className="skill-execution-details">
            <summary>查看调用关系与安全边界</summary>
            {/* 调用工具 / 所需权限条目化：一行一个（名称 + 风险档 chip），不再堆成长段。 */}
            <div className="skill-detail-section">
              <h4>调用工具</h4>
              {execution.tools?.length ? (
                <div className="skill-execution-list">
                  {execution.tools.map((tool, index) => (
                    <div className="skill-execution-row" key={`${tool.ref}-${index}`}>
                      <span className="skill-execution-row-name">{toolLabel(tool.ref || "", tool.kind)}</span>
                      {/* 线值仍是工具风险目录的 `L1`/`L3`（`docs/07-mcp-data-contract.md` 数据契约）；
                          展示名按 DESIGN.md v3 翻成 R1/R3 —— 只改展示，不改契约。 */}
                      <span className={"skill-mark" + (tool.risk === "L3" ? " is-write" : "")}>
                        {tool.risk === "L3" ? "R3 · 执行前确认" : "R1 · 只读"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="skill-detail-value">这项技能当前不直接调用外部工具。</p>}
            </div>
            {execution.permissions?.length ? (
              <div className="skill-detail-section">
                <h4>所需权限</h4>
                <div className="skill-execution-list">
                  {execution.permissions.map((permission) => {
                    const write = permission.endsWith(":write");
                    return (
                      <div className="skill-execution-row" key={permission}>
                        <span className="skill-execution-row-name">
                          {PERMISSION_LABEL[permission] || (write ? "业务数据写入" : "业务数据读取")}
                        </span>
                        <span className={"skill-mark" + (write ? " is-write" : "")}>
                          {write ? "R3 · 执行前确认" : "R1 · 只读"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {execution.async?.enabled && (
              <div className="skill-detail-section">
                <h4>异步执行</h4>
                <p className="skill-detail-value">
                  {execution.async.status || "需要查看进度"}；
                  {execution.async.cancelable ? "支持取消" : "不支持取消"}；
                  {execution.async.retryable ? "支持重试" : "不支持重试"}。
                </p>
              </div>
            )}
            <div className="skill-detail-section">
              <h4>回执</h4>
              <p className="skill-detail-value">
                {execution.receipt_required ? "受控动作会留下执行回执。" : "当前没有登记需要回执的正式写入动作。"}
              </p>
            </div>
          </details>
        )}

        {/* 长说明收成一行 muted 提示（前缀一个小图标），不再用大块浅底 callout 占版面。 */}
        {missingSample && (
          <DetailHint>示例与说明书还没补录，口径来自技能登记本身。</DetailHint>
        )}
        {skill.keeps_stage && (
          <DetailHint>不推进正式阶段，改阶段请另走「正式阶段变更」。</DetailHint>
        )}
        {isAsync && (
          <DetailHint>异步作业，同一时间只跑一个；有进度、取消与重试入口。</DetailHint>
        )}
        {tier === "write" && (
          <DetailHint>受控动作：执行前揭示对象与范围、要求确认，并留下回执。</DetailHint>
        )}
      </div>

      <div className="skill-detail-footer">
        {/* 本视口唯一的实底主 CTA（docs/DESIGN.md §不变量 1）。动作名与列表行统一为「填入输入框」；
            「新建会话」已按 §不变量 2（先补参数再外发）移除。
            内部技能不在提问框可选清单里：即使经深链进入，CTA 也保持禁用并说明去向。 */}
        <button
          type="button"
          className="skill-btn skill-btn-primary skill-btn-large"
          title={
            skill.employee_visible === false
              ? "内部技能仅供流程调用，不在提问框的可选清单中"
              : "把这项技能填进输入框，补完参数后由你发送"
          }
          disabled={skill.employee_visible === false}
          onClick={() => onInsert(skill)}
        >
          填入输入框
        </button>
      </div>
    </div>
  );
}

export function SkillCatalog() {
  const location = useLocation();
  const nav = useNavigate();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  // tab 与 URL 同步：`/skills?tab=frequent` 这类深链（「查看全部」链接）必须真正生效。
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") || "all");
  const [selectedSkill, setSelectedSkill] = useState<SkillRow | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>(() => loadUsage());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [reloadKey, setReloadKey] = useState(0);
  // 详情列：`detailWide` 控制宽度档；`detailOpen` 只在窄屏的覆盖态下起作用（≥900px 常驻）。
  const [detailWide, setDetailWide] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const searchRef = useRef<InputRef | null>(null);

  // 选中技能＝同时展开详情；窄屏下这一步才会把覆盖层打开。
  const selectSkill = (s: SkillRow) => {
    setSelectedSkill(s);
    setDetailOpen(true);
  };

  // `/` 聚焦搜索（工作台惯例）：输入框内按键不劫持。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setTab(new URLSearchParams(location.search).get("tab") || "all");
  }, [location.search]);

  useEffect(() => {
    setLoading(true);
    api.skills()
      .then((data: unknown) => {
        const rows = Array.isArray(data) ? (data as SkillRow[]) : [];
        setSkills(rows);
        setErr("");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载技能目录"))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  // 内部技能（employee_visible=false）：由 pipeline / 定时任务 / 旅程调用，
  // 不在提问框的可选清单里出现 —— 目录默认过滤，不把不可用的能力递到员工手里。
  const visibleSkills = useMemo(
    () => skills.filter((s) => s.employee_visible !== false),
    [skills],
  );
  const hiddenInternalCount = skills.length - visibleSkills.length;

  // 默认预览：优先选中达人建联话术，其次常用技能第一个
  useEffect(() => {
    if (visibleSkills.length > 0 && !selectedSkill) {
      const preferred = visibleSkills.find((s) => s.id === DEFAULT_SKILL_ID);
      if (preferred) {
        setSelectedSkill(preferred);
        return;
      }
      const frequent = visibleSkills.filter((s) => RECOMMENDED_IDS.includes(s.id));
      setSelectedSkill(frequent[0] || visibleSkills[0]);
    }
  }, [visibleSkills, selectedSkill]);

  const filteredSkills = useMemo(() => {
    let list = visibleSkills;

    if (tab === "frequent") {
      list = list.filter((s) => (usage[s.id] || 0) > 0).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
    } else if (tab === "recent") {
      list = recent.map((id) => visibleSkills.find((s) => s.id === id)).filter(Boolean) as SkillRow[];
    } else if (tab === "recommend") {
      list = list.filter((s) => RECOMMENDED_IDS.includes(s.id));
    } else if (tab !== "all") {
      list = list.filter((s) => s.funnel === tab);
    }

    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.summary || "").toLowerCase().includes(needle) ||
        (s.label || "").toLowerCase().includes(needle)
      );
    }

    return list;
  }, [visibleSkills, tab, q, usage, recent]);

  const groupedSkills = useMemo(() => {
    const groups: Record<string, SkillRow[]> = {};
    for (const group of GROUPS) {
      groups[group.id] = filteredSkills.filter((s) => group.funnel.includes(s.funnel || ""));
    }
    return groups;
  }, [filteredSkills]);

  // 「使用」＝ 只把技能挂到工作台 Composer 上：用户还能补完 Prompt 再自己发送。
  // 不提供「直接开新会话」——部分技能需要先填参数，且外发属 L3，不能由「使用技能」一步完成
  // （docs/DESIGN.md 员工端实施细则 §不变量 2）。
  const useSkill = (skill: SkillRow) => {
    // 内部技能不在提问框的可选清单：即使 CTA 被绕过也不填入（纵深防御）。
    if (skill.employee_visible === false) return;
    recordUsage(skill.id);
    setUsage(loadUsage());
    setRecent(loadRecent());
    rememberJourney({ kind: "skill", skillId: skill.id, skillLabel: skill.label || skill.title });
    applyComposerDraft({
      text: skillFillText(skill),
      skill_template: skill.ui_template,
      chips: [{
        kind: "skill",
        id: skill.id,
        label: skill.label || skill.title,
        write: isWriteSkill(skill),
      }],
    });
    nav("/");
  };

  return (
    <div className="skill-catalog-page" data-skill-catalog>
      {err && (
        <div className="skill-state" role="alert">
          <p className="error">{err}</p>
          <button
            type="button"
            className="skill-btn skill-btn-outline"
            onClick={() => setReloadKey((n) => n + 1)}
          >
            重试
          </button>
        </div>
      )}
      {loading && !err && (
        <div className="skill-state" aria-busy="true">
          <p className="muted">正在加载技能…</p>
        </div>
      )}

      <div className="skill-catalog-main">
        {/* 栏 2：技能目录。顶部是「技能目录 + N 项」（吸顶），下面是两个成组控件容器
            （shadcn `TabsList` ×2：口径 / 阶段，容器承担成组控件的可见边界）。
            ≥1280 时这一栏是左栏（纵向）；1024–1279 折成栏 3 顶部的横向筛选条。 */}
        <div className="skill-tabs" role="group" aria-label="技能筛选">
          {/* 页头整条删除（2026-09-23）：标题 + 计数只是这一栏的栏头，横跨三栏的一行
              既占高度、又与筛选条隔开了它描述的列表。计数跟着筛选与搜索实时变。 */}
          <div className="skill-catalog-title">
            <h1>技能目录</h1>
            {!loading && <span className="skill-catalog-count">{filteredSkills.length} 项</span>}
          </div>
          {(["mode", "stage"] as const).map((kind) => (
            <div key={kind} className="skill-tabs-list" data-kind={kind}>
              {TABS.filter((t) => t.kind === kind).map((t, i) => (
                <Fragment key={t.id}>
                  {kind === "stage" && i > 0 && (
                    <span className="skill-tab-sep" aria-hidden>›</span>
                  )}
                  <button
                    type="button"
                    className={`skill-tab${tab === t.id ? " on" : ""}`}
                    aria-pressed={tab === t.id}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                </Fragment>
              ))}
            </div>
          ))}
          {/* 窄屏下这排 tab 会横向滚动：右缘渐隐是「还有内容」的可视信号（sticky 在滚动容器内）。
              ≥1280 的纵向左栏不需要它（放得下就没有溢出可言）。 */}
          <span className="skill-tabs-fade" aria-hidden />
        </div>

        <div className="skill-catalog-content">
          {/* 搜索行 sticky 在列表列的滚动口上：搜的是下面这份列表，两者不该被筛选栏隔开。 */}
          <div className="skill-search-row">
            <WorkspaceSearchInput
                ref={searchRef}
                className="skill-search-wrap skill-search"
                placeholder="搜索技能 / SOP / 场景"
                aria-label="搜索技能 / SOP / 场景"
                title="按 / 快速聚焦搜索"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
          </div>

          {GROUPS.map((group) => {
            const groupSkills = groupedSkills[group.id] || [];
            if (groupSkills.length === 0) return null;
            return (
              <section key={group.id} className="skill-group">
                <div className="skill-group-header">
                  <span className="skill-group-icon">
                    <GroupIcon id={group.id} />
                  </span>
                  <h2>{group.label}</h2>
                  {/* hint 只在与组名有增量信息时才输出（同义的提示是噪声）。 */}
                  {group.hint && <span className="skill-group-hint">{group.hint}</span>}
                  {/* 深链进来时（tab 已是本组）不再渲染指向自己的「查看全部」。 */}
                  {tab !== group.id && (
                    <Link to={`/skills?tab=${group.id}`} className="skill-group-more">查看全部</Link>
                  )}
                </div>
                <div className="skill-list">
                  {groupSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      onSelect={selectSkill}
                      isFrequent={(usage[s.id] || 0) > 0}
                      selected={selectedSkill?.id === s.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {/* 内部技能不进目录：照实说明数量与去向（CONST-10 实施诚实），不在此渲染它们。 */}
          {!loading && hiddenInternalCount > 0 && (
            <p className="skill-internal-note">
              {hiddenInternalCount} 项内部技能仅供流程调用，已从目录隐藏
            </p>
          )}

          {!loading && filteredSkills.length === 0 && (
            <div className="skill-state">
              <p className="muted">没有匹配的技能</p>
              <button
                type="button"
                className="skill-btn skill-btn-outline"
                onClick={() => {
                  setQ("");
                  setTab("all");
                  nav("/skills");
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={"skill-detail-scrim" + (detailOpen ? " is-open" : "")}
          aria-label="关闭技能详情"
          onClick={() => setDetailOpen(false)}
        />
        <aside
          className={
            "skill-detail-pane" + (detailWide ? " is-wide" : "") + (detailOpen ? " is-open" : "")
          }
          aria-label="技能详情"
        >
          <SkillDetail
            skill={selectedSkill}
            onInsert={(s) => void useSkill(s)}
            wide={detailWide}
            onToggleWide={() => setDetailWide((v) => !v)}
            onClose={() => setDetailOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
}
