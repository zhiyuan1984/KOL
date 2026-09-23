import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { useViewMode } from "../viewMode";

export const FUNNEL: { id: string; label: string; hint: string }[] = [
  { id: "reach", label: "建联", hint: "建联 / 画像" },
  { id: "intent", label: "意向", hint: "跟进" },
  { id: "biz", label: "评估报价", hint: "评估 / 报价" },
  { id: "sample", label: "寄样测评", hint: "地址 / 发货" },
  { id: "content", label: "内容发布", hint: "催大纲" },
  { id: "settle", label: "结算", hint: "归因" },
  { id: "exception", label: "异常旁路", hint: "风险扫描" },
];

export const SKILL_FUNNEL: Record<string, string> = {
  creator_profile: "reach",
  creator_discovery: "reach",
  creator_scoring: "reach",
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
  confirm_stage: "intent",
  stage_sop: "intent",
  reply_analysis: "intent",
  deal_memory: "biz",
  email_compose: "biz",
  email_conversation_read: "biz",
  email_conversation_list: "biz",
  email_mailbox_list: "biz",
  email_app_conversation_list: "biz",
  creator_risk_conversations: "exception",
  creator_budget_report: "settle",
  risk_scan: "exception",
};

export function skillFunnel(s: { id: string; funnel?: string }) {
  return s.funnel || SKILL_FUNNEL[s.id] || "reach";
}

export function skillKind(s: { source?: string }) {
  return s.source === "published" ? "自建" : "技能";
}

export type SkillRow = {
  id: string;
  title: string;
  label?: string;
  in_market: boolean;
  granted?: boolean;
  /** false = 内部技能（pipeline / 定时任务 / 旅程调用），不在提问框可选清单里。 */
  employee_visible?: boolean;
  funnel?: string;
  summary?: string;
  output?: string;
  keeps_stage?: boolean;
  /** 员工面两段入口口径：逐字来自 SKILL.md（`employee_quick` / `employee_agent`）。
      未登记入口口径的技能这几个字段缺失，员工面照实说明待专家补齐。 */
  employee_quick?: string | null;
  employee_agent?: string | null;
  employee_example?: string[] | null;
  source?: "bundled" | "published";
  learning?: {
    when_to_use?: string;
    inputs?: string[];
    steps?: string[];
    result?: string;
    side_effects?: string;
    confirmation?: string;
  };
  execution?: {
    tools?: Array<{ kind?: string; ref?: string; risk?: string; confirmation?: string }>;
    permissions?: string[];
    async?: { enabled?: boolean; status?: string; cancelable?: boolean; retryable?: boolean };
    receipt_required?: boolean;
  };
};

type HubMode = "catalog" | "mine";

const CONNECTORS = [
  {
    id: "enterprise_mail",
    title: "企业邮箱",
    kind: "连接器",
    summary: "用品牌邮箱发建联、跟进和报价信。",
    to: "/connectors",
  },
  {
    id: "wecom",
    title: "企业微信",
    kind: "连接器",
    summary: "费用审批走企微卡。",
    to: "/connectors",
  },
  {
    id: "starrykol",
    title: "Starry KOL MCP",
    kind: "连接器",
    summary: "红人库、负责人、品牌邮箱和邮件会话（管理端治理，调试可见）。",
    to: "/connectors",
  },
  {
    id: "kolclaw",
    title: "KOL Claw",
    kind: "连接器",
    summary: "达人评分、建联话术、每日任务和预算。",
    to: "/connectors",
  },
];

