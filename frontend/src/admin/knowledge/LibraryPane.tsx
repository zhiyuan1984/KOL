import { useEffect, useRef, useState } from "react";
import { kindLabel } from "../../knowledgeCopy";
import type { KbAssetRow } from "./shared";
import { KnowledgeListRow } from "../../components/KnowledgeBrowse";

export type KbView = "all" | "pending" | "published" | "draft" | "disabled";

type Props = {
  rows: KbAssetRow[];
  totalCount: number;
  page: number;
  pageCount: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  loading: boolean;
  /** 空态的恢复动作（§9.3 动作内联）：一键清掉当前筛选条件。 */
  onReset?: () => void;
  /** 批量续期 / 归档（C）：勾选行 id。 */
  selection?: string[];
  onToggleSelect?: (id: string) => void;
  onBatchRenew?: (ids: string[], expiresAt: string) => void;
  onBatchArchive?: (ids: string[]) => void;
};

/** 中栏浏览区：平面分页列表；点击条目在右栏工作区进入详情。 */
export default function LibraryPane({
  rows, totalCount, page, pageCount, selectedId, onSelect, onPrevious, onNext, loading, onReset,
  selection, onToggleSelect, onBatchRenew, onBatchArchive,
}: Props) {
  const [renewOpen, setRenewOpen] = useState(false);
  const renewDateRef = useRef<HTMLInputElement>(null);
  const selected = selection || [];
  const batchable = Boolean(onToggleSelect && (onBatchRenew || onBatchArchive) && selected.length > 0);
  // 全选：只作用于当前页可见行。
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allChecked = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const someChecked = !allChecked && rows.some((row) => selected.includes(row.id));
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);
  const toggleSelectAll = () => {
    if (!onToggleSelect) return;
    if (allChecked) {
      rows.forEach((row) => { if (selected.includes(row.id)) onToggleSelect(row.id); });
    } else {
      rows.forEach((row) => { if (!selected.includes(row.id)) onToggleSelect(row.id); });
    }
  };

  return (
    <section className="kbv-browser-list" aria-label="知识浏览" data-kbv-list>
      <header className="kbv-browser-list-head">
        <span className="kbv-list-head-select">
          {onToggleSelect && rows.length > 0 ? (
            <input
              ref={selectAllRef}
              type="checkbox"
              className="kbv-record-check"
              aria-label="全选本页"
              title="全选本页"
              checked={allChecked}
              onChange={toggleSelectAll}
            />
          ) : null}
          <span data-kbv-count>{totalCount} 条知识{loading && rows.length > 0 ? "（更新中…）" : ""}</span>
        </span>
        {batchable ? (
          <div className="kbv-batch-bar" data-kbv-batch role="toolbar" aria-label="批量操作">
            <span>已选 {selected.length} 条</span>
            {onBatchRenew ? <button type="button" className="kbv-text-action" onClick={() => setRenewOpen(true)}>批量续期</button> : null}
            {onBatchArchive ? <button type="button" className="kbv-text-action kbv-text-danger" onClick={() => { if (window.confirm(`确认归档选中的 ${selected.length} 条知识？归档后新的运行不再解析到它们。`)) onBatchArchive(selected); }}>批量归档</button> : null}
            {onToggleSelect ? <button type="button" className="kbv-text-action" onClick={() => selected.forEach((id) => onToggleSelect(id))}>清除选择</button> : null}
          </div>
        ) : null}
        <nav className="kbv-pagination" aria-label="知识分页">
          <button type="button" className="kbv-text-action" data-kbv-prev disabled={page <= 1} onClick={onPrevious}>上一页</button>
          <span data-kbv-page>第 {page} / {pageCount} 页</span>
          <button type="button" className="kbv-text-action" data-kbv-next disabled={page >= pageCount} onClick={onNext}>下一页</button>
        </nav>
      </header>

      {renewOpen ? (
        <div className="kbv-batch-dialog" data-kbv-renew-dialog role="dialog" aria-label="批量续期">
          <label>续期至 <input ref={renewDateRef} type="date" data-kbv-renew-date /></label>
          <div>
            <button
              type="button" className="kbv-text-action"
              onClick={() => {
                const value = renewDateRef.current?.value || "";
                if (!value) return;
                onBatchRenew?.(selected, new Date(`${value}T23:59:59`).toISOString());
                setRenewOpen(false);
              }}
            >确认续期</button>
            <button type="button" className="kbv-text-action" onClick={() => setRenewOpen(false)}>取消</button>
          </div>
        </div>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className="kbv-empty" role="status">正在加载知识列表…</p>
      ) : rows.length === 0 ? (
        <div className="kbv-empty" data-kbv-empty>
          <h3>没有匹配的知识</h3>
          <p>请调整上方筛选条件后重试。</p>
          {onReset ? <button type="button" className="kbv-text-action" data-kbv-empty-reset onClick={onReset}>清除筛选条件</button> : null}
        </div>
      ) : (
        <div className="kbv-browser-records" data-kbv-records>
          <div className={`kbv-list-columns${onToggleSelect ? " has-selection" : ""}`} data-kbv-list-columns aria-hidden="true">
            <span>知识名称</span><span>类型</span>
          </div>
          {rows.map((row) => (
            <RecordRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              checked={selected.includes(row.id)}
              onToggleSelect={onToggleSelect}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordRow({ row, selected, checked, onToggleSelect, onSelect }: {
  row: KbAssetRow;
  selected: boolean;
  checked: boolean;
  onToggleSelect?: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  // workspace-v1 exposes asset identity but not the original media format.
  // Do not infer PDF from the document asset type (video/audio also live here).
  return <KnowledgeListRow row={row} selected={selected} kind={row.asset_type === "document" ? "文档资料" : kindLabel(row.kind)} preserveTitleTail={row.asset_type === "document"}
    onOpen={()=>onSelect(row.id)} openAttributes={{ "data-kbv-record": row.id }} recordAttributes={{ "data-kbv-record-wrap": row.id }}
    leading={onToggleSelect ? <input type="checkbox" className="kbv-record-check" aria-label={`选择：${row.title}`} checked={checked} onChange={()=>onToggleSelect(row.id)} /> : null} />;
}
