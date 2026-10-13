import type { InputRef } from "antd";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Select } from "antd";
import { useAccount } from "../components/AuthGate";
import CompactButton from "../components/CompactButton";
import { KnowledgeBrowseWorkspace, KnowledgeFilterBar, BrowseListRow, ListLoadFooter, BrowseDetailHeader, DetailActionBar } from "../components/KnowledgeBrowse";
import { FilterRow, FilterOptionButton, FilterAction } from "../components/KnowledgeFilterControls";
import { PropertyList } from "../components/InformationLayout";
import AssetTaskAction from "../components/AssetTaskAction";
import { useBrowseRows } from "../components/useBrowseRows";
import { readBrowseMemory, useBrowseMemory } from "../components/browseMemory";
import "../knowledge-page.css";
import "../knowledge-browse.css";
import "../asset-browse.css";
import "./global-layout-knowledge.css";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { isWriteSkill } from "../composer/catalog";
import { skillFillText } from "../composer/skillFill";
import { RECOMMENDED_SKILL_IDS as RECOMMENDED_IDS } from "../composer/recommended";
import { type SkillRow } from "./SkillHub";

// 分组配置
// hint 只写组名说不出来的增量信息：`评估达人质量与合作可能性` 这类与组名同义的提示删掉
// （2026-09-23 UI/UX 裁定：列表上方两行字说同一件事＝噪声），渲染处按 hint 是否为空输出。
const GROUPS: { id: string; label: string; hint: string; funnel: string[] }[] = [
  { id: "reach", label: "建联阶段", hint: "寻找目标达人，建立初步联系", funnel: ["reach"] },
  { id: "intent", label: "意向评估", hint: "", funnel: ["intent"] },
  // 接口现行 funnel（见 SkillHub.FUNNEL）将 biz 与 sample 分开返回；目录分组和筛选也按这两个
  // 原始值一一对应，不能用一个前端别名把寄样误并到报价。
  { id: "biz", label: "报价", hint: "", funnel: ["biz"] },
  { id: "sample", label: "寄样", hint: "", funnel: ["sample"] },
  { id: "settle", label: "成交与沉淀", hint: "完善合作并沉淀数据资产", funnel: ["settle"] },
  { id: "content", label: "内容发布", hint: "", funnel: ["content"] },
  { id: "exception", label: "异常旁路", hint: "风险扫描与异常处理", funnel: ["exception"] },
];

// 筛选条分两类，状态彼此独立：使用范围（mode）决定取哪份集合；业务场景（stage）在该集合上
// 再按接口返回的 funnel 缩小范围。二者不能复用一个 tab，否则「常用 + 寄样」会被覆盖成单一筛选。
const MODE_IDS = ["all", "favorites", "viewed", "frequent", "recent", "recommend"] as const;
const STAGE_IDS = ["all", "reach", "intent", "biz", "sample", "settle", "content", "exception"] as const;
type SkillMode = (typeof MODE_IDS)[number];
type BusinessStage = (typeof STAGE_IDS)[number];

const TABS: { id: string; label: string; kind: "mode" | "stage" }[] = [
  { id: "all", label: "全部", kind: "mode" },
  { id: "favorites", label: "收藏", kind: "mode" },
  { id: "viewed", label: "最近查看", kind: "mode" },
  { id: "frequent", label: "常用", kind: "mode" },
  { id: "recent", label: "最近使用", kind: "mode" },
  { id: "recommend", label: "推荐", kind: "mode" },
  { id: "all", label: "全部场景", kind: "stage" },
  { id: "reach", label: "建联", kind: "stage" },
  { id: "intent", label: "意向", kind: "stage" },
  { id: "biz", label: "报价", kind: "stage" },
  { id: "sample", label: "寄样", kind: "stage" },
  { id: "settle", label: "成交", kind: "stage" },
  { id: "content", label: "内容发布", kind: "stage" },
  { id: "exception", label: "异常", kind: "stage" },
];

function isSkillMode(value: string | null): value is SkillMode {
  return value !== null && (MODE_IDS as readonly string[]).includes(value);
}

