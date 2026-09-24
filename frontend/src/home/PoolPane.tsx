import { useState } from "react";
import type { PoolKol } from "./kolContract";
import { KOL_SELECT_MAX } from "./kolContract";
import { HOME_HANDOFF_TO_AGENT } from "./entryRegistry";
import type { SurfaceDownView } from "./surfaceError";
import ClaimFollowConfirm from "./ClaimFollowConfirm";

function ingested(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? `入库 ${date.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" })}`
    : "入库时间未知";
}

function metricNumber(value?: string) {
  const raw = (value || "").trim();
  const number = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(number)) return 0;
  return number * (raw.includes("万") ? 10_000 : /k$/i.test(raw) ? 1_000 : 1);
}

function PoolAvatar({ card }: { card: PoolKol }) {
  const [failed, setFailed] = useState(false);
  const name = card.identity.display.replace(/^@/, "");
  if (card.identity.avatar_url && !failed) {
    return <img className="pool-row-avatar" data-kol-avatar="source" src={card.identity.avatar_url}
      alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className="pool-row-avatar" data-kol-avatar="fallback" aria-hidden>{name.slice(0, 1) || "红"}</span>;
}

function PoolRow({ card, selected, claimBusy, claimTarget, claimError, claimed, onSelect, onClaim, onConfirm, onCancel }: {
  card: PoolKol; selected: boolean; claimBusy: boolean; claimTarget: boolean; claimError?: string | null;
  claimed: boolean; onSelect: (on: boolean) => void; onClaim: () => void; onConfirm: () => void; onCancel: () => void;
}) {
  const [more, setMore] = useState(false);
  const intro = [card.direction, card.region, card.style].filter(Boolean).join(" · ");
  const metrics = [
    card.metrics.followers && `粉丝 ${card.metrics.followers}`,
    card.metrics.avg_plays && `均播 ${card.metrics.avg_plays}`,
    card.metrics.engagement && `互动 ${card.metrics.engagement}`,
  ].filter(Boolean).join(" · ");
  const stage = card.public_stage?.label || "未首次建联";
  return <article className="pool-kol-row" data-pool-kol={card.kol_uid} data-pool-card data-kol-work-card
    data-selected={selected || undefined} data-claimed={claimed || undefined}>
    <label className="pool-row-select"><input type="checkbox" data-pool-select={card.kol_uid} checked={selected}
      onChange={(e) => onSelect(e.target.checked)} /><span className="sr-only">选择 {card.identity.display}</span></label>
    <PoolAvatar card={card} />
    <div className="pool-row-content">
      <div className="pool-row-heading"><strong className="pool-row-name" data-kol-identity data-kol-name>{card.identity.display}</strong>
        <span className="pool-row-status" data-public-stage data-stage-code={card.public_stage?.code || undefined}
          data-overdue={stage.includes("14") && stage.includes("回复") || undefined} data-stage-label>{stage}</span></div>
      <div className="pool-row-meta" data-kol-scope>
        {card.identity.platform && <span data-kol-chip="platform">{card.identity.platform}</span>}
        <span>在库</span>
        {card.idle?.label && card.idle.label !== "在库" && <span data-kol-chip="idle">{card.idle.label}</span>}
        <span data-pool-ingested>{ingested(card.ingested_at)}</span>
      </div>
      <div className="pool-row-metrics" data-pool-metrics>{metrics || "暂无公开数据"}</div>
      <p className="pool-row-intro" data-pool-public-fields title={intro || undefined}>{intro || "暂无简介"}</p>
      {claimTarget && <ClaimFollowConfirm card={card} busy={claimBusy} error={claimError}
        onConfirm={onConfirm} onCancel={onCancel} />}
    </div>
    <div className="pool-row-actions">
      <button type="button" className="pool-claim-button" data-pool-claim data-home-entry="claim-kol"
        disabled={claimBusy || claimed} onClick={onClaim}>{claimed ? "已领取 ✓" : claimBusy ? "正在领取…" : "领取跟进"}</button>
      <div className="pool-more-wrap">
        <button type="button" className="pool-more-button" data-pool-more aria-label={`更多操作：${card.identity.display}`}
          aria-expanded={more} onClick={() => setMore(!more)}>⋯</button>
        {more && <div className="pool-more-menu">{card.identity.profile_url
          ? <a href={card.identity.profile_url} target="_blank" rel="noopener noreferrer" data-pool-profile-link>打开平台主页 ↗</a>
          : <span>暂无平台主页</span>}</div>}
      </div>
    </div>
  </article>;
}

export default function PoolPane({ cards, selectedIds, query, down, claimBusyId, claimTarget, claimError, claimedId,
  libraryCount, syncBusy, undoAvailable, undoBusy, undoError, onQuery, onToggleSelect, onToggleSelectAll, onAnalyzeSelected, onClaim,
  onConfirmClaim, onCancelClaim, onUndoClaim, onSyncLibrary }: {
  cards: PoolKol[]; selectedIds: string[]; query: string; down?: SurfaceDownView | null;
  claimBusyId?: string | null; claimTarget?: PoolKol | null; claimError?: string | null; claimedId?: string | null;
  libraryCount?: number | null; syncBusy?: boolean; undoAvailable?: boolean; undoBusy?: boolean; undoError?: string | null;
  onQuery: (value: string) => void;
  onToggleSelect: (id: string, on: boolean) => void; onToggleSelectAll: (on: boolean) => void;
  onAnalyzeSelected: () => void; onClaim: (card: PoolKol) => void; onConfirmClaim: () => void;
  onCancelClaim: () => void; onUndoClaim?: () => void; onSyncLibrary?: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("default");
  const [syncRequested, setSyncRequested] = useState(false);
  const queryDown = Boolean(down);
  const libraryUnsynced = !queryDown && !cards.length && !Number(libraryCount || 0);
  const needle = query.trim().toLowerCase();
  const visible = cards.filter((card) => {
    const stage = card.public_stage?.label || "";
    const overdue = stage.includes("14") && stage.includes("回复");
    return (filter === "all" || (filter === "overdue" ? overdue : stage.includes("未首次建联")))
      && (!needle || [card.identity.display, card.identity.platform, card.direction, card.region, card.style, stage]
        .join(" ").toLowerCase().includes(needle));
  });
  if (sort === "newest") visible.sort((a, b) => (Date.parse(b.ingested_at || "") || 0) - (Date.parse(a.ingested_at || "") || 0));
  if (sort === "followers") visible.sort((a, b) => metricNumber(b.metrics.followers) - metricNumber(a.metrics.followers));
  return <section className="pool-compact-pane is-result-rail" data-pool-overview>
    <div className="pool-compact-header"><h2>公海对象 <span data-pool-total>[{cards.length}]</span></h2>
      {selectedIds.length > 0 && <span data-pool-selected-count>已选 {selectedIds.length} / {KOL_SELECT_MAX}</span>}</div>
    <div className="pool-compact-toolbar" data-pool-toolbar data-home-entry="list-pool">
      <label className="pool-search"><span className="sr-only">搜索公海对象</span>
        <input type="search" data-pool-search value={query} placeholder="搜索公海对象" onChange={(e) => onQuery(e.target.value)} /></label>
      <label className="pool-control"><span className="sr-only">筛选状态</span><select data-pool-filter value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">筛选</option><option value="new">未首次建联</option><option value="overdue">14天无回复</option></select></label>
      <label className="pool-control"><span className="sr-only">排序</span><select data-pool-sort value={sort} onChange={(e) => setSort(e.target.value)}>
        <option value="default">排序</option><option value="newest">最近入库</option><option value="followers">粉丝数</option></select></label>
      <label className="pool-select-all"><input type="checkbox" data-pool-select-all
        checked={visible.length > 0 && visible.every((card) => selectedIds.includes(card.kol_uid))}
        disabled={!visible.length} onChange={(e) => onToggleSelectAll(e.target.checked)} />
        <span className="sr-only">全选公海对象</span></label>
      <button type="button" className="pool-analyze-button" data-analyze-selected data-home-entry="kol-analyze-enqueue"
        disabled={!selectedIds.length} onClick={onAnalyzeSelected}>分析已选</button>
    </div>
    {undoAvailable && <div className="pool-claim-undo" role="status" data-pool-claim-undo>
      <span>已领取</span><span aria-hidden>·</span>
      <button type="button" data-pool-claim-undo-button data-home-entry="release-follow" disabled={undoBusy}
        onClick={onUndoClaim}>{undoBusy ? "正在撤销…" : "撤销"}</button>
      {undoError && <span className="pool-claim-undo-error" role="alert">{undoError}</span>}
    </div>}
    {visible.length ? <div className="pool-compact-list" data-pool-list data-pool-origin="public">
      {visible.map((card) => <PoolRow key={card.kol_uid} card={card} selected={selectedIds.includes(card.kol_uid)}
        claimBusy={claimBusyId === card.kol_uid} claimTarget={claimTarget?.kol_uid === card.kol_uid}
        claimError={claimError} claimed={claimedId === card.kol_uid}
        onSelect={(on) => onToggleSelect(card.kol_uid, on)} onClaim={() => onClaim(card)}
        onConfirm={onConfirmClaim} onCancel={onCancelClaim} />)}
    </div> : <div className="task-empty" data-pool-empty={queryDown ? "down" : cards.length ? "filtered" : "none"}
      data-empty-kind={queryDown ? "service-down" : cards.length ? "filter-empty" : "no-data"}>
      <strong>{queryDown ? "公海暂时不可用" : cards.length ? "没有匹配的公海对象" : libraryUnsynced
        ? syncRequested ? "已请求同步红人库" : "红人库还没有同步" : "公海暂无可领取对象"}</strong>
      {queryDown && down ? <><p className="muted" data-pool-down-reason title={down.detail || undefined}>{down.message}</p>
        <div className="task-empty-actions"><button type="button" className="btn ghost sm" data-pool-retry disabled={down.retrying}
          onClick={down.onRetry}>重试</button><button type="button" className="btn work sm" data-pool-handoff-agent
          data-home-entry="composer-analyze" onClick={down.onHandoff}>{HOME_HANDOFF_TO_AGENT}</button></div></>
        : !cards.length && !queryDown ? <div className="task-empty-actions"><button type="button" className="btn work sm"
          data-pool-sync-library disabled={!onSyncLibrary || syncBusy} onClick={() => { setSyncRequested(true); onSyncLibrary?.(); }}>
          {syncBusy ? "正在同步红人库…" : syncRequested ? "重新同步红人库" : "立即同步红人库"}</button></div> : null}
    </div>}
  </section>;
}
