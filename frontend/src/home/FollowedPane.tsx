import FollowedKolWorkCard from "../components/FollowedKolWorkCard";
import { MAIN_STAGE_TABS } from "../kolStages";
import {
  followedBulkCtaLabel,
  pickFollowedListCtaEmphasis,
  type FollowedKolCardModel,
} from "../followedKolCard";
import type { StarryBinding } from "../api";
import FollowedBrief from "./FollowedBrief";
import { KOL_SELECT_MAX } from "./kolContract";

const FOLLOWED_STAGE_LABELS: Record<string, string> = {
  INITIAL_CONTACT: "初步接触",
  INTERESTED: "有意向",
  EVALUATING: "合作评估",
  QUOTE_PENDING: "报价",
  NEGOTIATING: "商务谈判",
  PLAN_PENDING: "方案",
  CONTRACTING: "合同签署",
  SAMPLE_PENDING: "寄样",
  SHIPPED: "已发货",
  TESTING: "测试中",
  CONTENT_PLANNING: "内容策划",
  CONTENT_REVIEW: "内容审核",
  PUBLISH_PENDING: "待发布",
  PUBLISHED: "已发布",
  SETTLING: "结算",
};

function followEmptyCopy(kind: string, scope: StarryBinding | null) {
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
    return {
      title: "该邮箱下暂无跟进红人",
      body: `当前绑定 ${scope?.mailbox_email || "已选邮箱"}${scope?.owner_name ? ` · ${scope.owner_name}` : ""}。`,
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
  stageFilter,
  selectedKolIds,
  hoveredKolId,
  focusedKolId,
  confirmStageBusyId,
  confirmStageFeedback,
  followScope,
  followEmptyKind,
  queryDown,
  onQuery,
  onStageFilter,
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
  onBind,
}: {
  visibleKols: FollowedKolCardModel[];
  allCards: FollowedKolCardModel[];
  kolQuery: string;
  stageFilter: string;
  selectedKolIds: string[];
  hoveredKolId: string | null;
  focusedKolId: string | null;
  confirmStageBusyId: string | null;
  confirmStageFeedback: { id: string; text: string; tone: "info" | "error" } | null;
  followScope: StarryBinding | null;
  followEmptyKind: string;
  queryDown?: boolean;
  onQuery: (value: string) => void;
  onStageFilter: (value: string) => void;
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
  onBind: () => void;
}) {
  const selecting = selectedKolIds.length > 0;
  const selectedCards = visibleKols.filter((card) => selectedKolIds.includes(card.id));
  const bulkLabel = followedBulkCtaLabel(selectedCards);
  const empty = followEmptyCopy(queryDown ? "down" : followEmptyKind, followScope);
  const stageOptions = [
    { code: "", label: "全部阶段" },
    ...MAIN_STAGE_TABS.map((stage) => ({
      code: stage.code,
      label: FOLLOWED_STAGE_LABELS[stage.code] || stage.label,
    })),
    { code: "exception", label: "异常" },
  ];

  return (
    <section className="home-mode-pane recommend-work followed-kol-pane" data-home-pane="lifecycle" data-lifecycle-overview>
      <div className="followed-kol-column" data-followed-kol-column data-followed-decision-max="full">
        <FollowedBrief cards={visibleKols} onPrimary={onOpenDetail} />
        <div className="followed-object-toolbar" data-followed-object-toolbar data-home-entry="list-followed">
          <label className="followed-object-search">
            <span className="sr-only">搜索跟进对象</span>
            <input
              type="search"
              data-followed-object-search
              value={kolQuery}
              placeholder="搜索跟进对象"
              onChange={(event) => onQuery(event.target.value)}
            />
          </label>
          <p className="followed-object-count" data-followed-selected-count>
            {selecting ? `已选 ${selectedKolIds.length} / ${KOL_SELECT_MAX}` : `${visibleKols.length} 人`}
          </p>
          <label className="followed-advanced-filter" data-followed-advanced>
            <span>阶段（高级）</span>
            <select
              data-kol-stage-filter
              aria-label="按阶段筛选（高级）"
              value={stageFilter}
              onChange={(event) => onStageFilter(event.target.value)}
            >
              {stageOptions.map((option) => (
                <option key={option.code || "all"} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="followed-select-all">
            <input
              type="checkbox"
              data-followed-select-all
              checked={visibleKols.length > 0 && selectedKolIds.length === visibleKols.length}
              disabled={!visibleKols.length}
              onChange={(event) => onToggleSelectAll(event.target.checked)}
            />
            <span className="sr-only">全选跟进对象</span>
          </label>
          <button
            type="button"
            className="btn ghost sm"
            data-analyze-selected
            data-home-entry="kol-analyze-enqueue"
            disabled={!selecting}
            onClick={onAnalyzeSelected}
          >
            分析已选
          </button>
          <button
            type="button"
            className={selecting && bulkLabel ? "btn work sm" : "btn ghost sm"}
            data-followed-batch-confirm
            disabled={!selecting}
            onClick={onBatchConfirm}
          >
            {bulkLabel}
          </button>
        </div>

        {visibleKols.length ? (
          <div className="followed-kol-list" data-followed-kol-list data-followed-origin="collaboration">
            {visibleKols.map((card) => (
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
        ) : (
          <div
            className="task-empty"
            data-follow-empty={queryDown ? "down" : followEmptyKind}
            data-empty-kind={allCards.length && (kolQuery || stageFilter) ? "filter-empty" : queryDown ? "service-down" : "no-data"}
          >
            <strong>{empty.title}</strong>
            <p>{empty.body}</p>
            {followScope?.required && (!followScope.bound || followScope.status === "expired") ? (
              <button type="button" className="btn work" onClick={onBind}>
                {followScope.status === "expired" ? "重新连接" : "去绑定"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