function isBusinessStage(value: string | null): value is BusinessStage {
  return value !== null && (STAGE_IDS as readonly string[]).includes(value);
}

/**
 * 新地址固定为 `mode` + `stage`；保留单一 `tab` 的旧深链读取。
 * 新参数优先，缺失的一维再从旧 tab 补齐，因此混合迁移地址也不会丢失另一维筛选。
 */
function catalogFilters(search: string): { mode: SkillMode; stage: BusinessStage } {
  const params = new URLSearchParams(search);
  const legacyTab = params.get("tab");
  const mode = params.get("mode");
  const stage = params.get("stage");
  return {
    mode: isSkillMode(mode) ? mode : (isSkillMode(legacyTab) ? legacyTab : "all"),
    stage: isBusinessStage(stage) ? stage : (isBusinessStage(legacyTab) ? legacyTab : "all"),
  };
}

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
type SkillPersonal = Awaited<ReturnType<typeof api.skillPersonal>>["items"][number];
type SkillMemory = { q: string; selectedId: string; detailOpen: boolean; expanded: boolean; limit: number; mode: SkillMode; stage: BusinessStage };

function useSkillDetail(id: string) {
  const [state, setState] = useState({ id: "", loading: true, doc: "", docError: "", agentsError: "", agents: [] as Array<{ id: string; name: string }> });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setState({ id, loading: true, doc: "", docError: "", agentsError: "", agents: [] });
    void Promise.allSettled([api.skill(id), api.skillAgents(id)]).then(([doc, agents]) => {
      if (!alive) return;
      setState({ id, loading: false,
        doc: doc.status === "fulfilled" ? String(doc.value.employee_doc || "") : "",
        docError: doc.status === "rejected" ? "说明书读取失败" : "",
        agents: agents.status === "fulfilled" && Array.isArray(agents.value.agents) ? agents.value.agents : [],
        agentsError: agents.status === "rejected" || !Array.isArray(agents.value.agents) ? "可用数字员工读取失败" : "" });
    });
    return () => { alive = false; };
  }, [id, generation]);
  return { ...state, loading: state.id !== id || state.loading, retry: () => setGeneration(value => value + 1) };
}

