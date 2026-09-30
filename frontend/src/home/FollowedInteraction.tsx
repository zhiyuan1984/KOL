import type { ReactNode } from "react";
import type { FollowedKolCardModel } from "../followedKolCard";
import { FOLLOWED_LIFECYCLE_GROUPS } from "../followedKolCard";
import {
  briefingForFollowed,
  matchesFollowedSituation,
  type FollowedSituation,
} from "./FollowedBrief";
import type { FollowListCompleteness } from "./useFollowedWorkspace";

export default function FollowedInteraction({
  cards,
  completeness,
  stageFilter,
  situation,
  selectedCount,
  onStageFilter,
  onSituation,
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

  const intro = (
    <section className="followed-interaction-intro" aria-label="当前跟进概览">
      <div>
        <p>{summaryReady
          ? `${cards.length} 位当前跟进对象 · 数量来自当前已授权名单`
          : cards.length
            ? `${cards.length} 位已加载 · 正在核对最新数据…`
            : "正在核对当前已授权名单…"}</p>
      </div>
      {selectedCount ? <span className="followed-selection-note">已选择 {selectedCount} 位，可在下方继续提问</span> : null}
    </section>
  );

  if (!summaryReady) {
    const copy = completeness === "incomplete-error"
      ? "当前可见对象已保留；邮箱范围的历史协作记录暂无法完成核对，下面的阶段统计不会把不完整数据当成最终结论。"
      : "正在合并本地跟进索引与当前邮箱名下的历史协作记录；完成前不会显示 0 位或空阶段统计。";
    return (
      <div className="followed-interaction" data-followed-interaction data-followed-summary-state={completeness}>
        {intro}
        <section className="followed-summary-pending" data-followed-summary-pending role="status" aria-live="polite">
          <strong>{completeness === "incomplete-error" ? "名单核对未完成" : "正在核对跟进名单…"}</strong>
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

      <section className="followed-lifecycle-overview" aria-labelledby="followed-lifecycle-title">
        <div className="followed-section-heading">
          <h2 id="followed-lifecycle-title">合作生命周期</h2>
          {selectedGroup ? (
            <button type="button" className="followed-inline-clear" data-followed-stage-clear onClick={() => onStageFilter("")}>查看全部</button>
          ) : <span>选择阶段查看对象</span>}
        </div>
        <div className="followed-lifecycle-grid" data-followed-lifecycle-grid>
          {FOLLOWED_LIFECYCLE_GROUPS.map((group) => {
            const count = cards.filter((card) =>
              (group.stageCodes as readonly string[]).includes(card.current_state.stage_code || ""),
            ).length;
            const active = selectedGroup === group.id;
            return (
              <button
                key={group.id}
                type="button"
                className={active ? "is-active" : ""}
                data-followed-stage-group={group.id}
                aria-pressed={active}
                onClick={() => onStageFilter(active ? "" : `group:${group.id}`)}
              >
                <span>{group.label}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>
      </section>

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
