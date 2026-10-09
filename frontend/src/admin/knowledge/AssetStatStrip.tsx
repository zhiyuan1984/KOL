import { useMemo } from "react";
import { kbStatusSegments } from "../../knowledgeCopy";
import type { KbView } from "./LibraryPane";
import type { WsStats } from "./shared";

type Props = {
  /** 服务端驾驶舱聚合（stats）；未加载时为 undefined，显示加载态。 */
  stats?: WsStats;
  loading?: boolean;
  error?: string;
  reload?: () => void;
  /** 当前状态筛选（与 KnowledgeHome 的 view 同源）。 */
  view: KbView;
  /** 点段即按该状态筛选列表（与筛选区 view tabs 同一口径），再点一次取消。 */
  onView: (view: KbView) => void;
};

const DOT: Record<string, string> = {
  draft: "var(--text-muted)",
  pending: "var(--warning)",
  published: "var(--success)",
  archived: "var(--text-muted)",
};

/**
 * 知识资产状态条（中栏顶部，列表之上）：
 * - 段宽按计数成比例（DESIGN §9.2 分布条语义保留），每段做成紧凑 BI 数字块：状态点＋标签、大数字、占比/最长等待。
 * - 点击即按该状态筛选（与筛选区 view tabs 同一 view 轴），再点一次取消。
 * - 等待天数只展示后端真实提供的口径（待审批＝在途审批最长等待），没有的不编造。
 */
export default function AssetStatStrip({ stats, loading, error, reload, view, onView }: Props) {
  const segments = useMemo(() => {
    const s = stats?.status || {};
    return kbStatusSegments({
      draft: s.draft || 0,
      pending: s.pending_review || 0,
      published: s.published || 0,
      archived: s.archived || 0,
      total: (s.draft || 0) + (s.pending_review || 0) + (s.published || 0) + (s.archived || 0),
    });
  }, [stats]);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const pendingWait = stats?.pending_review?.max_wait_days ?? 0;

  return (
    <section className="kbv-asset-strip" data-kbv-asset-strip aria-label="按知识资产状态筛选">
      {error ? (
        <p role="alert">资产分布读取失败：{error} <button type="button" className="kbv-text-action" onClick={reload}>重试</button></p>
      ) : !stats ? (
        <p className="muted" role="status">正在加载资产分布…</p>
      ) : (
        segments.map((segment) => {
          const active = view === segment.view;
          return (
            <button
              key={segment.key}
              type="button"
              className={`kbv-asset-seg${active ? " is-active" : ""}`}
              data-kb-status={segment.key}
              aria-pressed={active}
              aria-busy={loading || undefined}
              title={active ? `取消「${segment.label}」筛选` : `按「${segment.label}」筛选`}
              style={{ flexGrow: Math.max(segment.value, 1) }}
              onClick={() => onView(active ? "all" : (segment.view as KbView))}
            >
              <span className="kbv-asset-seg-label">
                <i className="kbv-asset-dot" style={{ background: DOT[segment.key] }} />
                {segment.label}
              </span>
              <span className="kbv-asset-seg-num" data-ds-stat-value>{segment.value}</span>
              <span className="kbv-asset-seg-sub">
                {segment.key === "pending" && pendingWait > 0 ? (
                  <>最长等待 <b>{pendingWait} 天</b></>
                ) : total > 0 ? (
                  <>占比 {Math.round((segment.value / total) * 100)}%</>
                ) : (
                  "—"
                )}
              </span>
            </button>
          );
        })
      )}
    </section>
  );
}
