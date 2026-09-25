import FollowedKolWorkCard from "../components/FollowedKolWorkCard";
import { MAIN_STAGE_TABS } from "../kolStages";
import {
  followedBulkCtaLabel,
  pickFollowedListCtaEmphasis,
  type FollowedKolCardModel,
} from "../followedKolCard";
import type { StarryBinding } from "../api";
import FollowedBrief, { type FollowedSituation } from "./FollowedBrief";
import { KOL_SELECT_MAX } from "./kolContract";
import { HOME_HANDOFF_TO_AGENT } from "./entryRegistry";
import type { SurfaceDownView } from "./surfaceError";

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
  situation,
  selectedKolIds,
  hoveredKolId,
  focusedKolId,
  confirmStageBusyId,
  confirmStageFeedback,
  followScope,
  followEmptyKind,
  down,
  onQuery,
  onStageFilter,
  onSituation,
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
  situation: FollowedSituation | "";
  selectedKolIds: string[];
  hoveredKolId: string | null;
  focusedKolId: string | null;
  confirmStageBusyId: string | null;
  confirmStageFeedback: { id: string; text: string; tone: "info" | "error" } | null;
  followScope: StarryBinding | null;
  followEmptyKind: string;
  down?: SurfaceDownView | null;
  onQuery: (value: string) => void;
  onStageFilter: (value: string) => void;
  onSituation: (value: FollowedSituation | "") => void;
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
  const queryDown = Boolean(down);
  const empty = followEmptyCopy(queryDown ? "down" : followEmptyKind, followScope);
  const stageOptions = [
    { code: "", label: "全部阶段" },
    ...MAIN_STAGE_TABS.map((stage) => ({
      code: stage.code,
      label: FOLLOWED_STAGE_LABELS[stage.code] || stage.label,
    })),
    { code: "exception", label: "异常" },
  ];
  const journeyStages = ["建联评估", "合作确认", "寄样测试", "内容交付", "结算完成", "长期合作"];
  const quickStages = [
    { code: "INITIAL_CONTACT", label: "初步接触" },
    { code: "INTERESTED", label: "已回复 · 有兴趣" },
    { code: "EVALUATING", label: "合作评估" },
  ];

  return (
    <section
      className="recommend-work followed-kol-pane is-result-rail"
      data-lifecycle-overview
    >
      <div className="followed-kol-column" data-followed-kol-column data-followed-decision-max="full">
        <nav className="followed-journey" aria-label="合作生命周期阶段" data-followed-journey>
          {journeyStages.map((label, index) => (
            <span key={label} className={index === 0 ? "is-active" : ""} aria-current={index === 0 ? "step" : undefined}>
              {label}
            </span>
          ))}
        </nav>
        <div className="followed-stage-quick-filter" role="tablist" aria-label="跟进阶段筛选" data-followed-stage-quick-filter>
          {quickStages.map((stage) => (
            <button
              key={stage.code}
              type="button"
              role="tab"
              aria-selected={stageFilter === stage.code}
              className={stageFilter === stage.code ? "is-active" : ""}
              onClick={() => onStageFilter(stageFilter === stage.code ? "" : stage.code)}
            >
              {stage.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={!stageFilter}
            className={!stageFilter ? "is-active" : ""}
            onClick={() => onStageFilter("")}
          >
            全部
          </button>
        </div>
        <FollowedBrief
          cards={allCards}
          situation={situation}
          onSituation={onSituation}
          onPrimary={onOpenDetail}
        />
        <div className="followed-object-toolbar" data-followed-object-toolbar data-home-entry="list-followed">
          <div className="followed-object-look" data-followed-object-look>
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
            <label className="followed-advanced-filter" data-followed-advanced>
              <span className="sr-only">阶段筛选</span>
              <select
                className="followed-stage-select-compat"
                data-kol-stage-filter
                aria-label="按阶段筛选"
                value={stageFilter}
                onChange={(event) => onStageFilter(event.target.value)}
              >
                {stageOptions.map((option) => (
                  <option key={option.code || "all"} value={option.code}>{option.label}</option>
                ))}
              </select>
            </label>
            <p className="followed-object-count" data-followed-selected-count>
              {selecting ? `已选 ${selectedKolIds.length} / ${KOL_SELECT_MAX}` : `在跟 ${visibleKols.length} 位`}
            </p>
          </div>
          <div className="followed-object-batch" data-followed-object-batch>
            <label className="followed-select-all">
              <input
                type="checkbox"
                data-followed-select-all
                checked={visibleKols.length > 0 && selectedKolIds.length === visibleKols.length}
                disabled={!visibleKols.length}
                onChange={(event) => onToggleSelectAll(event.target.checked)}
              />
              <span>全选本页</span>
            </label>
            <button
              type="button"
              className="btn ghost sm"
              data-analyze-selected
              data-home-entry="kol-analyze-enqueue"
              disabled={!selecting}
              title={selecting ? undefined : "先勾选要分析的对象"}
              onClick={onAnalyzeSelected}
            >
              分析已选
            </button>
            <button
              type="button"
              className={selecting && bulkLabel ? "btn work sm" : "btn ghost sm"}
              data-followed-batch-confirm
              disabled={!selecting}
              title={selecting ? undefined : "先勾选要进入阶段的对象"}
              onClick={onBatchConfirm}
            >
              {bulkLabel}
            </button>
          </div>
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
          </div>
        )}
      </div>
    </section>
  );
}
