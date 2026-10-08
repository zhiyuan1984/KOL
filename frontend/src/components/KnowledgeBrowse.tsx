import type { ReactNode } from "react";
import type { KnowledgeRow } from "../api";
import { MAIN_STAGE_TABS } from "../kolStages";
import { formatKbTime, kbAuthorLabel, kbStatusLabel, kbVersionTag } from "../knowledgeCopy";
import CompactButton from "./CompactButton";

export function KnowledgeBrowseWorkspace({ children, detailOpen }: { children: ReactNode; detailOpen: boolean }) {
  return <div className="kbv-workspace knowledge-browse-workspace" data-pane={detailOpen ? "detail" : "list"}>{children}</div>;
}

export function KnowledgeFilterBar({ children }: { children: ReactNode }) {
  return <div className="kbv-tools knowledge-filter-bar">{children}</div>;
}

/** Five initial dictionary entries, with all other stages reachable without deriving them from results. */
export function StageFilterGroup({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const primary = MAIN_STAGE_TABS.slice(0, 5);
  const extra = MAIN_STAGE_TABS.slice(5);
  const shown = [...primary, ...extra.filter((stage) => selected.includes(stage.code))];
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((value) => value !== code) : [...selected, code]);
  return <div className="kbv-chip-row knowledge-stage-filter" data-kb-filter="stage" role="group" aria-label="适用阶段">
    <span className="kbv-scope-name">适用阶段</span>
    <CompactButton aria-pressed={!selected.length} data-kb-filter-value="" onClick={() => onChange([])}>全部</CompactButton>
    {shown.map((stage) => <CompactButton key={stage.code} aria-pressed={selected.includes(stage.code)}
      data-kb-filter-value={stage.code} onClick={() => toggle(stage.code)}>{stage.label}</CompactButton>)}
    {extra.some((stage) => !selected.includes(stage.code)) && <select className="knowledge-stage-more" aria-label="更多阶段" value=""
      onChange={(event) => { if (event.target.value) toggle(event.target.value); }}>
      <option value="">更多阶段</option>
      {extra.filter((stage) => !selected.includes(stage.code)).map((stage) => <option key={stage.code} value={stage.code}>{stage.label}</option>)}
    </select>}
  </div>;
}

export function KnowledgeListRow({ row, selected, favorite, icon, metadata, onOpen, onFavorite, onUse }: {
  row: KnowledgeRow; selected: boolean; favorite: boolean; icon: ReactNode; metadata: ReactNode;
  onOpen: () => void; onFavorite: () => void; onUse: () => void;
}) {
  return <article className="knowledge-list-row" data-kb-row={row.id}>
    <button type="button" className="knowledge-list-open" data-knowledge={row.id} data-kind={row.kind}
      data-cited={row.cited ? "true" : "false"} data-kb-open={row.id} aria-current={selected} onClick={onOpen}>
      <span className="knowledge-row-icon">{icon}</span>
      <span className="knowledge-row-copy">
        <span className="knowledge-row-title" title={row.title}>{row.title}</span>
        <span className="knowledge-row-metadata">{metadata}
          <span className="knowledge-row-time">{formatKbTime(row.updated_at || row.approved_at || row.created_at)} · {kbVersionTag(row.current_version)}</span>
        </span>
      </span>
    </button>
    <span className="knowledge-row-actions" aria-label={`${row.title} 快捷操作`}>
      <CompactButton data-kb-row-favorite={row.id} aria-pressed={favorite} onClick={onFavorite}>{favorite ? "已收藏" : "收藏"}</CompactButton>
      <CompactButton data-kb-row-use={row.id} onClick={onUse}>带入草稿</CompactButton>
    </span>
  </article>;
}

/** Already-fetched rows expand synchronously; only an actual request may set loading/error. */
export function ListLoadFooter({ remaining, onMore, loading = false, error = "", onRetry }: {
  remaining: number; onMore: () => void; loading?: boolean; error?: string; onRetry?: () => void;
}) {
  return <footer className="knowledge-load-footer" data-kb-load-footer aria-live="polite">
    {error ? <><span role="alert">{error}</span><CompactButton onClick={onRetry}>重试</CompactButton></>
      : remaining > 0 ? <CompactButton disabled={loading} data-kb-load-more onClick={onMore}>
        {loading ? "正在加载…" : `加载更多（剩余 ${remaining} 条）`}</CompactButton>
      : <span className="muted">已显示全部</span>}
  </footer>;
}

export function KnowledgeDetailHeader({ row, favorite, onFavorite, onBack }: {
  row: KnowledgeRow; favorite: boolean; onFavorite: () => void; onBack: () => void;
}) {
  return <header className="kbv-rail-head knowledge-detail-header">
    <CompactButton className="knowledge-back" onClick={onBack}>← 返回列表</CompactButton>
    <div className="kbv-title-row">
      <h2 id="kb-preview-title" tabIndex={-1}>{row.title}</h2>
      <CompactButton className="knowledge-favorite-icon" data-kb-favorite={row.id}
        title={favorite ? "取消收藏" : "收藏"} aria-label={favorite ? "取消收藏" : "收藏"}
        aria-pressed={favorite} onClick={onFavorite}><span aria-hidden="true">{favorite ? "★" : "☆"}</span></CompactButton>
    </div>
  </header>;
}

export function InlineMetadata({ row, scope }: { row: KnowledgeRow; scope: ReactNode }) {
  return <section className="knowledge-inline-metadata" data-kb-provenance aria-label="来源与版本">
    <span className="knowledge-status">{kbStatusLabel(row)}</span>
    <dl>
      <div><dt>发布人</dt><dd>{kbAuthorLabel(row.created_by)}</dd></div>
      <div><dt>版本</dt><dd>{kbVersionTag(row.current_version)}</dd></div>
      <div><dt>更新时间</dt><dd>{formatKbTime(row.updated_at || row.approved_at || row.created_at) || "暂无时间"}</dd></div>
    </dl>
    <div className="knowledge-scope-line"><span className="muted">适用</span>{scope}</div>
  </section>;
}

export function DetailActionBar({ children }: { children: ReactNode }) {
  return <footer className="kbv-rail-foot knowledge-detail-actions">
    <small className="muted">带入工作草稿只会预填内容；正式发送前仍需要你确认。</small>
    <div className="kbv-actions">{children}</div>
  </footer>;
}
