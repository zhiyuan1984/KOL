import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { storePending } from "../components/ChatBlocks";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { FALLBACK_MAIN_STAGES, SHORT_STAGE_LABEL } from "../kolStages";
import { rememberJourney } from "../journey";
import {
  EXCEPTION_PRODUCT_KINDS,
  groupedPipelineTargets,
  pipelineStageConfirm,
  type PipelineStageTarget,
} from "../stageTargets";

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
  overdue?: number;
  source?: string;
  synced_at?: string;
  last_skip_kind?: string;
  last_skip_reason?: string;
  last_skipped_stages?: string;
  recent_events?: { at?: string; label?: string }[];
  mail_summary?: string;
  audit?: { at?: string; actor?: string; event?: string }[];
};

const FALLBACK_STAGES: StageSpec[] = FALLBACK_MAIN_STAGES;

const DOMAIN_LABEL: Record<string, string> = {
  Lead: "触达",
  Opportunity: "意向",
  Negotiation: "商务",
  Execution: "履约",
  "Settlement-Growth": "结算",
};

const FILTER_KEYS = ["brand", "owner", "stage", "region", "sync"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function stageIndex(stages: StageSpec[], code?: string) {
  return stages.findIndex((stage) => stage.code === code);
}

const EXCEPTION_STATES = EXCEPTION_PRODUCT_KINDS.map((item) => ({
  code: item.code,
  label: item.label,
}));

function isCompletedNode(code?: string) {
  return String(code || "") === "COMPLETED";
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

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh"));
}

function regionOf(card: Card) {
  return String(card.audience_geo || "").trim();
}

function syncSourceOf(card: Card) {
  return String(card.source || "").trim();
}

function stageRisk(card: Card) {
  if (card.exception) return "已离开主时间线";
  if (Number(card.overdue) === 1) return "逾期";
  if (card.days_in_stage != null && Number(card.days_in_stage) >= 7) return `停留 ${card.days_in_stage} 天`;
  return "正常";
}

function EmptyHint({ children }: { children: string }) {
  return <p className="muted pipeline-empty-hint">{children}</p>;
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
  const [targetCode, setTargetCode] = useState("");
  const [proposing, setProposing] = useState(false);
  const { ask, dialog } = useAdminConfirm();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const kolQuery = params.get("kol");
  const filters = {
    brand: params.get("brand") || "",
    owner: params.get("owner") || "",
    stage: params.get("stage") || "",
    region: params.get("region") || "",
    sync: params.get("sync") || "",
  };

  useEffect(() => {
    api.pipeline(onlyEx ? 1 : 0).then(setData as never);
  }, [onlyEx]);

  const stages = data?.stages?.length ? data.stages : FALLBACK_STAGES;
  const pool = useMemo(() => {
    if (!data) return [];
    return [
      ...data.columns.flatMap((col) => data.groups[col] || []),
      ...data.exceptions,
    ];
  }, [data]);

  const matchesFilters = (card: Card) => {
    if (filters.brand && card.brand !== filters.brand) return false;
    if (filters.owner && String(card.owner_name || "") !== filters.owner) return false;
    if (filters.stage && String(card.stage_code || "") !== filters.stage) return false;
    if (filters.region && regionOf(card) !== filters.region) return false;
    if (filters.sync && syncSourceOf(card) !== filters.sync) return false;
    return true;
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const base = onlyEx ? data.exceptions : data.columns.flatMap((col) => data.groups[col] || []);
    return base.filter(matchesFilters);
  }, [data, onlyEx, filters.brand, filters.owner, filters.stage, filters.region, filters.sync]);

  useEffect(() => {
    if (!data || !kolQuery) return;
    const wanted = pool.find((row) => row.handle === kolQuery);
    if (!wanted) return;
    if (Boolean(wanted.exception) !== onlyEx) {
      setOnlyEx(Boolean(wanted.exception));
      return;
    }
    setSelectedId(wanted.id);
  }, [data, kolQuery, onlyEx, pool]);

  useEffect(() => {
    if (!selectedId) return;
    if (rows.some((row) => row.id === selectedId)) return;
    setSelectedId(null);
    if (!kolQuery) return;
    const next = new URLSearchParams(params);
    next.delete("kol");
    setParams(next, { replace: true });
  }, [rows, selectedId, kolQuery, params, setParams]);

  const setFilter = (key: FilterKey, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const openCard = (card: Card) => {
    rememberJourney({ kind: "pipeline", handle: card.handle, stageCode: card.stage_code });
    if (selectedId === card.id && kolQuery === card.handle) {
      closeDrawer();
      return;
    }
    setSelectedId(card.id);
    const next = new URLSearchParams(params);
    next.set("kol", card.handle);
    setParams(next, { replace: true });
  };

  const closeDrawer = () => {
    setSelectedId(null);
    const next = new URLSearchParams(params);
    next.delete("kol");
    setParams(next, { replace: true });
  };

  const proposeStageChange = async (card: Card, target: PipelineStageTarget) => {
    if (proposing) return;
    setProposing(true);
    try {
      const ses = await api.openKolSession(card.id);
      storePending(ses.id, {
        text: `提出阶段变更 @${card.handle} 到 ${target.label}`,
        collaboration_id: card.id,
        intent: "confirm_stage",
        entities: {
          handle: card.handle,
          stage_code: target.code,
        },
      });
      sessionStorage.setItem(`kol-session:${ses.id}`, "1");
      nav(`/s/${ses.id}`, { state: { kolSession: true } });
    } finally {
      setProposing(false);
    }
  };

  useEffect(() => {
    setTargetCode("");
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, params]);

  if (!data) return <p className="muted">加载生命周期…</p>;

  const domains = domainSpans(stages);
  const exceptionNames = (data.side_stages?.length ? data.side_stages : EXCEPTION_STATES)
    .filter((stage) => !isCompletedNode(stage.code))
    .map((stage) => stage.label)
    .join("、");
  const selected = selectedId ? pool.find((card) => card.id === selectedId) || null : null;
  const targetGroups = selected ? groupedPipelineTargets(selected.stage_code, selected.exception) : [];
  const pickedTarget = targetGroups.flatMap((group) => group.items).find((item) => item.code === targetCode) || null;
  const filterOptions = {
    brand: unique(pool.map((card) => card.brand)),
    owner: unique(pool.map((card) => card.owner_name)),
    stage: unique(pool.map((card) => card.stage_code)).map((code) => ({
      code,
      label: pool.find((card) => card.stage_code === code)?.stage_label || code,
    })),
    region: unique(pool.map(regionOf)),
    sync: unique(pool.map(syncSourceOf)),
  };

  return (
    <div className={"pipeline-page" + (selected ? " has-drawer" : "")}>
      <div className="page-kicker">合作</div>
      <h1 style={{ marginTop: 0 }}>KOL 全生命周期管理</h1>
      <p className="muted">
        这是合作资产页，不是创建新项目，也不是今日待办。看正式阶段、负责人、停留和旁路状态。
        点选红人打开右侧详情；阶段动作必须选定具体目标阶段后再「提出阶段变更」，不能用「下一阶段」。
      </p>
      {dialog}

      <div className="pipeline-filters" data-pipeline-filters>
        <label>
          品牌
          <select data-filter="brand" value={filters.brand} onChange={(event) => setFilter("brand", event.target.value)}>
            <option value="">全部</option>
            {filterOptions.brand.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          负责人
          <select data-filter="owner" value={filters.owner} onChange={(event) => setFilter("owner", event.target.value)}>
            <option value="">全部</option>
            {filterOptions.owner.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          阶段
          <select data-filter="stage" value={filters.stage} onChange={(event) => setFilter("stage", event.target.value)}>
            <option value="">全部</option>
            {filterOptions.stage.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        {filterOptions.region.length ? (
          <label>
            地区
            <select data-filter="region" value={filters.region} onChange={(event) => setFilter("region", event.target.value)}>
              <option value="">全部</option>
              {filterOptions.region.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        ) : null}
        {filterOptions.sync.length ? (
          <label>
            同步来源
            <select data-filter="sync" value={filters.sync} onChange={(event) => setFilter("sync", event.target.value)}>
              <option value="">全部</option>
              {filterOptions.sync.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="exception-bar" data-exception-bar>
        <div>
          <strong>
            旁路 / 异常阶段 {data.exceptions.length}{" "}
            {data.exceptions.map((e) => (
              <span key={e.handle} className="badge-red">
                @{e.handle} · {e.stage_label}
              </span>
            ))}
          </strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {exceptionNames} 是异常这一个产品节点的种类，会离开主时间线，可在此筛选。不是首页的「等待中」，已完成也不是产品图节点。
          </p>
        </div>
        <label className="btn ghost" data-exception-filter>
          <input type="checkbox" checked={onlyEx} onChange={(e) => setOnlyEx(e.target.checked)} /> 只看旁路 / 异常阶段
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
            <ol className="stage-track stage-track-legend" data-stage-axis aria-label="15 个正式阶段位置图例，人确认可跳转、回退、进出异常">
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
              className={"pipeline-item" + (c.exception ? " exception" : "") + (open ? " is-selected" : "")}
              data-kol={c.handle}
            >
              <button
                type="button"
                className="pipeline-row"
                data-pipeline-row
                aria-expanded={open}
                onClick={() => openCard(c)}
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
                  <ol className="stage-track" aria-label={`${c.handle} 的 15 阶段位置（可跳转、回退、进出异常）`}>
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
            </article>
          );
        })}
        {!rows.length && <p className="muted" data-pipeline-empty>当前筛选下没有合作。</p>}
      </div>

      {selected ? (
        <aside
          className="pipeline-drawer"
          data-pipeline-drawer
          role="dialog"
          aria-label={`${selected.handle} 合作详情`}
        >
            <header className="pipeline-drawer-head">
              <div>
                <p className="page-kicker">合作详情</p>
                <h2>@{selected.handle}</h2>
                <div className="pipeline-id-meta">
                  <span className="chip">{selected.brand}</span>
                  {selected.owner_name ? <span className="pipeline-owner">{selected.owner_name}</span> : null}
                </div>
              </div>
              <button type="button" className="btn ghost" data-pipeline-drawer-close onClick={closeDrawer}>关闭</button>
            </header>

            <div className="pipeline-drawer-body">
              <section>
                <h3>基本合作信息</h3>
                <dl className="pipeline-kv" data-pipeline-panel="overview" data-creator-ledger>
                  <dt>负责人</dt>
                  <dd>{selected.owner_name || "—"}</dd>
                  <dt>品牌</dt>
                  <dd>{selected.brand || "—"}</dd>
                  <dt>平台</dt>
                  <dd>{[selected.platform, selected.followers].filter(Boolean).join(" · ") || "—"}</dd>
                  <dt>地区</dt>
                  <dd>{regionOf(selected) || "—"}</dd>
                  <dt>邮箱</dt>
                  <dd>{selected.email || "—"}</dd>
                  <dt>备注</dt>
                  <dd>{selected.notes || "—"}</dd>
                </dl>
              </section>

              <section>
                <h3>正式阶段</h3>
                <dl className="pipeline-kv">
                  <dt>阶段</dt>
                  <dd>{selected.stage_label || "—"}</dd>
                  <dt>推进方式</dt>
                  <dd>{selected.advancement_mode || "—"}</dd>
                  <dt>停留</dt>
                  <dd>{selected.days_in_stage != null ? `${selected.days_in_stage} 天` : "—"}</dd>
                  <dt>能力域</dt>
                  <dd>{DOMAIN_LABEL[String(selected.capability_domain || "")] || selected.capability_domain || "—"}</dd>
                  <dt>阶段风险</dt>
                  <dd data-stage-risk>{stageRisk(selected)}</dd>
                </dl>
              </section>

              <section>
                <h3>阶段位置</h3>
                <p className="muted" data-stage-graph-note>
                  下图是 15 个正式阶段的位置图例，不是只能相邻前进。人确认可以跳转、回退、进出异常。
                </p>
                <ol className="stage-track pipeline-drawer-track" aria-label={`${selected.handle} 的 15 阶段位置图例`}>
                  {stages.map((stage, i) => {
                    const idx = stageIndex(stages, selected.stage_code);
                    const state = selected.exception
                      ? "idle"
                      : idx < 0
                        ? "idle"
                        : i < idx
                          ? "done"
                          : i === idx
                            ? "current"
                            : "idle";
                    return (
                      <li key={stage.code} title={stage.label}>
                        <span className={"milestone is-" + state} data-milestone={stage.code} />
                        <span className="pipeline-drawer-tick">{SHORT_STAGE_LABEL[stage.code] || stage.label}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section data-stage-graph="product">
                <h3>合法目标阶段</h3>
                <p className="muted" data-pipeline-stage-hint>
                  从产品图选择具体目标阶段。不能用「下一阶段」。已完成不是可选节点。
                </p>
                {targetGroups.length ? (
                  <div className="stage-chip-picker" data-stage-select data-value={targetCode} role="radiogroup" aria-label="目标阶段">
                    {targetGroups.map((group) => (
                      <div key={group.id} className="stage-chip-group" data-stage-track={group.id}>
                        <p className="stage-chip-group-label">{group.label}</p>
                        <div className="stage-chip-row">
                          {group.items.map((item) => {
                            const selectedTarget = item.code === targetCode;
                            return (
                              <button
                                key={item.code}
                                type="button"
                                role="radio"
                                aria-checked={selectedTarget}
                                className={"stage-chip" + (selectedTarget ? " is-selected" : "")}
                                data-stage-chip
                                data-stage-code={item.code}
                                data-stage-target={item.code}
                                data-stage-kind={item.kind}
                                title={item.note}
                                onClick={() => setTargetCode(item.code)}
                              >
                                <span className="stage-chip-name">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前阶段没有可写的产品图目标。</p>
                )}
              </section>

              <section>
                <h3>阶段证据</h3>
                {selected.notes || selected.last_skip_reason ? (
                  <dl className="pipeline-kv">
                    <dt>备注</dt>
                    <dd>{selected.notes || "—"}</dd>
                    <dt>跳过说明</dt>
                    <dd>{selected.last_skip_reason || "—"}</dd>
                  </dl>
                ) : (
                  <EmptyHint>本页未返回阶段证据。</EmptyHint>
                )}
              </section>

              <section>
                <h3>往来摘要</h3>
                {selected.mail_summary ? <p>{selected.mail_summary}</p> : <EmptyHint>本页未返回往来摘要。</EmptyHint>}
              </section>

              <section>
                <h3>阶段变更历史</h3>
                {selected.last_skip_kind || selected.last_skipped_stages ? (
                  <dl className="pipeline-kv">
                    <dt>最近跳过</dt>
                    <dd>{selected.last_skip_kind || "—"}</dd>
                    <dt>被跳过阶段</dt>
                    <dd>{selected.last_skipped_stages || "—"}</dd>
                  </dl>
                ) : (
                  <EmptyHint>尚无本页可展示的阶段变更记录。</EmptyHint>
                )}
              </section>

              <section>
                <h3>近期事件</h3>
                {selected.recent_events?.length ? (
                  <ul>
                    {selected.recent_events.map((event, index) => (
                      <li key={`${event.at || event.label || index}`}>{[event.at, event.label].filter(Boolean).join(" · ")}</li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>本页未返回近期事件。</EmptyHint>
                )}
              </section>

              <section>
                <h3>同步</h3>
                {syncSourceOf(selected) || selected.synced_at ? (
                  <dl className="pipeline-kv">
                    <dt>来源</dt>
                    <dd>{syncSourceOf(selected) || "—"}</dd>
                    <dt>时间</dt>
                    <dd>{selected.synced_at || "本页未返回同步时间"}</dd>
                  </dl>
                ) : (
                  <EmptyHint>本页未返回同步来源或时间。</EmptyHint>
                )}
              </section>

              <section>
                <h3>审计</h3>
                {selected.audit?.length ? (
                  <ul>
                    {selected.audit.map((row, index) => (
                      <li key={`${row.at || row.event || index}`}>{[row.at, row.actor, row.event].filter(Boolean).join(" · ")}</li>
                    ))}
                  </ul>
                ) : (
                  <EmptyHint>本页未返回审计记录。</EmptyHint>
                )}
              </section>
            </div>

            <footer className="pipeline-drawer-foot">
              <button
                type="button"
                className="btn work"
                data-propose-stage
                data-act="ask"
                data-intent="confirm_stage"
                data-target-stage={pickedTarget?.code || undefined}
                disabled={proposing || !pickedTarget}
                onClick={() => {
                  if (!pickedTarget) return;
                  ask(pipelineStageConfirm(selected.handle, selected.stage_label, pickedTarget), () =>
                    proposeStageChange(selected, pickedTarget),
                  );
                }}
              >
                提出阶段变更
              </button>
            </footer>
        </aside>
      ) : null}
    </div>
  );
}
