import type { ReactNode } from "react";
import type { FollowedKolCardModel } from "../followedKolCard";
import { FOLLOWED_LIFECYCLE_GROUPS } from "../followedKolCard";
import {
  briefingForFollowed,
  FOLLOWED_SITUATIONS,
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
  interaction,
}: {
  cards: FollowedKolCardModel[];
  completeness: FollowListCompleteness;
  stageFilter: string;
  situation: FollowedSituation | "";
  selectedCount: number;
  onStageFilter: (value: string) => void;
  onSituation: (value: FollowedSituation | "") => void;
  interaction?: ReactNode;
}) {
  const summaryReady = completeness === "complete";
  const brief = briefingForFollowed(cards);
  const counts = brief.counts;
  const selectedGroup = stageFilter.startsWith("group:") ? stageFilter.slice(6) : "";
  const nearCount = cards.filter((card) => matchesFollowedSituation(card, "near_14d")).length;
  const interestedCount = cards.filter((card) => matchesFollowedSituation(card, "interested")).length;
  const refusedCount = cards.filter((card) => matchesFollowedSituation(card, "refused")).length;

  const intro = (
    <section className="followed-interaction-intro" aria-label="当前跟进概览">
      <div>
        <p>{summaryReady ? `${cards.length} 位当前跟进对象 · 数量来自当前已授权名单` : "正在核对当前已授权名单…"}</p>
      </div>
      {selectedCount ? <span className="followed-selection-note">已选择 {selectedCount} 位，可在下方继续提问</span> : null}
    </section>
  );

  if (!summaryReady) {
    const copy = completeness === "incomplete-error"
      ? "当前可见对象保留在右栏，但邮箱范围的历史协作记录暂无法完成核对；总数与阶段统计暂不展示。"
      : "正在合并本地跟进索引与当前邮箱名下的历史协作记录；完成前不会显示 0 位或空阶段统计。";
    return (
      <div className="followed-interaction" data-followed-interaction data-followed-summary-state={completeness}>
        {intro}
        <section className="followed-summary-pending" data-followed-summary-pending role="status" aria-live="polite">
          <strong>{completeness === "incomplete-error" ? "名单核对未完成" : "正在核对跟进名单…"}</strong>
          <p>{copy}</p>
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
                <em>{cards.length ? `${Math.round((count / cards.length) * 100)}%` : "0%"}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="followed-attention" aria-labelledby="followed-attention-title">
        <div className="followed-section-heading">
          <h2 id="followed-attention-title">需要关注</h2>
          {situation ? <button type="button" className="followed-inline-clear" data-followed-situation-clear onClick={() => onSituation("")}>清除</button> : null}
        </div>
        <div className="followed-attention-list">
          {FOLLOWED_SITUATIONS.map(({ key, label }) => {
            const count = counts[key];
            const active = situation === key;
            return (
              <button
                key={key}
                type="button"
                className={active ? "is-active" : ""}
                data-followed-situation={key}
                aria-pressed={active}
                onClick={() => onSituation(active ? "" : key)}
              >
                <span aria-hidden>{key === "refused" ? "!" : key === "near_14d" ? "◷" : "↑"}</span>
                <strong>{count} 位{label}</strong>
                <em>在右栏查看</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="followed-next-step" aria-labelledby="followed-next-title">
        <h2 id="followed-next-title">建议先做</h2>
        <ol>
          <li><button type="button" onClick={() => onSituation("interested")}>查看已表达兴趣的 {interestedCount} 位对象</button></li>
          <li><button type="button" onClick={() => onSituation("near_14d")}>查看临近失联的 {nearCount} 位对象</button></li>
          {refusedCount ? <li><button type="button" onClick={() => onSituation("refused")}>核对已拒绝的 {refusedCount} 位对象</button></li> : null}
        </ol>
      </section>

      {interaction}
    </div>
  );
}
