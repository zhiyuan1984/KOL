import { useState, type ReactNode } from "react";
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

/** Preview: ten initial chips including All; removing chips never changes the dictionary. */
export function StageFilterGroup({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [shownCodes, setShownCodes] = useState(() => MAIN_STAGE_TABS.slice(0, 9).map(stage => stage.code));
  const [adding, setAdding] = useState(false);
  const shown = MAIN_STAGE_TABS.filter(stage => shownCodes.includes(stage.code) || selected.includes(stage.code));
  const extra = MAIN_STAGE_TABS.filter(stage => !shown.some(item => item.code === stage.code));
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter(value => value !== code) : [...selected, code]);
  const remove = (code: string) => {
    setShownCodes(codes => codes.filter(value => value !== code));
    onChange(selected.filter(value => value !== code));
  };
  return <div className="kbv-chip-row knowledge-stage-filter" data-kb-filter="stage" role="group" aria-label="适用阶段">
    <span className="kbv-scope-name">适用阶段</span>
    <div className="knowledge-stage-chips">
      <CompactButton className="knowledge-stage-all" aria-pressed={!selected.length} data-kb-filter-value="" onClick={() => onChange([])}>全部</CompactButton>
      {shown.map(stage => <span key={stage.code} className="knowledge-stage-chip" data-selected={selected.includes(stage.code)}>
        <CompactButton aria-pressed={selected.includes(stage.code)} data-kb-filter-value={stage.code} onClick={() => toggle(stage.code)}>{stage.label}</CompactButton>
        <button type="button" className="knowledge-stage-remove" aria-label={`移除阶段：${stage.label}`} onClick={() => remove(stage.code)}>×</button>
      </span>)}
      {extra.length > 0 && <span className="knowledge-stage-add-wrap">
        <CompactButton className="knowledge-stage-add" aria-label="添加阶段" aria-expanded={adding} onClick={() => setAdding(value => !value)}>+</CompactButton>
        {adding && <div className="knowledge-stage-picker" role="group" aria-label="可添加阶段" onKeyDown={event => { if (event.key === "Escape") setAdding(false); }}>
          {extra.map(stage => <CompactButton key={stage.code} onClick={() => { setShownCodes(codes => [...codes, stage.code]); onChange([...selected, stage.code]); setAdding(false); }}>{stage.label}</CompactButton>)}
          <CompactButton onClick={() => setAdding(false)}>取消</CompactButton>
        </div>}
      </span>}
    </div>
  </div>;
}

export function KnowledgeListRow({ row, selected, kind, onOpen }: {
  row: KnowledgeRow; selected: boolean; kind: string; onOpen: () => void;
}) {
  return <article className="knowledge-list-row" data-kb-row={row.id}>
    <button type="button" className="knowledge-list-open" data-knowledge={row.id} data-kind={row.kind}
      data-cited={row.cited ? "true" : "false"} data-kb-open={row.id} aria-current={selected} onClick={onOpen}>
      <span className="knowledge-row-title" title={row.title}>{row.title}</span>
      <span className="knowledge-row-kind">{kind}</span>
    </button>
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
