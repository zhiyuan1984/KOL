import { Link } from "react-router-dom";
import { kindLabel, statusLabel } from "../../knowledgeCopy";
import KbvIcon from "../../knowledgeIcons";
import type { KbAssetRow } from "./shared";

export type KbView = "all" | "pending" | "published" | "draft" | "disabled";

const VIEWS: Array<{ key: KbView; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待审批" },
  { key: "published", label: "已发布" },
  { key: "draft", label: "草稿" },
  { key: "disabled", label: "已停用" },
];

type Props = {
  rows: KbAssetRow[];
  totalCount: number;
  counts: Record<KbView, number>;
  view: KbView;
  onView: (view: KbView) => void;
  query: string;
  onQuery: (query: string) => void;
  categoryLabel: string;
  onOpenCategory: () => void;
  kindOptions: Array<{ value: string; label: string }>;
  kind: string;
  onKind: (kind: string) => void;
  sort: "updated" | "title";
  onSort: (sort: "updated" | "title") => void;
  onReset: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  pendingDocsCount: number;
  loading: boolean;
  pathOf: (row: KbAssetRow) => string;
  onUpload: () => void;
  onCreate: () => void;
};

/** 管理端中栏：检索区＋快捷视图＋两行列表（IA v2，P1）。 */
export default function LibraryPane(props: Props) {
  const {
    rows, totalCount, counts, view, onView, query, onQuery, categoryLabel, onOpenCategory,
    kindOptions, kind, onKind, sort, onSort, onReset, selectedId, onSelect, expanded,
    onToggleExpand, pendingDocsCount, loading, pathOf, onUpload, onCreate,
  } = props;

  return (
    <section className="kbv-list" aria-label="知识列表" data-kbv-list>
      <div className="kbv-tools">
        <div className="kbv-search">
          <KbvIcon name="search" />
          <input
            type="search"
            aria-label="搜索知识"
            placeholder="搜索标题、主题、负责人…"
            data-kbv-search
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        <div className="kbv-filters">
          <button type="button" className="btn" data-kbv-category-button onClick={onOpenCategory}>
            {categoryLabel} ▾
          </button>
          <select
            aria-label="知识类型"
            data-kbv-kind
            value={kind}
            onChange={(event) => onKind(event.target.value)}
          >
            <option value="">全部类型</option>
            {kindOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="button" className="kbv-link-plain" data-kbv-reset onClick={onReset}>重置</button>
        </div>
      </div>

      <div className="kbv-tabs" role="group" aria-label="快捷视图">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="kbv-tab"
            aria-pressed={view === item.key}
            data-kbv-view={item.key}
            onClick={() => onView(item.key)}
          >
            {item.label} <small>{counts[item.key]}</small>
          </button>
        ))}
      </div>

      {view === "pending" && pendingDocsCount > 0 ? (
        <div className="kbv-banner" data-kbv-pending-docs>
          <span>另有 {pendingDocsCount} 份待审资料（非结构化）</span>
          <Link className="kbv-link-plain" to="/admin/knowledge/ingest">前往旧版入库处理（迁移中）→</Link>
        </div>
      ) : null}

      <div className="kbv-count">
        <span data-kbv-count>{rows.length} 条知识</span>
        <select
          aria-label="排序"
          data-kbv-sort
          value={sort}
          onChange={(event) => onSort(event.target.value === "title" ? "title" : "updated")}
        >
          <option value="updated">最近更新</option>
          <option value="title">标题顺序</option>
        </select>
      </div>

      {loading ? (
        <p className="kbv-empty" role="status">正在加载知识列表…</p>
      ) : rows.length === 0 ? (
        totalCount === 0 ? (
          <div className="kbv-empty" data-kbv-empty>
            <h3>还没有知识条目</h3>
            <p>先上传资料，或新建一条知识草稿。</p>
            <div className="kbv-actions">
              <button type="button" className="btn" onClick={onUpload}>上传文件</button>
              <button type="button" className="btn" onClick={onCreate}>新建知识</button>
            </div>
          </div>
        ) : (
          <div className="kbv-empty" data-kbv-empty>
            <h3>没有匹配的知识</h3>
            <p>试试其他关键词，或重置筛选。</p>
            <div className="kbv-actions">
              <button type="button" className="btn" onClick={onReset}>重置筛选</button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className={"kbv-records" + (expanded ? " is-expanded" : "")} data-kbv-records>
            {rows.map((row) => (
              <RecordRow
                key={row.id}
                row={row}
                path={pathOf(row)}
                selected={row.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
          {rows.length > 6 ? (
            <button type="button" className="btn kbv-more" data-kbv-more onClick={onToggleExpand}>
              {expanded ? "收起结果" : "展开全部结果"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function RecordRow({ row, path, selected, onSelect }: {
  row: KbAssetRow;
  path: string;
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
  const symbol = status === "published" ? "✓ " : status === "pending_review" ? "◷ " : "";
  return (
    <button
      type="button"
      className="kbv-record"
      data-kbv-record={row.id}
      aria-current={selected}
      onClick={() => onSelect(row.id)}
    >
      <span className="kbv-record-icon"><KbvIcon name={row.kind === "mail_template" ? "mail" : "file"} /></span>
      <span className="kbv-record-copy">
        <span className="kbv-record-title">{row.title}</span>
        <span className="kbv-record-meta">
          <span>{path || "未分类"}</span>
          <span>· {kindLabel(row.kind)}</span>
        </span>
      </span>
      <span className="kbv-record-end">
        <span className={"kbv-status " + statusClass}>{symbol}{statusLabel(status)}</span>
        <span>{row.created_by || "—"}</span>
      </span>
    </button>
  );
}
