import { useEffect, useRef, useState } from "react";
import "./followed.css";
import FollowedKolWorkCard from "../components/FollowedKolWorkCard";
import {
  followedBulkCtaLabel,
  pickFollowedListCtaEmphasis,
  type FollowedKolCardModel,
} from "../followedKolCard";
import type { StarryBinding } from "../api";
import { selectAllChecked, selectAllLabel } from "./kolContract";
import type { KolSortMode } from "../followedKolCard";
import { HOME_HANDOFF_TO_AGENT } from "./entryRegistry";
import type { SurfaceDownView } from "./surfaceError";

/** 无限加载每批条数（DESIGN §9.4 模式 A：data-dense-dashboard 查找+浏览混合场景）。 */
const FOLLOWED_PAGE_SIZE = 20;

const SORT_OPTIONS: { key: KolSortMode; label: string }[] = [
  { key: "followers", label: "粉丝数" },
  { key: "time", label: "时间" },
  { key: "score", label: "潜力" },
];

/** 与公海同一支搜索图标：框内左侧内联，命中区仍是整个输入框。 */
function SearchIcon() {
  return (
    <svg className="followed-inline-icon" aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.25 10.25 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg className="followed-sort-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M5 2v10M5 12l-2-2m2 2 2-2M11 14V4m0 0 2 2m-2-2L9 6" />
    </svg>
  );
}

/** 读取久等之后才给恢复入口：等待本身有原因，不靠猜、不伪造进度。 */
function useSlowWait(active: boolean, ms = 3000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return slow;
}

function followEmptyCopy(kind: string, scope: StarryBinding | null) {
  if (kind === "loading") {
    return { title: "正在读取跟进名单…", body: "读完这里会显示你在跟的红人与合作对象；读取完成前不下结论。" };
  }
  if (kind === "reconciling") {
    return {
      title: "正在核对跟进名单…",
      body: "已读取本地跟进索引，正在核对当前邮箱名下的历史协作记录；完成前不会显示“暂无”。",
    };
  }
  if (kind === "incomplete") {
    return {
      title: "跟进名单暂时无法确认",
      body: "未能完成当前邮箱范围的名单核对，因此暂不显示“暂无”。可重试或交给 Agent 排查。",
    };
  }
  if (kind === "unbound") {
    return { title: "尚未绑定跟进邮箱", body: "绑定 Starry 发件箱后，这里只显示该邮箱负责人跟进的红人。" };
  }
  if (kind === "expired") {
    return { title: "Starry 连接已过期", body: "重新连接后即可继续查看你跟进的红人。" };
  }
  if (kind === "filtered") {
    return { title: "没有匹配的跟进对象", body: "换个关键词或阶段，再看跟进中的红人和合作对象。" };
  }
  if (kind === "mailbox") {
    const mailbox = scope?.mailbox_email || "当前邮箱";
    const scopeLabel = scope?.owner_name ? `${scope.owner_name}（${mailbox}）` : mailbox;
    return {
      title: "还没有领取跟进的红人",
      body: `这里显示 ${scopeLabel} 名下的跟进名单。可先从公海领取已有红人，或通过 AI 发现寻找新红人。`,
    };
  }
  if (kind === "down") {
    return { title: "跟进列表暂时不可用", body: "记忆查询失败，没有写入会话。可重试或交给 Agent 分析。" };
  }
  return { title: "还没有跟进中的红人", body: "跟进中的红人和合作对象会出现在这里。可从 AI发现 加入。" };
}

