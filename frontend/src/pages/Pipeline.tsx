import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { FALLBACK_MAIN_STAGES, SHORT_STAGE_LABEL } from "../kolStages";
import JourneyGuide from "../components/JourneyGuide";
import { rememberJourney } from "../journey";

type StageSpec = {
  code: string;
  label: string;
  domain?: string | null;
  advancement_mode?: string;
};

type Card = {
  id: string;
  handle: string;
  brand: string;
  stage_code?: string;
  stage_label: string;
  capability_domain?: string;
  advancement_mode?: string;
  followers: string;
  platform: string;
  email?: string;
  notes?: string;
  days_in_stage?: number;
  owner_name?: string;
  engagement_rate?: string;
  audience_geo?: string;
  avg_views_10?: string;
  duplicate_checked?: number;
  group_brand_overlap?: string;
  exception?: boolean;
  actions: { label: string; act: string; prompt: string; intent?: string; collaboration_id?: string }[];
};

type DetailTab = "overview" | "creator" | "actions";

const FALLBACK_STAGES: StageSpec[] = FALLBACK_MAIN_STAGES;

const DOMAIN_LABEL: Record<string, string> = {
  Lead: "触达",
  Opportunity: "意向",
  Negotiation: "商务",
  Execution: "履约",
  "Settlement-Growth": "结算",
};

function stageIndex(stages: StageSpec[], code?: string) {
  return stages.findIndex((stage) => stage.code === code);
}

const EXCEPTION_STATES = [
  { code: "PAUSED", label: "已暂停" },
  { code: "LOST", label: "已流失" },
  { code: "REJECTED", label: "已拒绝" },
  { code: "CANCELLED", label: "已取消" },
  { code: "DISPUTED", label: "争议中" },
  { code: "COMPLETED", label: "已完成" },
];

const RELATED_HOME_TASKS = [
  { id: "creator_lifecycle_kanban", title: "合作生命周期看板", prompt: "合作生命周期看板" },
  { id: "risk_scan", title: "超时/风险扫描", prompt: "超时/风险扫描" },
  { id: "reply_analysis", title: "回复分析", prompt: "回复分析 [会话或红人]" },
  { id: "confirm_stage", title: "提出阶段变更", prompt: "提出阶段变更 [红人] 到 [目标阶段]" },
];

const RELATED_BOARD_TASKS = [
  { id: "email_compose", title: "写合作邮件" },
  { id: "confirm_stage", title: "提出阶段变更" },
  { id: "reply_analysis", title: "回复分析" },
  { id: "deal_memory", title: "Deal Memory" },
  { id: "creator_profile", title: "达人画像" },
  { id: "creator_lifecycle_kanban", title: "合作生命周期看板" },
  { id: "risk_scan", title: "超时/风险扫描" },
];

function cardActions(card: Card): Card["actions"] {
  return card.actions || [];
}

function domainSpans(stages: StageSpec[]) {
  const spans: { domain: string; start: number; count: number }[] = [];
  stages.forEach((stage, index) => {
    const domain = String(stage.domain || "");
    const last = spans[spans.length - 1];
    if (last && last.domain === domain) last.count += 1;
    else spans.push({ domain, start: index + 1, count: 1 });
  });
  return spans;
}

