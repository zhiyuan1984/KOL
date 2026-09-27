import type { ReactNode } from "react";
import type { PoolKol } from "./kolContract";
import { KOL_SELECT_MAX, selectAllChecked, selectAllLabel } from "./kolContract";
import type { PoolFilter, PoolSort } from "./poolView";

function SearchIcon() {
  return <svg className="pool-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export default function PoolInteraction({
  totalCount,
  visibleCards,
  selectedIds,
  query,
  filter,
  sort,
  maintenanceBusy,
  maintenanceNotice,
  maintenanceError,
  cleanupPreview,
  interaction,
  onQuery,
  onFilter,
  onSort,
  onToggleSelectAll,
  onClearSelection,
  onAnalyzeSelected,
  onEnrichAvatars,
  onAssessWithJev,
  onRequestCleanupPreview,
  onConfirmCleanup,
  onCancelCleanup,
}: {
  totalCount: number;
  visibleCards: PoolKol[];
  selectedIds: string[];
  query: string;
  filter: PoolFilter;
  sort: PoolSort;
  maintenanceBusy?: "avatars" | "jev" | "cleanup" | null;
  maintenanceNotice?: string | null;
  maintenanceError?: string | null;
  cleanupPreview?: { candidateCount: number; protectedActiveFollows: number } | null;
  interaction?: ReactNode;
  onQuery: (value: string) => void;
  onFilter: (value: PoolFilter) => void;
  onSort: (value: PoolSort) => void;
  onToggleSelectAll: (ids: string[], on: boolean) => void;
  onClearSelection: () => void;
  onAnalyzeSelected: (ids: string[]) => void;
  onEnrichAvatars?: () => void;
  onAssessWithJev?: () => void;
  onRequestCleanupPreview?: () => void;
  onConfirmCleanup?: () => void;
  onCancelCleanup?: () => void;
}) {
  const visibleIds = visibleCards.map((card) => card.kol_uid);
  const selectedVisibleIds = visibleIds.filter((id) => selectedIds.includes(id));
  const hasSelection = selectedVisibleIds.length > 0;
  const hasScopeRule = Boolean(query.trim()) || filter !== "all" || sort !== "default";

  return <section className="object-interaction pool-interaction" data-object-interaction="pool" data-pool-interaction>
    <header className="pool-interaction-header">
      <div className="object-interaction-status" role="status">
        <span aria-hidden>{hasSelection ? "✓" : "○"}</span>
        <strong>{hasSelection ? `已定义 ${selectedVisibleIds.length} 位分析对象` : "先定义本轮分析范围"}</strong>
      </div>
      <h1 data-home-title="pool">公海：先筛选，再与 Agent 讨论下一步</h1>
      <p>选择范围、提出问题和资料维护都在这里完成；右栏只保留公开对象、勾选与需要确认的领取动作。</p>
    </header>

    <div className="pool-compact-toolbar" data-pool-toolbar data-home-entry="list-pool" aria-label="定义公海分析范围">
      <label className="pool-search"><SearchIcon /><span className="sr-only">搜索公海对象</span>
        <input type="search" data-pool-search value={query} placeholder="搜索名称、平台或方向" onChange={(event) => onQuery(event.target.value)} />
      </label>
      <label className="pool-control"><span className="sr-only">筛选状态</span><select data-pool-filter value={filter} onChange={(event) => onFilter(event.target.value as PoolFilter)}>
        <option value="all">全部对象</option><option value="new">未首次建联</option><option value="overdue">14天无回复</option><option value="high-potential">高潜</option><option value="high-risk">高风险</option></select></label>
      <label className="pool-control"><span className="sr-only">排序</span><select data-pool-sort value={sort} onChange={(event) => onSort(event.target.value as PoolSort)}>
        <option value="default">默认排序</option><option value="newest">最近入库</option><option value="followers">粉丝数</option><option value="potential">潜力</option></select></label>
      <label className="pool-select-all" title="全选当前筛选结果"><input type="checkbox" data-pool-select-all
        checked={selectAllChecked(visibleCards.length, selectedVisibleIds.length)} disabled={!visibleCards.length}
        onChange={(event) => onToggleSelectAll(visibleIds, event.target.checked)} />
        <span>{selectAllLabel(visibleCards.length, "全选当前")}</span></label>
      <div className="pool-interaction-actions">
        <span className="pool-selected-summary" data-pool-selected-count>
          {hasSelection ? `当前已选 ${selectedVisibleIds.length} / ${KOL_SELECT_MAX}` : hasScopeRule ? `当前范围 ${visibleCards.length} / ${totalCount}` : `可见 ${visibleCards.length} / ${totalCount}`}
        </span>
        {hasSelection ? <button type="button" className="pool-selection-clear" data-pool-clear-selection onClick={onClearSelection}>清除选择</button> : null}
        <button type="button" className="pool-analyze-button" data-analyze-selected data-home-entry="kol-analyze-enqueue"
          disabled={!hasSelection} onClick={() => onAnalyzeSelected(selectedVisibleIds)}>填入提问框</button>
      </div>
    </div>

    <div className="pool-agent-starters" data-pool-agent-starters>
      <div>
        <strong>下一步，与 Agent 讨论</strong>
        <p>{hasSelection ? "问题会带入当前选择；填写后由你决定是否发送。" : "先在右栏勾选对象，再把问题带入提问框。"}</p>
      </div>
      <div className="pool-agent-starter-actions">
        <button type="button" data-pool-agent-starter="compare" disabled={!hasSelection}
          onClick={() => onAnalyzeSelected(selectedVisibleIds)}>比较合作潜力与风险</button>
        <button type="button" data-pool-agent-starter="verify" disabled={!hasSelection}
          onClick={() => onAnalyzeSelected(selectedVisibleIds)}>检查公开资料缺口</button>
      </div>
    </div>

    <section className="pool-maintenance" data-pool-maintenance aria-label="公海资料维护">
      <div className="pool-maintenance-heading"><strong>资料维护</strong><span>只处理公开索引，不读取非公开跟进资料。</span></div>
      <div className="pool-maintenance-actions">
        <button type="button" data-pool-avatar-enrich data-home-entry="enrich-pool-avatars" disabled={Boolean(maintenanceBusy)}
          onClick={onEnrichAvatars}>{maintenanceBusy === "avatars" ? "补全中…" : "补头像"}</button>
        <button type="button" data-pool-jev-assess data-home-entry="assess-pool-jev" disabled={Boolean(maintenanceBusy)}
          onClick={onAssessWithJev}>{maintenanceBusy === "jev" ? "评分中…" : "Jev 评分"}</button>
        <button type="button" data-pool-cleanup-preview disabled={Boolean(maintenanceBusy)}
          onClick={onRequestCleanupPreview}>{maintenanceBusy === "cleanup" ? "读取中…" : "清理无主页"}</button>
      </div>
      {maintenanceNotice && <span className="pool-maintenance-notice" role="status">{maintenanceNotice}</span>}
      {maintenanceError && <span className="pool-maintenance-error" role="alert">{maintenanceError}</span>}
    </section>
    {cleanupPreview && <div className="pool-cleanup-confirm" data-pool-cleanup-confirm>
      <span>将删除 <b>{cleanupPreview.candidateCount}</b> 条无主页公海档案；{cleanupPreview.protectedActiveFollows
        ? `${cleanupPreview.protectedActiveFollows} 条已跟进档案会保留。` : "已跟进档案会保留。"}</span>
      <button type="button" data-pool-cleanup-confirm-button data-home-entry="cleanup-pool-missing-homepage"
        disabled={Boolean(maintenanceBusy)} onClick={onConfirmCleanup}>确认删除</button>
      <button type="button" data-pool-cleanup-cancel disabled={Boolean(maintenanceBusy)} onClick={onCancelCleanup}>取消</button>
    </div>}
    {interaction}
  </section>;
}
