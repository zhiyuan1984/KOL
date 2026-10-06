import { useRef, useState } from "react";
import { kbDateOnly, kbDocStatusLabel, kbExpiryLabel, kbExpiryState, kindLabel, statusLabel } from "../../knowledgeCopy";
import type { KbAssetRow } from "./shared";
import KbvIcon from "../../knowledgeIcons";

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

/** 右栏浏览区：平面分页列表；点击条目在工作区原位进入详情。 */
export default function LibraryPane({
  rows, totalCount, page, pageCount, selectedId, onSelect, onPrevious, onNext, loading, onReset,
  selection, onToggleSelect, onBatchRenew, onBatchArchive,
}: Props) {
  const [renewOpen, setRenewOpen] = useState(false);
  const renewDateRef = useRef<HTMLInputElement>(null);
  const selected = selection || [];
  const batchable = Boolean(onToggleSelect && (onBatchRenew || onBatchArchive) && selected.length > 0);

  return (
    <section className="kbv-browser-list" aria-label="知识浏览" data-kbv-list>
      <header className="kbv-browser-list-head">
        <span data-kbv-count>{totalCount} 条知识{loading && rows.length > 0 ? "（更新中…）" : ""}</span>
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
          <p>请调整左侧筛选条件后重试。</p>
          {onReset ? <button type="button" className="kbv-text-action" data-kbv-empty-reset onClick={onReset}>清除筛选条件</button> : null}
        </div>
      ) : (
        <div className="kbv-browser-records" data-kbv-records>
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
  const status = String(row.status || "draft");
  const statusClass = status === "published"
    ? "is-published"
    : status === "pending_review"
      ? "is-pending"
      : status === "archived"
        ? "is-disabled"
        : "is-draft";
  const expiry = row.asset_type === "document" ? null : kbExpiryState(row.expires_at);
  const kindText = row.asset_type === "document" ? "PDF 文档" : kindLabel(row.kind);
  const statusText = row.publication_label
    || (row.asset_type === "document" ? kbDocStatusLabel(status) : statusLabel(status));
  const expiryText = expiry ? kbExpiryLabel(row.expires_at) : "";
  const dateText = row.updated_at ? kbDateOnly(row.updated_at) : "";
  const citeCount = Number(row.cite_count_30d || 0);
  // 单行行式下元信息会被裁切，完整值由 title 兜底（DESIGN §9.1 长文本规则）。
  const metaTitle = [kindText, statusText, expiryText, dateText].filter(Boolean).join(" · ");

  return (
    <div className="kbv-browser-record-wrap" data-kbv-record-wrap={row.id}>
      {onToggleSelect ? (
        <input
          type="checkbox" className="kbv-record-check" aria-label={`选择：${row.title}`}
          checked={checked} onChange={() => onToggleSelect(row.id)}
        />
      ) : null}
      <button
        type="button"
        className="kbv-browser-record"
        data-kbv-record={row.id}
        aria-current={selected}
        onClick={() => onSelect(row.id)}
      >
        <span className="kbv-record-heading"><span className="kbv-record-icon"><KbvIcon name={row.asset_type === "document" ? "pdf" : "book"} /></span><span className="kbv-record-title" title={row.title}>{row.title}</span></span>
        <span className="kbv-browser-record-meta" title={metaTitle}>
          <span className="kbv-record-kind">{kindText}</span>
          <span className={`kbv-status ${statusClass}`}>{statusText}</span>
          {citeCount > 0 ? <span className="kbv-record-cite" data-kbv-cite={row.id} title="近 30 天被引用次数">引用 {citeCount} 次</span> : null}
          {expiry ? <span className={`kbv-expiry is-${expiry}`} data-kbv-expiry={expiry}>{expiryText}</span> : null}
          {dateText ? <span className="kbv-record-date">{dateText}</span> : null}
        </span>
      </button>
    </div>
  );
}