const MARK: Record<string, string> = {
  creator_profile: "M12 11.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M6.2 19c1.1-2.8 3.2-4.2 5.8-4.2s4.7 1.4 5.8 4.2",
  risk_scan: "M12 4l8 14H4z M12 10v4 M12 16.5h.01",
  enterprise_mail: "M4 7h16v10H4z M4 8l8 6 8-6",
  wecom: "M8 16.5c-3.2 0-5.5-2.2-5.5-5S4.8 6.5 8 6.5c2.6 0 4.6 1.4 5.2 3.4 3 .2 5.3 2.2 5.3 4.7 0 2.5-2.4 4.4-5.4 4.4-.7 0-1.4-.1-2-.3L8.4 20l.4-2.2C8.3 17.6 8.1 17 8 16.5z",
  starrykol: "M12 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 14.3 7.8 16.5l.8-4.7L5.2 8.5l4.7-.7z",
  kolclaw: "M5 8h6l2 3h6v7H5z M8 8V6.5a2.5 2.5 0 0 1 5 0V8",
};

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="hub-glyph" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HubMark({ id, fallback }: { id: string; fallback?: string }) {
  const d = MARK[id];
  if (!d) {
    return (
      <span className="hub-tile-ico hub-tile-ico-letter">
        {(fallback || id).slice(0, 1)}
      </span>
    );
  }
  return (
    <span className="hub-tile-ico">
      <Glyph d={d} />
    </span>
  );
}

