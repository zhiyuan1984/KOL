import { kbDateOnly, kindLabel, statusLabel } from "../../knowledgeCopy";
import type { KbAssetRow } from "./shared";

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

/** 右栏浏览区：固定五条结果、一次总数和分页；详情由同栏下方承接。 */
export default function LibraryPane({
  rows, totalCount, page, pageCount, selectedId, onSelect, onPrevious, onNext, loading,
}: Props) {
  return (
    <section className="kbv-browser-list" aria-label="知识浏览" data-kbv-list>
      <header className="kbv-browser-list-head">
        <span data-kbv-count>{totalCount} 条知识</span>
        <nav className="kbv-pagination" aria-label="知识分页">
          <button type="button" className="btn ghost" data-kbv-prev disabled={page <= 1} onClick={onPrevious}>上一页</button>
          <span data-kbv-page>第 {page} / {pageCount} 页</span>
          <button type="button" className="btn ghost" data-kbv-next disabled={page >= pageCount} onClick={onNext}>下一页</button>
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

  return (
    <button
      type="button"
      className="kbv-browser-record"
      data-kbv-record={row.id}
      aria-current={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="kbv-record-title">{row.title}</span>
      <span className="kbv-browser-record-meta">
        <span>{kindLabel(row.kind)}</span>
        <span className={`kbv-status ${statusClass}`}>{statusLabel(status)}</span>
        {row.updated_at ? <span className="kbv-record-date">{kbDateOnly(row.updated_at)}</span> : null}
      </span>
    </button>
  );
}
