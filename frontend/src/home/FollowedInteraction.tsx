import type { ReactNode } from "react";
import type { FollowedKolCardModel } from "../followedKolCard";
import { FOLLOWED_LIFECYCLE_GROUPS } from "../followedKolCard";
import {
  briefingForFollowed,
  followedBriefPriority,
  matchesFollowedSituation,
  type FollowedSituation,
} from "./FollowedBrief";
import { sortByFollowedBriefPriority, type FollowBriefPriority } from "./kolContract";
import type { FollowListCompleteness } from "./useFollowedWorkspace";

/** 「先看谁」一句话原因：注意力触发器，不是画像描述。 */
const PRIORITY_REASONS: Record<Exclude<FollowBriefPriority, "other">, string> = {
  refused: "已拒信，先停，不要再发",
  near_14d: "临近 14 天未联系",
  interested: "已表达合作意向",
};

export default function FollowedInteraction({
  cards,
  completeness,
  stageFilter,
  situation,
  selectedCount,
  onStageFilter,
  onSituation,
  onPrimary,
  publicPoolNewCount,
  onOpenPublicPoolNew,
  interaction,
}: {
  cards: FollowedKolCardModel[];
  completeness: FollowListCompleteness;
  stageFilter: string;
  situation: FollowedSituation | "";
  selectedCount: number;
  onStageFilter: (value: string) => void;
  onSituation: (value: FollowedSituation | "") => void;
  onPrimary: (card: FollowedKolCardModel) => void;
  publicPoolNewCount: number | null;
  onOpenPublicPoolNew: () => void;
  interaction?: ReactNode;
}) {
  const summaryReady = completeness === "complete";
  const brief = briefingForFollowed(cards);
  const selectedGroup = stageFilter.startsWith("group:") ? stageFilter.slice(6) : "";
  const nearCount = cards.filter((card) => matchesFollowedSituation(card, "near_14d")).length;
  const interestedCount = cards.filter((card) => matchesFollowedSituation(card, "interested")).length;
  const refusedCount = cards.filter((card) => matchesFollowedSituation(card, "refused")).length;

  /** 注意力队列：按简报优先级排序，取前 3 位需要先处理的对象。 */
  const priorityQueue = sortByFollowedBriefPriority(
    cards.map((card) => ({ card, brief_priority: followedBriefPriority(card) })),
  )
    .filter((row) => row.brief_priority !== "other")
    .slice(0, 3);

  const intro = (
    <section className="followed-interaction-intro" aria-label="当前跟进概览">
      <p>{summaryReady
        ? "名单已由服务端按当前授权范围核对"
        : completeness === "incomplete-error"
          ? cards.length ? `${cards.length} 位已加载 · 名单核对未完成` : "名单核对未完成"
        : cards.length
          ? `${cards.length} 位已加载 · 正在核对服务端授权名单…`
          : "正在核对服务端授权名单…"}</p>
      {selectedCount ? <span className="followed-selection-note">已选择 {selectedCount} 位，可在下方继续提问</span> : null}
    </section>
  );

  if (!summaryReady) {
    const copy = completeness === "incomplete-error"
      ? "当前可见对象已保留；服务端授权名单暂无法完成核对，下面的阶段统计不会把不完整数据当成最终结论。"
      : "正在读取服务端核对的授权名单；完成前不会显示 0 位或空阶段统计。";
    return (
      <div className="followed-interaction" data-followed-interaction data-followed-summary-state={completeness}>
        {intro}
        <section className="followed-summary-pending" data-followed-summary-pending role="status" aria-live="polite">
          <strong>{completeness === "incomplete-error" ? "名单核对未完成" : "正在核对服务端授权名单…"}</strong>
          <p>{copy}</p>
          {completeness === "incomplete-error" && cards.length ? (
            <div className="followed-partial-summary" data-followed-partial-summary>
              <strong>{cards.length} 位对象已加载</strong>
              <span>阶段统计暂不可用</span>
            </div>
          ) : null}
        </section>
        {interaction}
      </div>
    );
  }

  return (
    <div className="followed-interaction" data-followed-interaction>
      {intro}

      <section className="followed-decision-brief" aria-labelledby="followed-overview-title">
        <div className="followed-section-heading">
          <h2 id="followed-overview-title">当前概览</h2>
          <span>结构化事实，不自动推进阶段</span>
        </div>
        <p className="followed-decision-lead">
          {nearCount
            ? `${nearCount} 位临近 14 天未联系，${interestedCount ? `其中 ${interestedCount} 位已表达合作意向。` : "建议先核对最近有效互动。"}`
            : interestedCount
              ? `${interestedCount} 位已表达合作意向，可以优先判断下一步。`
              : brief.lead}
        </p>
      </section>
      <p className="followed-overview-count" data-followed-overview-count>
        目前跟进了 {cards.length} 位
      </p>

      <section className="followed-lifecycle-overview" aria-labelledby="followed-lifecycle-title">
        <div className="followed-section-heading">
          <h2 id="followed-lifecycle-title">合作生命周期</h2>
          {selectedGroup ? (
            <button type="button" className="followed-inline-clear" data-followed-stage-clear onClick={() => onStageFilter("")}>查看全部</button>
          ) : <span>选择一段查看该阶段对象</span>}
        </div>
        {/* 分布条（DESIGN §9.2）：同一对象生命周期状态的分段表达，分段宽度按计数成比例。
            用的是 6 折叠分组，不是 15 正式阶段作主筛（IA §5）。 */}
        <div
          className="followed-distribution"
          data-followed-lifecycle-grid
          role="group"
          aria-label="按合作阶段分布筛选"
        >
          {FOLLOWED_LIFECYCLE_GROUPS.map((group) => {
            const count = cards.filter((card) =>
              (group.stageCodes as readonly string[]).includes(card.current_state.stage_code || ""),
            ).length;
            const active = selectedGroup === group.id;
            return (
              <button
                key={group.id}
                type="button"
                className={"followed-dist-seg" + (active ? " is-active" : "")}
                data-followed-stage-group={group.id}
                aria-pressed={active}
                style={{ flexGrow: Math.max(count, 0.5), flexBasis: 0 }}
                title={`${group.label} ${count} 位，点击筛选`}
                onClick={() => onStageFilter(active ? "" : `group:${group.id}`)}
              >
                <span className="followed-dist-label">{group.label}</span>
                <strong className="followed-dist-count">{count}</strong>
              </button>
            );
          })}
        </div>
      </section>

      {priorityQueue.length ? (
        <section className="followed-priority" aria-labelledby="followed-priority-title">
          <div className="followed-section-heading">
            <h2 id="followed-priority-title">先看谁</h2>
            <span>按需要你先处理的顺序</span>
          </div>
          <ul className="followed-priority-list">
            {priorityQueue.map(({ card, brief_priority }) => (
              <li key={card.id} className="followed-priority-row" data-followed-priority={brief_priority}>
                <div className="followed-priority-main">
                  <strong className="followed-priority-name">{card.identity.display}</strong>
                  <span className="followed-priority-reason">{PRIORITY_REASONS[brief_priority as Exclude<FollowBriefPriority, "other">]}</span>
                </div>
                <button
                  type="button"
                  className="followed-priority-cta"
                  data-followed-priority-view={card.id}
                  onClick={() => onPrimary(card)}
                >
                  查看
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="followed-next-step" aria-labelledby="followed-next-title">
        <div className="followed-section-heading">
          <h2 id="followed-next-title">建议先做</h2>
          {situation ? <button type="button" className="followed-inline-clear" data-followed-situation-clear onClick={() => onSituation("")}>清除</button> : null}
        </div>
        <ol>
          <li><button type="button" className={situation === "interested" ? "is-active" : ""} data-followed-situation="interested" aria-pressed={situation === "interested"} onClick={() => onSituation(situation === "interested" ? "" : "interested")}>查看已表达兴趣的 {interestedCount} 位对象</button></li>
          <li><button type="button" className={situation === "near_14d" ? "is-active" : ""} data-followed-situation="near_14d" aria-pressed={situation === "near_14d"} onClick={() => onSituation(situation === "near_14d" ? "" : "near_14d")}>查看临近失联的 {nearCount} 位对象</button></li>
          {refusedCount ? <li><button type="button" className={situation === "refused" ? "is-active" : ""} data-followed-situation="refused" aria-pressed={situation === "refused"} onClick={() => onSituation(situation === "refused" ? "" : "refused")}>核对已拒绝的 {refusedCount} 位对象</button></li> : null}
          <li><button type="button" data-followed-public-pool-new onClick={onOpenPublicPoolNew}>{publicPoolNewCount == null ? "查看公海新加入的 KOL" : `查看公海新加入的 ${publicPoolNewCount} 位 KOL`}</button></li>
        </ol>
      </section>

      {interaction}
    </div>
  );
}