function PuzzleIco() {
  return (
    <svg className="hub-svg" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M9 4.5h2.2a2 2 0 1 1 1.6 0H15v3.2a2 2 0 1 1 0 3.1V14h-3.2a2 2 0 1 0-1.6 0H9v-3.2a2 2 0 1 1 0-3.1V4.5z M15 14h4.5v5.5H15z M4.5 14H9v5.5H4.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HubTile({
  id,
  title,
  kind,
  summary,
  dataKey,
  plusLabel,
  disabled,
  onPlus,
  actions,
  sopMark,
  badge,
  followStatus,
}: {
  id: string;
  title: string;
  kind: string;
  summary: string;
  dataKey?: "data-skill" | "data-connector" | "data-partner";
  plusLabel: string;
  disabled?: boolean;
  onPlus: () => void;
  actions?: ReactNode;
  sopMark?: boolean;
  badge?: string;
  followStatus?: string;
}) {
  return (
    <div
      className={"hub-tile" + (disabled ? " is-disabled" : "")}
      data-skill={dataKey === "data-skill" ? id : undefined}
      data-connector={dataKey === "data-connector" ? id : undefined}
      data-partner={dataKey === "data-partner" ? id : undefined}
      data-partner-follow={dataKey === "data-partner" ? followStatus : undefined}
      data-sop-skill={sopMark ? id : undefined}
    >
      <HubMark id={id} fallback={title} />
      <div className="hub-tile-body">
        <div className="hub-tile-name">
          {title} <span className="hub-kind">{kind}</span>
          {badge && <span className="remote-tag nowrap">{badge}</span>}
        </div>
        <p>{summary}</p>
      </div>
      {actions || (
        <button
          type="button"
          className="hub-plus"
          data-skill-use={dataKey === "data-skill" ? id : undefined}
          disabled={disabled}
          aria-label={plusLabel}
          onClick={onPlus}
        >
          +
        </button>
      )}
    </div>
  );
}

export function SkillHubChrome({
  mode,
  q,
  onQ,
}: {
  mode: HubMode;
  q: string;
  onQ: (v: string) => void;
}) {
  const { debug } = useViewMode();
  return (
    <header className="hub-chrome" data-hub-chrome>
      <nav className="hub-modes" aria-label="技能">
        <PuzzleIco />
        <Link to="/market/skills" className={"hub-mode" + (mode === "catalog" ? " on" : "")} data-hub-mode="catalog">
          {debug ? "技能 · 连接器" : "技能目录"}
        </Link>
      </nav>
      <div className="hub-tools">
        <label className="hub-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            className="hub-search"
            data-hub-search
            placeholder="搜索技能"
            value={q}
            onChange={(e) => onQ(e.target.value)}
          />
        </label>
        <Link to="/skills" className={"hub-mine" + (mode === "mine" ? " on" : "")} data-hub-mine>
          <PuzzleIco />
          我的技能
        </Link>
      </div>
    </header>
  );
}

async function startAsk(nav: ReturnType<typeof useNavigate>, text: string, intent?: string, collaborationId?: string) {
  const ses = await api.createSession(text.slice(0, 24));
  storePending(ses.id, { text, intent, collaboration_id: collaborationId });
  nav(`/s/${ses.id}`);
}

export function SkillHub() {
  const { admin, debug } = useViewMode();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [chip, setChip] = useState("skills");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.skillMarket()
      .then((data: unknown) => {
        setSkills(Array.isArray(data) ? (data as SkillRow[]) : []);
        setErr("");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "无法加载技能目录"))
      .finally(() => setLoading(false));
  }, []);

  const useSkill = async (s: SkillRow) => {
    if (s.granted === false) {
      setErr(`“${s.label || s.title}”尚未授权，请联系管理员在技能授权中开通。`);
      return;
    }
    setBusy(s.id);
    setErr("");
    try {
      await startAsk(nav, `@${s.label || s.title}`, s.id);
    } catch (e) {
      setErr(String(e));
      setBusy(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const match = (title: string, summary: string) =>
    !needle || title.toLowerCase().includes(needle) || summary.toLowerCase().includes(needle);

  const catalogChips = debug && admin
    ? [
        { id: "skills", label: "技能" },
        { id: "connectors", label: "连接器" },
      ]
    : [];

  const skillTiles = useMemo(() => {
    if (chip === "connectors") return [];
    return skills.filter((s) => s.in_market && match(s.title, s.summary || ""));
  }, [skills, chip, needle]);

  const connectorTiles = useMemo(() => {
    if (!debug || !admin) return [];
    if (chip !== "skills" && chip !== "connectors") return [];
    return CONNECTORS.filter((c) => match(c.title, c.summary));
  }, [admin, debug, chip, needle]);

  const empty = !loading && !err && skillTiles.length === 0 && connectorTiles.length === 0;

  return (
    <div className="hub-page" data-skill-hub="catalog">
      <SkillHubChrome mode="catalog" q={q} onQ={setQ} />
      <p className="hub-lead muted">已授权、可用于当前任务的技能。</p>
      {err && <p className="error" role="alert" data-hub-error>{err}</p>}
      {loading && !err && <p className="muted" data-hub-loading>正在加载技能…</p>}
      {catalogChips.length > 0 && (
        <div className="hub-chips" role="tablist">
          {catalogChips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              className={"hub-chip" + (chip === c.id ? " on" : "")}
              data-hub-chip={c.id}
              onClick={() => setChip(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {!loading && !err && chip !== "connectors" && !needle && (
        <section className="hub-featured" data-hub-featured>
          <button type="button" className="hub-banner" data-hub-banner="email_compose" onClick={() => void useSkill({ id: "email_compose", title: "写合作邮件", in_market: true })}>
            <div>
              <div className="hub-banner-kicker">常用</div>
              <h3>写合作邮件</h3>
              <p>给达人写合作邮件。发出去不会改合作阶段。</p>
            </div>
          </button>
          <button
            type="button"
            className="hub-banner"
            data-hub-banner="creator_profile"
            onClick={() => void useSkill({ id: "creator_profile", title: "达人画像", in_market: true })}
          >
            <div>
              <div className="hub-banner-kicker">常用</div>
              <h3>达人画像</h3>
              <p>查看红人详情、平台数据和绑定的负责人，不发信。</p>
            </div>
          </button>
        </section>
      )}

      <section>
        <h2 className="hub-section-title">技能</h2>
        <div className="hub-grid">
          {skillTiles.map((s) => (
            <HubTile
              key={s.id}
              id={s.id}
              title={s.title}
              kind={skillKind(s)}
              summary={s.summary || s.title}
              dataKey="data-skill"
              plusLabel={s.granted === false ? "未开通" : "使用 " + s.title}
              disabled={busy === s.id || s.granted === false}
              badge={s.granted === false ? "未开通" : undefined}
              onPlus={() => void useSkill(s)}
            />
          ))}
          {connectorTiles.map((c) => (
            <HubTile
              key={c.id}
              id={c.id}
              title={c.title}
              kind={c.kind}
              summary={c.summary}
              dataKey="data-connector"
              plusLabel={"打开 " + c.title}
              onPlus={() => nav(c.to)}
            />
          ))}
        </div>
        {empty && <p className="muted hub-empty" data-hub-empty>没有匹配的技能</p>}
      </section>
    </div>
  );
}
