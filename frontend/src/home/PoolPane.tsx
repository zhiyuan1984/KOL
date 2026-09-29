import { useState } from "react";
import type { PoolKol } from "./kolContract";
import { selectAllChecked } from "./kolContract";
import type { PoolFilter, PoolSort, PoolSortField } from "./poolView";
import { poolSortState } from "./poolView";
import type { SurfaceDownView } from "./surfaceError";
import { isHighPoolScore, isPoolOverdue, poolScorePlaceholder } from "./poolView";
import { HOME_HANDOFF_TO_AGENT } from "./entryRegistry";
import ClaimFollowConfirm from "./ClaimFollowConfirm";

type PoolMetric = { key: "followers" | "avg-plays" | "engagement"; label: string; value: string };

function SearchIcon() {
  return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

function SortDirectionIcon({ direction, active }: { direction: "asc" | "desc"; active: boolean }) {
  return <svg className="pool-sort-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" data-active={active || undefined} data-direction={direction}>
    {active && direction === "asc" ? <path d="m8 12V4m0 0L5 7m3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {active && direction === "desc" ? <path d="M8 4v8m0 0 3-3m-3 3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {!active ? <><path d="m5 6 2-2 2 2M11 10l-2 2-2-2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 4v8m2-8v8" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></> : null}
  </svg>;
}

function ExternalLinkIcon() {
  return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
    <path d="M9 2.5h4.5V7M13.25 2.75 7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 9.25v2.25A2 2 0 0 1 11 13.5H4.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

function FactIcon({ type }: { type: "followers" | "avg-plays" | "engagement" | "ingested" }) {
  if (type === "followers") return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4" /><path d="M3 13c.5-2.4 2.1-3.6 5-3.6s4.5 1.2 5 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  if (type === "avg-plays") return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="M3 13V9m3 4V5m4 8V7m3 6V3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  if (type === "engagement") return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="M8 13.25s4.75-2.55 4.75-6.25A2.35 2.35 0 0 0 8.7 5.45L8 6.2l-.7-.75A2.35 2.35 0 0 0 3.25 7c0 3.7 4.75 6.25 4.75 6.25Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
  return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M5 2.5v2M11 2.5v2M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function ingested(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? `入库 ${date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" })}`
    : "入库时间未知";
}

function PoolAvatar({ card }: { card: PoolKol }) {
  const [failed, setFailed] = useState(false);
  const name = card.identity.display.replace(/^@/, "");
  if (card.identity.avatar_url && !failed) return <img className="pool-row-avatar" data-kol-avatar="source" src={card.identity.avatar_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return <span className="pool-row-avatar" data-kol-avatar="fallback" aria-hidden>{name.slice(0, 1) || "红"}</span>;
}

/** 已有评分取潜力分；与名称旁的「高潜/高风险」徽章并存，二者语义不同。 */
function PoolScore({ card }: { card: PoolKol }) {
  const raw = card.assessment?.potential_score;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const confidence = Math.round(Number(card.assessment?.potential_confidence || 0) * 100);
  const at = card.assessment?.assessed_at ? new Date(card.assessment.assessed_at) : null;
  const atLabel = at && !Number.isNaN(at.getTime()) ? ` · 评估于 ${at.toLocaleDateString("zh-CN")}` : "";
  const criteria = card.assessment?.criteria_summary ? ` · 口径 ${card.assessment.criteria_summary}` : "";
  return <span className="pool-row-score" data-pool-score="potential" title={`Jev 公开资料评估 · 置信度 ${confidence}%${atLabel}${criteria}`}>评分 {raw} · 置信度 {confidence}%</span>;
}

function PoolRow({ card, selected, claimBusy, claimTarget, claimError, claimed, onSelect, onClaim, onConfirm, onCancel }: {
  card: PoolKol; selected: boolean; claimBusy: boolean; claimTarget: boolean; claimError?: string | null;
  claimed: boolean; onSelect: (on: boolean) => void; onClaim: () => void; onConfirm: () => void; onCancel: () => void;
}) {
  const intro = [card.direction, card.style].filter(Boolean).join(" · ") || card.region;
  // 评分只依据公开资料：缺项要点名，别让「未评分」变成一句没有信息量的话。
  const missingPublicMetrics = [
    card.metrics.followers ? null : "粉丝数",
    card.metrics.avg_plays ? null : "均播",
    card.metrics.engagement ? null : "互动率",
    card.direction ? null : "内容方向",
  ].filter((value): value is string => value !== null);
  const scorePlaceholder = card.assessment?.potential_score == null
    ? poolScorePlaceholder(card.assessment, missingPublicMetrics)
    : null;
  const metrics: PoolMetric[] = [
    card.metrics.followers ? { key: "followers", label: "粉丝", value: card.metrics.followers } : null,
    card.metrics.avg_plays ? { key: "avg-plays", label: "均播", value: card.metrics.avg_plays } : null,
    card.metrics.engagement ? { key: "engagement", label: "互动", value: card.metrics.engagement } : null,
  ].filter((metric): metric is PoolMetric => metric !== null);
  const stage = card.public_stage?.label || "未首次建联";
  const highPotential = isHighPoolScore(card.assessment?.potential_score, card.assessment?.potential_confidence);
  const highRisk = isHighPoolScore(card.assessment?.risk_score, card.assessment?.risk_confidence);

  return <article className="pool-kol-row" data-pool-kol={card.kol_uid} data-pool-card data-kol-work-card data-selected={selected || undefined} data-claimed={claimed || undefined} data-pool-quality={metrics.length ? "ready" : "partial"}>
    <label className="pool-row-select"><input type="checkbox" data-pool-select={card.kol_uid} checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span className="sr-only">选择 {card.identity.display}</span></label>
    <PoolAvatar card={card} />
    <div className="pool-row-content">
      <div className="pool-row-heading"><strong className="pool-row-name" data-kol-identity data-kol-name>{card.identity.display}</strong>
        <span className="pool-row-status" data-public-stage data-stage-code={card.public_stage?.code || undefined} data-overdue={isPoolOverdue(card) || undefined} data-stage-label>{stage}</span>
        {highPotential && <span className="pool-jev-badge is-potential" data-jev-potential title={`Jev 公开资料评估 · 置信度 ${Math.round(Number(card.assessment?.potential_confidence || 0) * 100)}%`}>高潜 {card.assessment?.potential_score}</span>}
        {highRisk && <span className="pool-jev-badge is-risk" data-jev-risk title={`Jev 公开资料评估 · 置信度 ${Math.round(Number(card.assessment?.risk_confidence || 0) * 100)}%`}>高风险 {card.assessment?.risk_score}</span>}</div>
      <div className="pool-row-meta" data-kol-scope>
        {card.identity.platform && <span data-kol-chip="platform">{card.identity.platform}</span>}<span>在库</span>
        {card.identity.profile_url && <a className="pool-profile-link" href={card.identity.profile_url} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${card.identity.display} 的平台主页`} title={`打开 ${card.identity.display} 的平台主页`}>主页 <ExternalLinkIcon /></a>}
        <PoolScore card={card} />
        {scorePlaceholder && (
          <span className="pool-row-score is-missing" data-pool-score="missing" data-pool-score-state={scorePlaceholder.state} title={scorePlaceholder.title}>{scorePlaceholder.label}</span>
        )}
      </div>
      <div className="pool-row-facts">
        <span className="pool-row-metrics" data-pool-metrics>{metrics.length ? metrics.map((metric) => <span key={metric.key} data-pool-metric={metric.key}><FactIcon type={metric.key} />{metric.label} <b>{metric.value}</b></span>) : <span className="pool-row-missing-data">公开指标待补充</span>}</span>
        <span className="pool-row-ingested" data-pool-ingested><FactIcon type="ingested" />{ingested(card.ingested_at)}</span>
      </div>
      {intro && <p className="pool-row-intro" data-pool-public-fields title={intro}>{intro}</p>}
      {claimTarget && <ClaimFollowConfirm card={card} busy={claimBusy} error={claimError} onConfirm={onConfirm} onCancel={onCancel} />}
    </div>
    <div className="pool-row-actions"><button type="button" className="pool-claim-button" data-pool-claim data-home-entry="claim-kol" disabled={claimBusy || claimed} onClick={onClaim}>{claimed ? "已领取 ✓" : claimBusy ? "正在领取…" : "领取跟进"}</button></div>
  </article>;
}

function SortButton({ field, label, sort, onToggle }: { field: PoolSortField; label: string; sort: PoolSort; onToggle: (field: PoolSortField) => void }) {
  const state = poolSortState(sort);
  const active = state.field === field;
  const direction = active ? state.direction : "desc";
  return <button type="button" className="pool-sort-button" data-pool-sort={field} data-sort-direction={active ? direction : undefined}
    title={`按${label}${active && direction === "asc" ? "降序" : "升序"}排列`} onClick={() => onToggle(field)}>
    <span>{label}</span><SortDirectionIcon active={active} direction={direction} />
  </button>;
}

export default function PoolPane({ cards, totalCount, isFiltered, selectedIds, query, filter, sort, down, claimBusyId, claimTarget, claimError, claimedId, libraryCount, syncBusy, syncError, syncNotice, undoAvailable, undoBusy, undoError, poolLoaded, onQuery, onFilter, onToggleSort, onToggleSelect, onToggleSelectAll, onSyncLibrary, onClaim, onConfirmClaim, onCancelClaim, onUndoClaim }: {
  cards: PoolKol[]; totalCount: number; isFiltered: boolean; selectedIds: string[]; query: string; filter: PoolFilter; sort: PoolSort; down?: SurfaceDownView | null;
  claimBusyId?: string | null; claimTarget?: PoolKol | null; claimError?: string | null; claimedId?: string | null;
  libraryCount?: number | null; syncBusy?: boolean; syncError?: string | null; syncNotice?: string | null; undoAvailable?: boolean; undoBusy?: boolean; undoError?: string | null;
  /** 首轮公海读取是否已返回；false 时只呈现真实等待态，不对空结果下结论。 */
  poolLoaded?: boolean;
  onQuery: (value: string) => void; onFilter: (value: PoolFilter) => void; onToggleSort: (field: PoolSortField) => void; onToggleSelect: (id: string, on: boolean) => void; onToggleSelectAll: (ids: string[], on: boolean) => void; onSyncLibrary?: () => void; onClaim: (card: PoolKol) => void; onConfirmClaim: () => void; onCancelClaim: () => void; onUndoClaim?: () => void;
}) {
  const [syncRequested, setSyncRequested] = useState(false);
  const queryDown = Boolean(down);
  // 空态必须等「公海读到 0 条」与「红人库状态已知」两个事实都到位才下结论；
  // 未读到不等于 0，读取期间不得冒充「红人库还没有同步」。
  const poolReadPending = poolLoaded === false;
  const libraryPending = poolLoaded === true && totalCount === 0 && !isFiltered && libraryCount == null;
  const loading = !queryDown && (poolReadPending || libraryPending);
  const libraryUnsynced = !queryDown && !loading && totalCount === 0 && libraryCount === 0;
  const visibleIds = cards.map((card) => card.kol_uid);
  const selectedVisibleIds = visibleIds.filter((id) => selectedIds.includes(id));

  return <section className="pool-compact-pane is-result-rail" data-pool-overview>
    <div className="pool-compact-toolbar" data-pool-toolbar data-home-entry="list-pool" aria-label="筛选与排序公海对象">
      <div className="pool-toolbar-primary">
        <label className="pool-search"><SearchIcon /><span className="sr-only">搜索公海对象</span>
          <input type="search" data-pool-search value={query} placeholder="搜索" onChange={(event) => onQuery(event.target.value)} />
        </label>
        <label className="pool-select-all" title="全选当前筛选结果"><input type="checkbox" data-pool-select-all
          checked={selectAllChecked(cards.length, selectedVisibleIds.length)} disabled={!cards.length}
          onChange={(event) => onToggleSelectAll(visibleIds, event.target.checked)} /><span>全选</span></label>
        <button type="button" className="pool-filter-button" data-pool-filter="new" aria-pressed={filter === "new"}
          onClick={() => onFilter(filter === "new" ? "all" : "new")}>未首次建联</button>
        <button type="button" className="pool-filter-button" data-pool-filter="overdue" aria-pressed={filter === "overdue"}
          onClick={() => onFilter(filter === "overdue" ? "all" : "overdue")}>14天未联系</button>
      </div>
      <div className="pool-toolbar-sort" aria-label="公海排序">
        <SortButton field="ingested" label="入库时间" sort={sort} onToggle={onToggleSort} />
        <SortButton field="followers" label="粉丝数" sort={sort} onToggle={onToggleSort} />
        <SortButton field="score" label="评分" sort={sort} onToggle={onToggleSort} />
      </div>
    </div>
    {syncNotice ? <p className="pool-score-feedback" role="status" data-pool-sync-notice>{syncNotice}</p> : null}
    {undoAvailable && <div className="pool-claim-undo" role="status" data-pool-claim-undo><span>已领取</span><span aria-hidden>·</span><button type="button" data-pool-claim-undo-button data-home-entry="release-follow" disabled={undoBusy} onClick={onUndoClaim}>{undoBusy ? "正在撤销…" : "撤销"}</button>{undoError && <span className="pool-claim-undo-error" role="alert">{undoError}</span>}</div>}
    {cards.length ? <div className="pool-compact-list" data-pool-list data-pool-focus-list data-pool-origin="public">
      {cards.map((card) => <PoolRow key={card.kol_uid} card={card} selected={selectedIds.includes(card.kol_uid)} claimBusy={claimBusyId === card.kol_uid} claimTarget={claimTarget?.kol_uid === card.kol_uid} claimError={claimError} claimed={claimedId === card.kol_uid} onSelect={(on) => onToggleSelect(card.kol_uid, on)} onClaim={() => onClaim(card)} onConfirm={onConfirmClaim} onCancel={onCancelClaim} />)}
    </div> : <div className="task-empty" data-pool-empty={loading ? "loading" : queryDown ? "down" : totalCount || isFiltered ? "filtered" : "none"} data-empty-kind={loading ? "loading" : queryDown ? "service-down" : totalCount || isFiltered ? "filter-empty" : "no-data"}>
      <strong role={loading ? "status" : undefined}>{loading ? "正在读取公海…" : queryDown ? "公海暂时不可用" : totalCount || isFiltered ? "当前范围没有匹配的公海对象" : libraryUnsynced ? syncRequested ? "已请求同步红人库" : "红人库还没有同步" : "公海暂无可领取对象"}</strong>
      {loading ? null : queryDown && down ? <><p className="muted" data-pool-down-reason title={down.detail || undefined}>{down.message}</p><div className="task-empty-actions"><button type="button" className="btn ghost sm" data-pool-retry disabled={down.retrying} onClick={down.onRetry}>重试</button><button type="button" className="btn work sm" data-pool-handoff-agent data-home-entry="composer-analyze" onClick={down.onHandoff}>{HOME_HANDOFF_TO_AGENT}</button></div></> : !totalCount && !queryDown ? <div className="task-empty-actions"><button type="button" className="btn work sm" data-pool-sync-library data-home-entry="sync-pool-library" disabled={!onSyncLibrary || syncBusy} onClick={() => { setSyncRequested(true); onSyncLibrary?.(); }}>{syncBusy ? "正在同步红人库…" : syncRequested ? "重新同步红人库" : "立即同步红人库"}</button>{syncError && <p className="pool-sync-error" role="alert">{syncError}</p>}</div> : null}
    </div>}
  </section>;
}
