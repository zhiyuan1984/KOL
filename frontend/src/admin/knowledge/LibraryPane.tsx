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
};

/** 右栏浏览区：平面分页列表；点击条目在工作区原位进入详情。 */
export default function LibraryPane({
  rows, totalCount, page, pageCount, selectedId, onSelect, onPrevious, onNext, loading,
}: Props) {
  return (
    <section className="kbv-browser-list" aria-label="知识浏览" data-kbv-list>
      <header className="kbv-browser-list-head">
        <span data-kbv-count>{totalCount} 条知识</span>
        <nav className="kbv-pagination" aria-label="知识分页">
          <button type="button" className="kbv-text-action" data-kbv-prev disabled={page <= 1} onClick={onPrevious}>上一页</button>
          <span data-kbv-page>第 {page} / {pageCount} 页</span>
          <button type="button" className="kbv-text-action" data-kbv-next disabled={page >= pageCount} onClick={onNext}>下一页</button>
        </nav>
      </header>

      {loading ? (
        <p className="kbv-empty" role="status">正在加载知识列表…</p>
      ) : rows.length === 0 ? (
        <div className="kbv-empty" data-kbv-empty>
          <h3>没有匹配的知识</h3>
          <p>请调整左侧筛选条件后重试。</p>
        </div>
      ) : (
        <div className="kbv-browser-records" data-kbv-records>
          {rows.map((row) => (
            <RecordRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecordRow({ row, selected, onSelect }: {
  row: KbAssetRow;
  selected: boolean;
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
  // 单行行式下元信息会被裁切，完整值由 title 兜底（DESIGN §9.1 长文本规则）。
  const metaTitle = [kindText, statusText, expiryText, dateText].filter(Boolean).join(" · ");

  return (
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
        {expiry ? <span className={`kbv-expiry is-${expiry}`} data-kbv-expiry={expiry}>{expiryText}</span> : null}
        {dateText ? <span className="kbv-record-date">{dateText}</span> : null}
      </span>
    </button>
  );
}