function SkillDetail({ skill, favorite, favoriteBusy, onFavorite, onBack, expanded, onExpand }: {
  skill: SkillRow; favorite: boolean; favoriteBusy: boolean; onFavorite: () => void; onBack: () => void;
  expanded: boolean; onExpand: () => void;
}) {
  const detail = useSkillDetail(skill.id);
  const learning = skill.learning;
  const execution = skill.execution;
  const inputs = (learning?.inputs || []).map(employeeText).filter(Boolean);
  const rawSteps = learning?.steps || [];
  const steps = rawSteps.map(employeeText).filter(Boolean);
  const examples = skill.employee_example || [];
  const output = skill.output ? OUTPUT_LABEL[skill.output] : undefined;
  const result = learning?.result ? OUTPUT_LABEL[learning.result] : undefined;
  const risk = skill.risk === "L3" ? "R3 · 执行前确认" : skill.risk === "L2" ? "R2 · 草稿" : "R1 · 只读";
  const showSteps = steps.length > 0 && !isFallbackSteps(rawSteps) && !steps.every(step => GENERIC_STEP_LABELS.has(step));
  const section = (label: string, content: ReactNode) => <section className="asset-detail-section"><h3>{label}</h3>{content}</section>;
  return <div className="kbv-rail-inner" data-skill-detail={skill.id}>
    <BrowseDetailHeader title={skill.title} titleId="skill-preview-title" favorite={favorite} favoriteDisabled={favoriteBusy}
      onFavorite={onFavorite} onBack={onBack} expanded={expanded} onExpand={onExpand}
      recordAttributes={{ "data-skill-favorite": skill.id }} />
    <div className="kbv-rail-body">
      <section className="knowledge-detail-metadata" aria-label="技能适用与执行边界">
        <PropertyList labelWidth="short" items={[
          { key: "source", label: "来源", value: skill.origin === "third_party" ? "第三方" : "官方" },
          { key: "stage", label: "适用场景", value: GROUPS.find(group => group.funnel.includes(skill.funnel || ""))?.label || "通用" },
          { key: "risk", label: "执行", value: <span className="knowledge-status">{risk}</span> },
          ...(skill.ui_template?.version ? [{ key: "version", label: "版本", value: skill.ui_template.version }] : []),
          ...(execution?.async?.enabled ? [{ key: "async", label: "作业", value: `异步 · ${execution.async.cancelable ? "可取消" : "不支持取消"} · ${execution.async.retryable ? "可重试" : "不支持重试"}` }] : []),
        ]} />
      </section>
      {skill.summary && skill.summary !== skill.title ? <p className="asset-description">{skill.summary}</p> : null}
      {detail.loading ? <p className="asset-read-warning" role="status">正在读取用法与可用数字员工…</p> : null}
      {detail.agentsError || detail.docError ? <p className="asset-action-error" role="alert">{[detail.agentsError, detail.docError].filter(Boolean).join("；")} <CompactButton onClick={detail.retry}>重试</CompactButton></p> : null}
      {!detail.loading && !detail.agentsError ? section("可经由以下数字员工使用", detail.agents.length
        ? <div className="asset-static-labels">{detail.agents.map(agent => <span key={agent.id}>{agent.name}</span>)}</div>
        : <p className="muted">暂无你可使用的数字员工装配此技能。</p>) : null}
      {skill.employee_quick ? section("可以直接查到", <p>{skill.employee_quick}</p>) : null}
      {skill.employee_agent ? section("需要走确认或 AI 助理", <p>{skill.employee_agent}</p>) : null}
      {!skill.employee_quick && !skill.employee_agent ? <p className="asset-read-warning">{ENTRY_PENDING}</p> : null}
      {inputs.length ? section("需要你提供", <div className="asset-static-labels">{inputs.map(input => <span key={input}>{input}</span>)}</div>) : null}
      {output ? section("产出", <p>{output}</p>) : null}
      {showSteps ? section("使用步骤", <ol>{steps.map((step,index) => <li key={index}>{step}</li>)}</ol>) : null}
      {learning ? section("执行边界", <PropertyList labelWidth="short" items={[
        ...(result ? [{ key: "result", label: "结果", value: result }] : []),
        { key: "confirm", label: "确认", value: learning.confirmation || "按当前权限执行" },
      ]} />) : null}
      {detail.doc || examples.length ? <details className="asset-detail-section"><summary>说明书与示例</summary>
        {detail.doc ? <EmployeeDoc text={detail.doc} /> : null}
        {examples.length ? <ul>{examples.map((example,index) => <li key={index}>{example}</li>)}</ul> : null}
      </details> : null}
      {execution ? <details className="asset-detail-section"><summary>调用关系与安全边界</summary>
        {execution.tools?.length ? section("调用工具", <PropertyList labelWidth="short" items={execution.tools.map((tool,index) => ({ key: String(index), label: toolLabel(tool.ref || "",tool.kind), value: tool.risk === "L3" ? "R3 · 执行前确认" : tool.risk === "L2" ? "R2 · 草稿" : "R1 · 只读" }))} />) : <p>这项技能当前不直接调用外部工具。</p>}
        {execution.permissions?.length ? section("所需权限", <ul>{execution.permissions.map(permission => <li key={permission}>{PERMISSION_LABEL[permission] || (permission.endsWith(":write") ? "业务数据写入" : "业务数据读取")}</li>)}</ul>) : null}
        {execution.async?.enabled ? <p>{execution.async.status || "有进度状态"}；{execution.async.cancelable ? "支持取消" : "不支持取消"}；{execution.async.retryable ? "支持重试" : "不支持重试"}。</p> : null}
        <p>{execution.receipt_required ? "执行后保留操作回执。" : "按当前权限读取与展示结果。"}</p>
      </details> : null}
      {skill.keeps_stage ? <p className="asset-read-warning">不推进正式阶段，改阶段请另走正式阶段变更。</p> : null}
      {execution?.async?.enabled || ASYNC_SKILL_IDS.has(skill.id) ? <p className="asset-read-warning">异步作业同一时间只跑一个；执行时提供进度、取消与重试入口。</p> : null}
      {!detail.loading && !detail.docError && !detail.doc && !examples.length ? <p className="asset-read-warning">示例与说明书还没补录，口径来自技能登记本身。</p> : null}
    </div>
    <DetailActionBar><AssetTaskAction disabled={detail.loading || !!detail.agentsError || !detail.agents.length || skill.employee_visible === false}
      draft={{ text: skillFillText(skill), skill_template: skill.ui_template,
        chips: [{ kind: "skill", id: skill.id, label: skill.label || skill.title, write: isWriteSkill(skill) }] }} /></DetailActionBar>
  </div>;
}