export default function FollowedPane({
  visibleKols,
  allCards,
  kolQuery,
  sort,
  selectedKolIds,
  hoveredKolId,
  focusedKolId,
  confirmStageBusyId,
  confirmStageFeedback,
  followScope,
  followEmptyKind,
  down,
  listError,
  onQuery,
  onSort,
  onHover,
  onFocus,
  onToggleSelect,
  onToggleSelectAll,
  onOpenDetail,
  onPrimary,
  onOpenMail,
  onCompose,
  onConfirmStage,
  onBatchConfirm,
  onAnalyzeSelected,
  onRelease,
  onReload,
  onBind,
  onOpenPool,
  onOpenDiscovery,
}: {
  visibleKols: FollowedKolCardModel[];
  allCards: FollowedKolCardModel[];
  kolQuery: string;
  sort: KolSortMode;
  selectedKolIds: string[];
  hoveredKolId: string | null;
  focusedKolId: string | null;
  confirmStageBusyId: string | null;
  confirmStageFeedback: { id: string; text: string; tone: "info" | "error" } | null;
  followScope: StarryBinding | null;
  followEmptyKind: string;
  down?: SurfaceDownView | null;
  /** 名单还在屏上、但最近一次读取失败：安静提示，不吞掉已经读到的对象。 */
  listError?: string;
  onQuery: (value: string) => void;
  onSort: (value: KolSortMode) => void;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onToggleSelect: (id: string, on: boolean) => void;
  onToggleSelectAll: (on: boolean) => void;
  onOpenDetail: (card: FollowedKolCardModel) => void;
  onPrimary: (card: FollowedKolCardModel) => void;
  onOpenMail: (card: FollowedKolCardModel) => void;
  onCompose: (card: FollowedKolCardModel) => void;
  onConfirmStage: (card: FollowedKolCardModel) => void;
  onBatchConfirm: () => void;
  onAnalyzeSelected: () => void;
  onRelease?: (card: FollowedKolCardModel) => void;
  /** 久等之后的恢复入口：只重发跟进名单读取，不强制重拉 board。 */
  onReload?: () => void;
  onBind: () => void;
  onOpenPool: () => void;
  onOpenDiscovery: () => void;
}) {
  const selecting = selectedKolIds.length > 0;
  const selectedCards = visibleKols.filter((card) => selectedKolIds.includes(card.id));
  const bulkLabel = followedBulkCtaLabel(selectedCards);
  const queryDown = Boolean(down);
  const loading = !queryDown && (followEmptyKind === "loading" || followEmptyKind === "reconciling");
  const slowLoading = useSlowWait(loading);
  const empty = followEmptyCopy(queryDown ? "down" : followEmptyKind, followScope);

  /**
   * 无限加载（模式 A，DESIGN §9.4）：筛选/排序变化时重置为首批，触底追加。
   * 滚动容器在 WorkspaceShell 上层，observer 以 viewport 为 root，
   * bottom rootMargin = --infinite-load-threshold（48px）。
   * 前端切片为同步渲染，不伪造「加载中」等待（不变量 3）。
   */
  const [visibleCount, setVisibleCount] = useState(FOLLOWED_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setVisibleCount(FOLLOWED_PAGE_SIZE);
  }, [kolQuery, sort, visibleKols.length]);
  const hasMore = visibleCount < visibleKols.length;
  const renderedKols = hasMore ? visibleKols.slice(0, visibleCount) : visibleKols;
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + FOLLOWED_PAGE_SIZE, visibleKols.length));
        }
      },
      { root: null, rootMargin: "0px 0px 48px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleKols.length]);

  return (
    <section
      className="recommend-work followed-kol-pane is-result-rail"
      data-lifecycle-overview
    >
      <div className="followed-kol-column" data-followed-kol-column data-followed-decision-max="full">
        {/* 顶部工具行只保留搜索、排序和批量动作；总数放在中栏当前概览。
            筛选后右栏显示「共 N 位」（筛选结果数），未筛选时不渲染，避免与中栏总数重复（不变量 6）。 */}
        {allCards.length ? <div className="followed-object-toolbar" data-followed-object-toolbar data-home-entry="list-followed">
          <div className="followed-object-look" data-followed-object-look>
            <label className="followed-object-search">
              <SearchIcon />
              <span className="sr-only">搜索跟进对象</span>
              <input
                type="search"
                data-followed-object-search
                value={kolQuery}
                placeholder="搜索跟进对象"
                onChange={(event) => onQuery(event.target.value)}
              />
            </label>
            <div className="followed-object-sort" data-followed-sort role="group" aria-label="跟进对象排序">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="followed-sort-option"
                  data-followed-sort-option={option.key}
                  aria-pressed={sort === option.key}
                  onClick={() => onSort(option.key)}
                >
                  {option.label} <SortIcon />
                </button>
              ))}
            </div>
          </div>
          <div className="followed-object-batch" data-followed-object-batch>
            <label className="followed-select-all">
              <input
                type="checkbox"
                data-followed-select-all
                checked={selectAllChecked(visibleKols.length, selectedCards.length)}
                disabled={!visibleKols.length}
                onChange={(event) => onToggleSelectAll(event.target.checked)}
              />
              <span data-followed-selected-count={selecting ? "true" : undefined}>
                {selecting ? `已选 ${selectedKolIds.length}` : selectAllLabel(visibleKols.length, "全选")}
              </span>
            </label>
            {selecting ? <button
              type="button"
              className="btn ghost sm"
              data-analyze-selected
              data-home-entry="kol-analyze-enqueue"
              disabled={!selecting}
              title={selecting ? undefined : "先勾选要分析的对象"}
              onClick={onAnalyzeSelected}
            >
              分析已选
            </button> : null}
            {selecting ? <button
              type="button"
              className={selecting && bulkLabel ? "btn work sm" : "btn ghost sm"}
              data-followed-batch-confirm
              disabled={!selecting}
              title={selecting ? undefined : "先勾选要进入阶段的对象"}
              onClick={onBatchConfirm}
            >
              {bulkLabel}
            </button> : null}
          </div>
        </div> : null}
        {followEmptyKind === "reconciling" && allCards.length ? (
          <p className="muted" data-followed-reconciling role="status" aria-live="polite">正在核对历史协作数据…</p>
        ) : null}

        {/* 筛选结果计数：只在筛选/搜索缩小了名单时出现；未筛选时中栏总数已覆盖，不重复（不变量 6）。 */}
        {allCards.length > 0 && visibleKols.length > 0 && visibleKols.length < allCards.length ? (
          <p className="followed-rail-count" data-followed-rail-count>
            共 {visibleKols.length} 位
          </p>
        ) : null}
        {visibleKols.length ? (
          <>
            {listError ? (
              <div className="followed-refresh-error" data-follow-refresh-error role="status">
                <p className="muted">{listError}</p>
                {onReload ? (
                  <button type="button" className="btn ghost sm" data-follow-retry-loaded onClick={onReload}>
                    重试核对
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="followed-kol-list" data-followed-kol-list data-followed-origin="collaboration">
              {renderedKols.map((card) => (
                <FollowedKolWorkCard
                  key={card.id}
                  card={card}
                  selected={selectedKolIds.includes(card.id)}
                  hovered={hoveredKolId === card.id}
                  ctaEmphasis={pickFollowedListCtaEmphasis({
                    cardId: card.id,
                    hoveredId: hoveredKolId,
                    focusedId: focusedKolId,
                    selectedIds: selectedKolIds,
                  })}
                  actionBusy={confirmStageBusyId === card.id}
                  actionNotice={confirmStageFeedback?.id === card.id ? confirmStageFeedback.text : undefined}
                  actionTone={confirmStageFeedback?.id === card.id ? confirmStageFeedback.tone : "info"}
                  onHoverChange={(on) => onHover(on ? card.id : null)}
                  onFocusChange={(on) => onFocus(on ? card.id : null)}
                  onToggleSelect={(on) => onToggleSelect(card.id, on)}
                  onOpenDetail={() => onOpenDetail(card)}
                  onPrimary={() => onPrimary(card)}
                  onOpenMail={() => onOpenMail(card)}
                  onCompose={() => onCompose(card)}
                  onConfirmStage={() => onConfirmStage(card)}
                  onRelease={card.source.follow_id && onRelease ? () => onRelease(card) : undefined}
                />
              ))}
            </div>
            {hasMore ? (
              <div ref={sentinelRef} data-followed-infinite-sentinel aria-hidden="true" />
            ) : (
              <p className="followed-infinite-footer" data-followed-infinite-end role="status">
                已加载全部
              </p>
            )}
          </>
        ) : (
          <div
            className="task-empty"
            data-follow-empty={queryDown ? "down" : followEmptyKind}
            data-empty-kind={loading ? "loading" : allCards.length && !visibleKols.length ? "filter-empty" : queryDown ? "service-down" : "no-data"}
            role={loading ? "status" : undefined}
          >
            <strong>{empty.title}</strong>
            <p>{empty.body}</p>
            {slowLoading && onReload ? (
              <div className="task-empty-actions">
                <button
                  type="button"
                  className="btn ghost sm"
                  data-follow-reload
                  onClick={onReload}
                >
                  重试
                </button>
              </div>
            ) : null}
            {down ? (
              <>
                <p className="muted" data-follow-down-reason title={down.detail || undefined}>{down.message}</p>
                <div className="task-empty-actions">
                  <button
                    type="button"
                    className="btn ghost sm"
                    data-follow-retry
                    disabled={down.retrying}
                    onClick={down.onRetry}
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    className="btn work sm"
                    data-follow-handoff-agent
                    data-home-entry="composer-analyze"
                    onClick={down.onHandoff}
                  >
                    {HOME_HANDOFF_TO_AGENT}
                  </button>
                </div>
              </>
            ) : null}
            {followScope?.required && (!followScope.bound || followScope.status === "expired") ? (
              <button type="button" className="btn work" onClick={onBind}>
                {followScope.status === "expired" ? "重新连接" : "去绑定"}
              </button>
            ) : null}
            {!loading && !down && followEmptyKind === "mailbox" ? (
              <div className="task-empty-actions" data-follow-empty-actions>
                <button type="button" className="btn work sm" onClick={onOpenPool}>
                  去公海找红人
                </button>
                <button type="button" className="btn ghost sm" onClick={onOpenDiscovery}>
                  AI 发现新红人
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
