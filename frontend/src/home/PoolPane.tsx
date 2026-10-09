import { useState } from "react";
import type { PoolKol } from "./kolContract";
import type { PoolClaimReceipts, PoolFilter, PoolGlobalCounts, PoolSort, PoolSortField } from "./poolView";
import { poolSortState } from "./poolView";
import type { SurfaceDownView } from "./surfaceError";
import { isHighPoolScore, isPoolOverdue, poolScorePlaceholder } from "./poolView";
import { HOME_HANDOFF_TO_AGENT } from "./entryRegistry";
import type { HomePoolPage } from "../api";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { KolCardActions, KolCardEvidence, KolCardIdentity, KolCardMeta, KolCardSelection, KolCardShell } from "../components/kol/KolCardShell";
import KolAvatar from "../components/kol/KolAvatar";
import KolAction from "../components/kol/KolCardActions";
import { KolFactIcon } from "../components/kol/KolFactIcon";

type PoolMetric = { key: "followers" | "avg-plays" | "engagement"; label: string; value: string };

function SortDirectionIcon({ direction, active }: { direction: "asc" | "desc"; active: boolean }) {
  return <svg className="pool-sort-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none" data-active={active || undefined} data-direction={direction}>
    {active && direction === "asc" ? <path d="m8 12V4m0 0L5 7m3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {active && direction === "desc" ? <path d="M8 4v8m0 0 3-3m-3 3-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {!active ? <><path d="m5 6 2-2 2 2M11 10l-2 2-2-2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 4v8m2-8v8" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /></> : null}
  </svg>;
}

function ingested(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? `入库 ${date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" })}`
    : "入库时间未知";
}

/** 已有评分取潜力分；与名称旁的「高潜/高风险」徽章并存，二者语义不同。 */
function PoolScore({ card }: { card: PoolKol }) {
  const raw = card.assessment?.potential_score;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const confidence = Math.round(Number(card.assessment?.potential_confidence || 0) * 100);
  const at = card.assessment?.assessed_at ? new Date(card.assessment.assessed_at) : null;
  const atLabel = at && !Number.isNaN(at.getTime()) ? ` · 评估于 ${at.toLocaleDateString("zh-CN")}` : "";
  const criteria = card.assessment?.criteria_summary ? ` · 口径 ${card.assessment.criteria_summary}` : "";
  return <>
    <span className="kol-card-score" data-pool-score="potential" title={`公开资料评估 · 置信度 ${confidence}%${atLabel}${criteria}`}>评分 {raw} · 置信度 {confidence}%</span>
    {card.assessment?.criteria_summary ? <KolCardEvidence className="pool-score-evidence" label="评分依据" data-pool-score-evidence>
      <p>{card.assessment.criteria_summary}</p>
      {card.assessment.assessed_at ? <p>评估于 {new Date(card.assessment.assessed_at).toLocaleString("zh-CN")}</p> : null}
    </KolCardEvidence> : null}
  </>;
}

function PoolRow({ card, selected, claimBusy, claimError, claimed, onSelect, onClaim, onRelease, onRefresh }: {
  card: PoolKol; selected: boolean; claimBusy: boolean; claimError?: string | null;
  claimed: boolean; onSelect: (on: boolean) => void; onClaim: () => void | Promise<void>; onRelease: () => void | Promise<void>; onRefresh?: () => void | Promise<void>;
}) {
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
  const stage = claimed ? "我的跟进" : card.public_stage?.label || "未首次建联";
  const highPotential = isHighPoolScore(card.assessment?.potential_score, card.assessment?.potential_confidence);
  const highRisk = isHighPoolScore(card.assessment?.risk_score, card.assessment?.risk_confidence);
  const direction = [card.direction, card.style].filter(Boolean).join(" · ");

  return <KolCardShell variant="pool" data-pool-kol={card.kol_uid} data-pool-card data-kol-work-card data-selected={selected || undefined} data-claimed={claimed || undefined} data-pool-quality={metrics.length ? "ready" : "partial"}>
    <KolCardIdentity>
      <KolCardSelection data-pool-select={card.kol_uid} aria-label={`选择 ${card.identity.display}`} checked={selected} disabled={claimed}
        onChange={(event) => { if (!claimed) onSelect(event.target.checked); }} />
      <KolAvatar name={card.identity.display} src={card.identity.avatar_url} identityKey={card.kol_uid} />
      <strong className="kol-card-name" data-kol-identity data-kol-name title={card.identity.display}>{card.identity.display}</strong>
      <span className="kol-card-state" data-public-stage data-stage-code={card.public_stage?.code || undefined} data-overdue={isPoolOverdue(card) || undefined} data-stage-label>{stage}</span>
      {highPotential && <span className="kol-card-state" data-jev-potential title={`Jev 公开资料评估 · 置信度 ${Math.round(Number(card.assessment?.potential_confidence || 0) * 100)}%`}>高潜</span>}
      {highRisk && <span className="kol-card-state" data-jev-risk title={`Jev 公开资料评估 · 置信度 ${Math.round(Number(card.assessment?.risk_confidence || 0) * 100)}%`}>高风险 {card.assessment?.risk_score}</span>}
      <PoolScore card={card} />
    </KolCardIdentity>
    <KolCardMeta data-pool-metrics>
      {card.identity.platform && <span data-kol-chip="platform">{card.identity.platform}</span>}
      {card.region && <span>{card.region}</span>}
      {direction && <span>{direction}</span>}
      <span data-pool-ingested>{ingested(card.ingested_at)}</span>
      {metrics.length ? metrics.map((metric) => <span key={metric.key} data-pool-metric={metric.key}><KolFactIcon type={metric.key} />{metric.label} <b>{metric.value}</b></span>) : <span>公开指标待补充</span>}
      {scorePlaceholder && <span data-pool-score="missing" data-pool-score-state={scorePlaceholder.state} title={scorePlaceholder.title}>{scorePlaceholder.label}</span>}
      {card.identity.profile_url && <a className="kol-card-link" href={card.identity.profile_url} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${card.identity.display} 的平台主页`} title={`打开 ${card.identity.display} 的平台主页`}>主页 <KolFactIcon type="external" /></a>}
    </KolCardMeta>
    <KolCardActions data-pool-actions>
      <KolAction data-pool-claim={claimed ? undefined : "true"} data-pool-release={claimed || undefined} data-home-entry={claimed ? "release-follow" : "claim-kol"}
        disabled={claimBusy} onClick={() => { void (claimed ? onRelease() : onClaim()); }}>
        {claimBusy ? claimed ? "正在放回…" : "正在领取…" : claimed ? "放回公海" : "领取跟进"}
      </KolAction>
      {claimError ? <><p className="kol-card-error" role="alert">{claimError}</p>{onRefresh ? <KolAction data-pool-refresh-ownership disabled={claimBusy} onClick={() => { void onRefresh(); }}>刷新归属状态</KolAction> : null}</> : null}
    </KolCardActions>
  </KolCardShell>;
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

export default function PoolPane({ cards, totalCount, matchedCount, filterCounts, isFiltered, selectedIds, query, filter, sort, down, claimBusyId, claimTarget, claimErrorId, claimError, claimReceipts, claimedId, libraryCount, syncBusy, syncError, syncNotice, undoAvailable, undoBusy, undoError, poolLoaded, page, onPage, onQuery, onFilter, onToggleSort, onToggleSelect, onToggleSelectAll, onSyncLibrary, onClaim, onReleaseClaim, onRefreshOwnership, onConfirmClaim, onCancelClaim, onUndoClaim }: {
  cards: PoolKol[]; totalCount: number; isFiltered: boolean; selectedIds: string[]; query: string; filter: PoolFilter; sort: PoolSort; down?: SurfaceDownView | null;
  matchedCount?: number; filterCounts?: PoolGlobalCounts | null;
  claimBusyId?: string | null; claimTarget?: PoolKol | null; claimErrorId?: string | null; claimError?: string | null; claimedId?: string | null;
  claimReceipts?: PoolClaimReceipts;
  libraryCount?: number | null; syncBusy?: boolean; syncError?: string | null; syncNotice?: string | null; undoAvailable?: boolean; undoBusy?: boolean; undoError?: string | null;
  /** 首轮公海读取是否已返回；false 时只呈现真实等待态，不对空结果下结论。 */
  poolLoaded?: boolean;
  page?: HomePoolPage | null;
  onPage?: (offset: number) => void;
  onQuery: (value: string) => void; onFilter: (value: PoolFilter) => void; onToggleSort: (field: PoolSortField) => void; onToggleSelect: (id: string, on: boolean) => void; onToggleSelectAll: (ids: string[], on: boolean) => void; onSyncLibrary?: () => void; onClaim: (card: PoolKol) => void | Promise<void>; onReleaseClaim?: (kolUid: string) => void | Promise<void>; onRefreshOwnership?: (kolUid: string) => void | Promise<void>;
  /** Legacy modal props remain optional until Home removes its previous wiring. */
  onConfirmClaim?: () => void; onCancelClaim?: () => void; onUndoClaim?: () => void;
}) {
  const [syncRequested, setSyncRequested] = useState(false);
  const queryDown = Boolean(down);
  // 空态必须等「公海读到 0 条」与「红人库状态已知」两个事实都到位才下结论；
  // 未读到不等于 0，读取期间不得冒充「红人库还没有同步」。
  const poolReadPending = poolLoaded === false;
  const libraryPending = poolLoaded === true && totalCount === 0 && !isFiltered && libraryCount == null;
  const loading = !queryDown && (poolReadPending || libraryPending);
  const libraryUnsynced = !queryDown && !loading && totalCount === 0 && libraryCount === 0;
  const visibleIds = cards.filter((card) => !claimReceipts?.[card.kol_uid] && claimedId !== card.kol_uid).map((card) => card.kol_uid);
  const selectedVisibleIds = visibleIds.filter((id) => selectedIds.includes(id));
  const pageCount = page ? Math.max(1, Math.ceil((matchedCount ?? page.matched) / page.limit)) : 1;
  const hasMultiplePages = pageCount > 1;

  return <section className="pool-compact-pane is-result-rail" data-pool-overview>
    <div className="pool-compact-toolbar" data-pool-toolbar data-home-entry="list-pool" aria-label="筛选与排序公海对象">
      <div className="pool-toolbar-primary">
        <WorkspaceSearchInput className="pool-search" data-pool-search value={query} placeholder="搜索公海对象" aria-label="搜索公海对象" onChange={(event) => onQuery(event.target.value)} />
        <label className="pool-select-all" title="选择当前页（不跨页）"><input type="checkbox" data-pool-select-all
          checked={visibleIds.length > 0 && selectedVisibleIds.length >= visibleIds.length} disabled={!visibleIds.length || loading}
          onChange={(event) => onToggleSelectAll(visibleIds, event.target.checked)} /><span>全选</span>{visibleIds.length ? <span className="pool-count-badge" data-pool-select-page-count>{visibleIds.length}</span> : null}</label>
        <button type="button" className="pool-filter-button" data-pool-filter="new" aria-pressed={filter === "new"}
          onClick={() => onFilter(filter === "new" ? "all" : "new")}>未首次建联{!loading && !queryDown && filterCounts ? <span className="pool-count-badge" data-pool-filter-count="new">{filterCounts.newCount}</span> : null}</button>
        <button type="button" className="pool-filter-button" data-pool-filter="overdue" aria-pressed={filter === "overdue"}
          onClick={() => onFilter(filter === "overdue" ? "all" : "overdue")}>14天未联系{!loading && !queryDown && filterCounts ? <span className="pool-count-badge" data-pool-filter-count="overdue">{filterCounts.overdueCount}</span> : null}</button>
      </div>
      <div className="pool-toolbar-sort" aria-label="公海排序">
        <SortButton field="ingested" label="入库时间" sort={sort} onToggle={onToggleSort} />
        <SortButton field="followers" label="粉丝数" sort={sort} onToggle={onToggleSort} />
        <SortButton field="score" label="评分" sort={sort} onToggle={onToggleSort} />
      </div>
    </div>
    {syncNotice ? <p className="pool-score-feedback" role="status" data-pool-sync-notice>{syncNotice}</p> : null}
    {loading && cards.length ? <p className="pool-score-feedback" role="status">正在读取公海…</p> : null}
    {page && !loading && !queryDown ? <nav className="pool-pagination" aria-label="公海分页" data-pool-pagination>
      <span role="status" data-pool-count>共 {matchedCount ?? page.matched} 位 · 第 {Math.floor(page.offset / page.limit) + 1} / {pageCount} 页</span>
      {hasMultiplePages && onPage ? <><button type="button" className="btn ghost sm" data-pool-previous disabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>上一页</button>
      <button type="button" className="btn ghost sm" data-pool-next disabled={page.next_offset == null} onClick={() => { if (page.next_offset != null) onPage(page.next_offset); }}>下一页</button></> : null}
    </nav> : null}
    {!loading && cards.length ? <div className="pool-compact-list" data-pool-list data-pool-focus-list data-pool-origin="public">
      {cards.map((card) => {
        const receipt = claimReceipts?.[card.kol_uid];
        const claimed = Boolean(receipt) || claimedId === card.kol_uid;
        const targetError = (claimErrorId || claimTarget?.kol_uid) === card.kol_uid ? claimError : null;
        return <PoolRow key={card.kol_uid} card={card} selected={selectedIds.includes(card.kol_uid)} claimBusy={claimBusyId === card.kol_uid} claimError={targetError} claimed={claimed}
          onRefresh={onRefreshOwnership ? () => onRefreshOwnership(card.kol_uid) : undefined}
          onSelect={(on) => onToggleSelect(card.kol_uid, on)} onClaim={() => onClaim(card)} onRelease={() => { if (receipt) return onReleaseClaim?.(receipt.kolUid); }} />;
      })}
    </div> : <div className="task-empty" data-pool-empty={loading ? "loading" : queryDown ? "down" : totalCount || isFiltered ? "filtered" : "none"} data-empty-kind={loading ? "loading" : queryDown ? "service-down" : totalCount || isFiltered ? "filter-empty" : "no-data"}>
      <strong role={loading ? "status" : undefined}>{loading ? "正在读取公海…" : queryDown ? "公海暂时不可用" : totalCount || isFiltered ? "当前范围没有匹配的公海对象" : libraryUnsynced ? syncRequested ? "已请求同步红人库" : "红人库还没有同步" : "公海暂无可领取对象"}</strong>
      {loading ? null : queryDown && down ? <><p className="muted" data-pool-down-reason title={down.detail || undefined}>{down.message}</p><div className="task-empty-actions"><button type="button" className="btn ghost sm" data-pool-retry disabled={down.retrying} onClick={down.onRetry}>重试</button><button type="button" className="btn work sm" data-pool-handoff-agent data-home-entry="composer-analyze" onClick={down.onHandoff}>{HOME_HANDOFF_TO_AGENT}</button></div></> : !totalCount && !queryDown ? <div className="task-empty-actions"><button type="button" className="btn work sm" data-pool-sync-library data-home-entry="sync-pool-library" disabled={!onSyncLibrary || syncBusy} onClick={() => { setSyncRequested(true); onSyncLibrary?.(); }}>{syncBusy ? "正在同步红人库…" : syncRequested ? "重新同步红人库" : "立即同步红人库"}</button>{syncError && <p className="pool-sync-error" role="alert">{syncError}</p>}</div> : null}
    </div>}
  </section>;
}