export default function Pipeline() {
  const [data, setData] = useState<{
    columns: string[];
    groups: Record<string, Card[]>;
    exceptions: Card[];
    stages?: StageSpec[];
    side_stages?: { code: string; label: string }[];
    note: string;
  } | null>(null);
  const [onlyEx, setOnlyEx] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const nav = useNavigate();
  const [params] = useSearchParams();
  const kolQuery = params.get("kol");

  useEffect(() => {
    api.pipeline(onlyEx ? 1 : 0).then(setData as never);
  }, [onlyEx]);

  const stages = data?.stages?.length ? data.stages : FALLBACK_STAGES;
  const rows = useMemo(() => {
    if (!data) return [];
    if (onlyEx) return data.exceptions;
    return data.columns.flatMap((col) => data.groups[col] || []);
  }, [data, onlyEx]);

  useEffect(() => {
    if (!data || !kolQuery) return;
    const pool = [
      ...data.columns.flatMap((col) => data.groups[col] || []),
      ...data.exceptions,
    ];
    const wanted = pool.find((row) => row.handle === kolQuery);
    if (!wanted) return;
    if (Boolean(wanted.exception) !== onlyEx) {
      setOnlyEx(Boolean(wanted.exception));
      return;
    }
    setSelectedId(wanted.id);
    setTab("overview");
  }, [data, kolQuery, onlyEx]);

  useEffect(() => {
    if (kolQuery) return;
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0].id);
      setTab("overview");
    }
  }, [rows, selectedId, kolQuery]);

  const ask = async (a: Card["actions"][0]) => {
    rememberJourney({ kind: "skill", skillId: a.intent, skillLabel: a.label, handle: a.prompt.match(/@([^\s]+)/)?.[1] });
    const ses = a.collaboration_id
      ? await api.openKolSession(a.collaboration_id)
      : await api.createSession(a.prompt.slice(0, 24));
    storePending(ses.id, { text: a.prompt, collaboration_id: a.collaboration_id });
    if (a.collaboration_id) sessionStorage.setItem(`kol-session:${ses.id}`, "1");
    nav(`/s/${ses.id}`, { state: { kolSession: Boolean(a.collaboration_id) } });
  };

  const runHomeTask = async (task: { id: string; prompt: string }) => {
    const ses = await api.createSession(task.prompt.slice(0, 24));
    storePending(ses.id, { text: task.prompt });
    nav(`/s/${ses.id}`);
  };

  if (!data) return <p className="muted">加载生命周期…</p>;

  const domains = domainSpans(stages);
  const exceptionNames = (data.side_stages?.length ? data.side_stages : EXCEPTION_STATES)
    .map((stage) => stage.label)
    .join("、");

  return (
    <div className="pipeline-page">
      <div className="page-kicker">合作</div>
      <h1 style={{ marginTop: 0 }}>KOL 全生命周期管理</h1>
      <JourneyGuide variant="compact" />
      <p className="muted">
        这是合作资产页，不是创建新项目。任务不会自动打开这里。从侧栏「生命周期」或技能市场进入。
        点选红人后用「概览 / 达人 / 动作」查看详情；首页「流水线复盘」「超时/风险扫描」只读汇总，结果留在会话。
      </p>
      <div className="pipeline-related" data-pipeline-related>
        <div>
          <span className="pipeline-related-kicker">本页动作</span>
          {RELATED_BOARD_TASKS.map((task) => (
            <button
              key={task.id}
              type="button"
              className="pipeline-related-chip"
              onClick={() => {
                if (selectedId) setTab("actions");
              }}
            >
              {task.title}
            </button>
          ))}
        </div>
        <div>
          <span className="pipeline-related-kicker">首页任务</span>
          {RELATED_HOME_TASKS.map((task) => (
            <button
              key={task.id}
              type="button"
              className="pipeline-related-chip"
              data-pipeline-task={task.id}
              onClick={() => void runHomeTask(task)}
            >
              {task.title}
            </button>
          ))}
        </div>
      </div>
      <div className="exception-bar" data-exception-bar>
        <div>
          <strong>
            异常 KOL {data.exceptions.length}{" "}
            {data.exceptions.map((e) => (
              <span key={e.handle} className="badge-red">
                @{e.handle} · {e.stage_label}
              </span>
            ))}
          </strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {exceptionNames} 会离开主时间线，可在此筛选。
          </p>
        </div>
        <label className="btn ghost" data-exception-filter>
          <input type="checkbox" checked={onlyEx} onChange={(e) => setOnlyEx(e.target.checked)} /> 只看异常 KOL
        </label>
      </div>

      <div className="pipeline-table" data-pipeline-table>
        <div className="pipeline-head" aria-hidden>
          <div className="pipeline-id-col">红人 / 负责人</div>
          <div className="pipeline-track-col">
            <div className="stage-domains">
              {domains.map((span) => (
                <span
                  key={`${span.domain}-${span.start}`}
                  style={{ gridColumn: `${span.start} / span ${span.count}` }}
                >
                  {DOMAIN_LABEL[span.domain] || span.domain}
                </span>
              ))}
            </div>
            <ol className="stage-track stage-track-legend" data-stage-axis>
              {stages.map((stage) => (
                <li key={stage.code} title={stage.label}>
                  {SHORT_STAGE_LABEL[stage.code] || stage.label}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {rows.map((c) => {
          const current = String(c.stage_code || "");
          const idx = stageIndex(stages, current);
          const open = selectedId === c.id;
          return (
            <article
              key={c.id}
              className={"pipeline-item" + (c.exception ? " exception" : "") + (open ? " is-open" : "")}
              data-kol={c.handle}
            >
              <button
                type="button"
                className="pipeline-row"
                data-pipeline-row
                aria-expanded={open}
                onClick={() => {
                  setSelectedId(c.id);
                  setTab("overview");
                  rememberJourney({ kind: "pipeline", handle: c.handle, stageCode: c.stage_code });
                }}
              >
                <span className="pipeline-id-col">
                  <strong>@{c.handle}</strong>
                  <span className="pipeline-id-meta">
                    <span className="chip">{c.brand}</span>
                    {c.owner_name ? <span className="pipeline-owner">{c.owner_name}</span> : null}
                    {c.exception ? <span className="badge-red">{c.stage_label}</span> : null}
                  </span>
                </span>
                <span className="pipeline-track-col">
                  <ol className="stage-track" aria-label={`${c.handle} 的 15 阶段进度`}>
                    {stages.map((stage, i) => {
                      const state = c.exception
                        ? "idle"
                        : idx < 0
                          ? "idle"
                          : i < idx
                            ? "done"
                            : i === idx
                              ? "current"
                              : "idle";
                      return (
                        <li key={stage.code}>
                          <span
                            className={"milestone is-" + state}
                            data-milestone={stage.code}
                            data-current={state === "current" ? "true" : "false"}
                            title={stage.label}
                          />
                        </li>
                      );
                    })}
                  </ol>
                </span>
              </button>

              {open && (
                <div className="pipeline-detail">
                  <div className="pipeline-tabs" role="tablist" aria-label={`${c.handle} 详情`}>
                    {([["overview", "概览"], ["creator", "达人"], ["actions", "动作"]] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        data-pipeline-tab={id}
                        onClick={() => setTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === "overview" && (
                    <dl className="pipeline-kv" data-pipeline-panel="overview">
                      <dt>正式阶段</dt>
                      <dd>{c.stage_label || "—"}</dd>
                      <dt>推进方式</dt>
                      <dd>{c.advancement_mode || "—"}</dd>
                      <dt>停留</dt>
                      <dd>{c.days_in_stage != null ? `${c.days_in_stage} 天` : "—"}</dd>
                      <dt>能力域</dt>
                      <dd>{DOMAIN_LABEL[String(c.capability_domain || "")] || c.capability_domain || "—"}</dd>
                      <dt>备注</dt>
                      <dd>{c.notes || "—"}</dd>
                    </dl>
                  )}
                  {tab === "creator" && (
                    <dl className="pipeline-kv" data-pipeline-panel="creator" data-creator-ledger>
                      <dt>负责人</dt>
                      <dd>{c.owner_name || "—"}</dd>
                      <dt>平台</dt>
                      <dd>{c.platform} · {c.followers}</dd>
                      <dt>互动率</dt>
                      <dd>{c.engagement_rate || "—"}</dd>
                      <dt>受众</dt>
                      <dd>{c.audience_geo || "—"}</dd>
                      <dt>近10条均播</dt>
                      <dd>{c.avg_views_10 || "—"}</dd>
                      <dt>查重</dt>
                      <dd>{Number(c.duplicate_checked) ? "已查" : "未查"}</dd>
                      <dt>集团交叉</dt>
                      <dd>{c.group_brand_overlap || "—"}</dd>
                      <dt>邮箱</dt>
                      <dd>{c.email || "—"}</dd>
                    </dl>
                  )}
                  {tab === "actions" && (
                    <div className="pipeline-actions" data-pipeline-panel="actions">
                      {cardActions(c).length ? cardActions(c).map((a) => (
                        <button
                          key={a.label}
                          className="btn ghost"
                          data-act={a.act}
                          data-intent={a.intent}
                          data-prompt={a.prompt}
                          onClick={() => ask(a)}
                        >
                          {a.label}
                        </button>
                      )) : <p className="muted">没有可执行动作。</p>}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!rows.length && <p className="muted">当前筛选下没有合作。</p>}
      </div>
    </div>
  );
}
