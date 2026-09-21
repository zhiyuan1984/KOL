import { Fragment } from "react";
import type { FollowedKolCardModel } from "../followedKolCard";
import { sortByFollowedBriefPriority, type FollowBriefPriority } from "./kolContract";

export function followedBriefPriority(card: FollowedKolCardModel): FollowBriefPriority {
  const stage = `${card.current_state.stage_code || ""} ${card.current_state.stage_label || ""} ${card.source.public_stage || ""}`;
  const refused = card.risk.chips.some((chip) => chip.id === "refused")
    || /拒绝|拒信|REJECTED/i.test(`${stage} ${card.latest_fact.summary || ""}`);
  if (refused) {
    return "refused";
  }
  const near = card.risk.chips.some((chip) => chip.id === "near-14d")
    || (card.source.days_since_interaction != null && Number(card.source.days_since_interaction) >= 11);
  if (near) return "near_14d";
  if (/INTERESTED|有兴趣|有意向/i.test(stage)) return "interested";
  return "other";
}

/**
 * 情境分区：跟进面的收窄只发生在「这一次回答」里 —— 简报里点一个计数，
 * 清单就只留这一类对象。它不是耐久 Tab，也不重开 15 阶段导航：
 * 依据是 followedBriefPriority 已经算出的优先级，不是正式阶段板。
 * （docs/ia-information-architecture.md §1：跟进面不得以 15 正式阶段作主筛。）
 */
export type FollowedSituation = "refused" | "near_14d" | "interested";

export const FOLLOWED_SITUATIONS: { key: FollowedSituation; label: string }[] = [
  { key: "refused", label: "已拒绝" },
  { key: "near_14d", label: "临近 14 天未联系" },
  { key: "interested", label: "有意向" },
];

export function matchesFollowedSituation(
  card: FollowedKolCardModel,
  situation: FollowedSituation | "",
): boolean {
  if (!situation) return true;
  return followedBriefPriority(card) === situation;
}

export function briefingForFollowed(cards: FollowedKolCardModel[]) {
  const ranked = sortByFollowedBriefPriority(
    cards.map((card) => ({ card, brief_priority: followedBriefPriority(card) })),
  );
  const refused = ranked.filter((row) => row.brief_priority === "refused").map((row) => row.card);
  const near = ranked.filter((row) => row.brief_priority === "near_14d").map((row) => row.card);
  const interested = ranked.filter((row) => row.brief_priority === "interested").map((row) => row.card);
  const counts = {
    total: cards.length,
    refused: refused.length,
    near_14d: near.length,
    interested: interested.length,
  };
  if (refused.length) {
    return {
      lead: "先停：有人已拒信，不要再发。",
      counts,
      primary: refused[0],
      cta: "查看拒信",
      priority: "refused" as const,
    };
  }
  if (near.length) {
    return {
      lead: "有人临近 14 日计时，先看有效往来。",
      counts,
      primary: near[0],
      cta: "查看计时",
      priority: "near_14d" as const,
    };
  }
  if (interested.length) {
    return {
      lead: "有人已表示有兴趣，按对象往下跟。",
      counts,
      primary: interested[0],
      cta: "查看详情",
      priority: "interested" as const,
    };
  }
  // 没有拒信 / 临近 / 有兴趣时要救的对象：简报只报数，不再把清单第一行
  // 复制成一张「现在先看这一位」的卡。那张卡的排序在 other 档没有依据，
  // 却会在同一屏里和下面的对象卡重复，并把纵向预算挤到只剩半张卡。
  return {
    lead: cards.length ? "按跟进名单往下看。" : "还没有跟进中的红人。",
    counts,
    primary: null,
    cta: "查看详情",
    priority: "other" as const,
  };
}

export default function FollowedBrief({
  cards,
  busy,
  situation = "",
  onSituation,
  onPrimary,
}: {
  cards: FollowedKolCardModel[];
  busy?: boolean;
  situation?: FollowedSituation | "";
  onSituation?: (value: FollowedSituation | "") => void;
  onPrimary: (card: FollowedKolCardModel) => void;
}) {
  if (!cards.length) return null;
  const brief = briefingForFollowed(cards);
  const primary = brief.primary;
  const counts = brief.counts;
  return (
    <section className="followed-brief" data-followed-brief data-brief-priority={brief.priority} aria-label="跟进简报">
      <p className="followed-brief-lead">{brief.lead}</p>
      <p className="followed-brief-stats">
        <span className="followed-brief-stat">{counts.total} 位在跟</span>
        {FOLLOWED_SITUATIONS.map(({ key, label }) => {
          const count = counts[key];
          const active = situation === key;
          return (
            <Fragment key={key}>
              <span className="followed-brief-sep" aria-hidden>·</span>
              {count > 0 && onSituation ? (
                <button
                  type="button"
                  className="followed-brief-stat-action"
                  data-followed-situation={key}
                  aria-pressed={active}
                  onClick={() => onSituation(active ? "" : key)}
                >
                  {count} 位{label}
                </button>
              ) : (
                <span className="followed-brief-stat" data-followed-situation={key} data-count={count}>
                  {count} 位{label}
                </span>
              )}
            </Fragment>
          );
        })}
        {situation ? (
          <button
            type="button"
            className="followed-brief-stat-action is-clear"
            data-followed-situation-clear
            onClick={() => onSituation?.("")}
          >
            显示全部
          </button>
        ) : null}
      </p>
      {primary ? (
        <div className="followed-brief-primary" data-followed-primary={primary.id}>
          <p className="followed-brief-kicker">现在先看这一位</p>
          <p className="followed-brief-title">{primary.identity.display}</p>
          <p className="followed-brief-meta">
            {[primary.current_state.stage_label, primary.latest_fact.summary].filter(Boolean).join(" · ")}
          </p>
          <button
            type="button"
            className="btn ghost sm"
            data-followed-primary-cta
            disabled={busy}
            onClick={() => onPrimary(primary)}
          >
            {brief.cta}
          </button>
        </div>
      ) : null}
    </section>
  );
}