export function SkillCatalog() {
  const location = useLocation();
  const nav = useNavigate();
  const { account } = useAccount();
  const userId = account?.id || "";
  const memory = useRef(readBrowseMemory<SkillMemory>(userId,"skills")).current;
  const urlHasFilters = !!location.search;
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? memory.q ?? "");
  const [mode, setMode] = useState<SkillMode>(() => urlHasFilters ? catalogFilters(location.search).mode : memory.mode || "all");
  const [businessStage, setBusinessStage] = useState<BusinessStage>(() => urlHasFilters ? catalogFilters(location.search).stage : memory.stage || "all");
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get("id") || memory.selectedId || "");
  const [detailOpen, setDetailOpen] = useState(memory.detailOpen || false);
  const [expanded, setExpanded] = useState(memory.expanded || false);
  const [personal, setPersonal] = useState<SkillPersonal[]>([]);
  const [personalError, setPersonalError] = useState("");
  const [personalLoaded, setPersonalLoaded] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const searchRef = useRef<InputRef | null>(null);
  const { listRef, toolbarRef, limit, more } = useBrowseRows(JSON.stringify([mode,businessStage,q]),memory.limit,!loading);
  useEffect(() => {
    let alive = true;
    setLoading(true); setPersonalLoaded(false);
    void api.skills().then(rows => { if (!Array.isArray(rows)) throw new Error("技能目录返回格式异常"); if (alive) { setSkills(rows as SkillRow[]); setErr(""); } })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : "无法加载技能目录"); }).finally(() => { if (alive) setLoading(false); });
    void api.skillPersonal().then(result => { if (!Array.isArray(result.items)) throw new Error("个人记录返回格式异常"); if (alive) { setPersonal(result.items); setPersonalError(""); } })
      .catch(e => { if (alive) setPersonalError(e instanceof Error ? e.message : "个人收藏与使用记录读取失败"); }).finally(() => { if (alive) setPersonalLoaded(true); });
    return () => { alive = false; };
  }, [reloadKey,userId]);
  useEffect(() => {
    if (!location.search) return;
    const filters = catalogFilters(location.search); setMode(filters.mode); setBusinessStage(filters.stage);
    setQ(new URLSearchParams(location.search).get("q") || "");
  }, [location.search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input,textarea,[contenteditable=true]")) return;
      event.preventDefault(); searchRef.current?.focus();
    };
    window.addEventListener("keydown",onKey); return () => window.removeEventListener("keydown",onKey);
  }, []);
  const visibleSkills = useMemo(() => skills.filter(skill => skill.employee_visible !== false),[skills]);
  const countsReady = !loading && (!["favorites","viewed","frequent","recent"].includes(mode) || (personalLoaded && !personalError));
  const matchesQuery = (skill: SkillRow) => !q.trim() || [skill.title,skill.summary,skill.label,skill.employee_quick,skill.employee_agent]
    .some(text => String(text || "").toLowerCase().includes(q.trim().toLowerCase()));
  const matchesMode = (skill: SkillRow, selected: SkillMode) => {
    const info = personal.find(item => item.skill_id === skill.id);
    return selected === "favorites" ? !!info?.favorite : selected === "viewed" ? !!info?.viewed_at
      : selected === "frequent" || selected === "recent" ? !!info?.use_count
      : selected === "recommend" ? RECOMMENDED_IDS.includes(skill.id) : true;
  };
  const filtered = visibleSkills.filter(skill => matchesQuery(skill) && (businessStage === "all" || skill.funnel === businessStage) && matchesMode(skill,mode));
  if (["viewed","recent","frequent"].includes(mode)) filtered.sort((a,b) => {
    const x = personal.find(item => item.skill_id === a.id), y = personal.find(item => item.skill_id === b.id);
    return mode === "frequent" ? (y?.use_count || 0) - (x?.use_count || 0)
      : String(mode === "viewed" ? y?.viewed_at || "" : y?.used_at || "").localeCompare(String(mode === "viewed" ? x?.viewed_at || "" : x?.used_at || ""));
  });
  const selected = filtered.find(skill => skill.id === selectedId) || null;
  const rows = filtered.slice(0,limit);
  const browseState = useMemo(() => ({ q, mode, stage: businessStage, selectedId, detailOpen, expanded, limit }),[q,mode,businessStage,selectedId,detailOpen,expanded,limit]);
  useBrowseMemory(userId,"skills",browseState,listRef,!loading);
  const updateFilters = (nextMode: SkillMode, nextStage: BusinessStage) => {
    const params = new URLSearchParams(location.search); params.delete("tab"); params.set("mode",nextMode); params.set("stage",nextStage);
    if (q) params.set("q",q); else params.delete("q");
    nav({ pathname: location.pathname,search:`?${params}` });
  };
  const select = (skill: SkillRow) => {
    setSelectedId(skill.id); setDetailOpen(true);
    void api.viewSkill(skill.id).then(() => setPersonal(current => {
      const prior = current.find(item => item.skill_id === skill.id);
      return [...current.filter(item => item.skill_id !== skill.id),{ skill_id:skill.id,favorite:prior?.favorite || false,viewed_at:new Date().toISOString(),use_count:prior?.use_count || 0,used_at:prior?.used_at || null }];
    })).catch(e => setPersonalError(`最近查看未保存：${e instanceof Error ? e.message : "请重试"}`));
  };
  const back = () => {
    setDetailOpen(false);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-skill-open="${CSS.escape(selectedId)}"]`)?.focus({preventScroll:true}));
  };
  const toggleFavorite = async () => {
    if (!selected || favoriteBusy) return;
    const skillId = selected.id; const next = !personal.find(item => item.skill_id === skillId)?.favorite;
    setFavoriteBusy(true);
    try { await api.favoriteSkill(skillId,next); setPersonal(current => {
      const prior = current.find(item => item.skill_id === skillId);
      return [...current.filter(item => item.skill_id !== skillId),{ skill_id:skillId,favorite:next,viewed_at:prior?.viewed_at || null,use_count:prior?.use_count || 0,used_at:prior?.used_at || null }];
    }); setPersonalError(""); } catch(e) { setPersonalError(`收藏未保存：${e instanceof Error ? e.message : "请重试"}`); }
    finally { setFavoriteBusy(false); }
  };
  return <section className="kbv kbv-page knowledge-browse asset-browse" data-skill-catalog>
    <KnowledgeBrowseWorkspace detailOpen={detailOpen && !!selected} expanded={expanded}>
      <section ref={listRef} className="kbv-list" aria-label="技能列表" data-kbv-list aria-busy={loading}>
        <div ref={toolbarRef}>
          <KnowledgeFilterBar><WorkspaceSearchInput ref={searchRef} className="kbv-search" value={q} aria-label="搜索技能 / SOP / 场景"
            placeholder="搜索技能 / SOP / 场景" onChange={event => {
              const value = event.target.value; setQ(value);
              const params = new URLSearchParams(location.search); params.set("mode",mode); params.set("stage",businessStage);
              if (value) params.set("q",value); else params.delete("q");
              nav({pathname:location.pathname,search:`?${params}`},{replace:true});
            }} />
            <FilterRow label="适用场景" role="group" aria-label="适用场景">
              {TABS.filter(tab => tab.kind === "stage").map(tab => <FilterOptionButton key={tab.id} label={tab.label}
                selected={businessStage === tab.id} countsReady={countsReady}
                count={visibleSkills.filter(skill => matchesQuery(skill) && matchesMode(skill,mode) && (tab.id === "all" || skill.funnel === tab.id)).length}
                data-skill-stage={tab.id} onClick={() => updateFilters(mode,tab.id as BusinessStage)} />)}
            </FilterRow>
            {q || mode !== "all" || businessStage !== "all" ? <FilterAction onClick={() => { setQ(""); const params = new URLSearchParams(location.search);params.delete("q");params.delete("tab");params.set("mode","all");params.set("stage","all");nav({pathname:location.pathname,search:`?${params}`}); }}>清除筛选</FilterAction> : null}
          </KnowledgeFilterBar>
          <div className="kbv-tabs asset-views" role="group" aria-label="快捷视图">
            {TABS.filter(tab => tab.kind === "mode" && ["all","favorites","viewed"].includes(tab.id)).map(tab => <FilterOptionButton key={tab.id} label={tab.label}
              selected={mode === tab.id} countsReady={!loading && (tab.id === "all" || (personalLoaded && !personalError))}
              count={visibleSkills.filter(skill => matchesQuery(skill) && (businessStage === "all" || skill.funnel === businessStage) && matchesMode(skill,tab.id as SkillMode)).length}
              data-skill-view={tab.id} onClick={() => updateFilters(tab.id as SkillMode,businessStage)} />)}
            <span className="asset-view-more"><Select size="small" aria-label="更多技能视图" value={["frequent","recent","recommend"].includes(mode) ? mode : undefined}
              placeholder="更多视图" options={TABS.filter(tab => tab.kind === "mode" && ["frequent","recent","recommend"].includes(tab.id)).map(tab => ({value:tab.id,label:tab.label}))}
              onChange={value => updateFilters(value as SkillMode,businessStage)} /></span>
            <span className="kbv-tabs-count" data-skill-count>{countsReady ? `${filtered.length} 项技能` : loading ? "正在读取技能…" : "个人记录计数暂不可用"}</span>
          </div>
        </div>
        {personalError ? <p className="asset-personal-error" role="alert">个人记录暂不可用：{personalError} <CompactButton onClick={() => setReloadKey(value => value + 1)}>重试</CompactButton></p> : null}
        {err ? <p className="error" role="alert">{err} <CompactButton onClick={() => setReloadKey(value => value + 1)}>重试</CompactButton></p> : null}
        <div className="kbv-records">{rows.map(skill => <BrowseListRow key={skill.id} title={skill.title} kind={skill.badge || "技能"} selected={selected?.id === skill.id}
          onOpen={() => select(skill)} recordAttributes={{"data-skill-id":skill.id}} openAttributes={{"data-skill-open":skill.id}} />)}</div>
        {rows.length ? <ListLoadFooter remaining={filtered.length - rows.length} onMore={more} /> : null}
        {!loading && !err && !rows.length ? <p className="kbv-empty">{personalError && ["favorites","viewed","frequent","recent"].includes(mode) ? "个人记录读取失败，请重试。" : "没有匹配的技能。"}<FilterAction onClick={() => updateFilters("all","all")}>查看全部</FilterAction></p> : null}
      </section>
      <aside className="kbv-rail" aria-label="技能详情" data-skill-detail-pane>
        {selected ? <SkillDetail key={selected.id} skill={selected} favorite={!!personal.find(item => item.skill_id === selected.id)?.favorite}
          favoriteBusy={favoriteBusy || !personalLoaded || !!personalError} onFavorite={() => void toggleFavorite()} onBack={back} expanded={expanded} onExpand={() => setExpanded(value => !value)} />
          : <p className="kbv-empty" role="status">{loading ? "正在加载技能…" : "从列表选择一项技能，查看用法与适用范围。"}</p>}
      </aside>
    </KnowledgeBrowseWorkspace>
  </section>;
}
