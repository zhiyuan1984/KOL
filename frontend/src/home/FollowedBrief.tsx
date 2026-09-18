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

export function briefingForFollowed(cards: FollowedKolCardModel[]) {
  const ranked = sortByFollowedBriefPriority(
    cards.map((card) => ({ card, brief_priority: followedBriefPriority(card) })),
  );
  const refused = ranked.filter((row) => row.brief_priority === "refused").map((row) => row.card);
  const near = ranked.filter((row) => row.brief_priority === "near_14d").map((row) => row.card);
  const interested = ranked.filter((row) => row.brief_priority === "interested").map((row) => row.card);
  const stats = `${cards.length}人在跟 · ${refused.length}拒信 · ${near.length}临近14日 · ${interested.length}有兴趣`;
  if (refused.length) {
    return {
      lead: "先停：有人已拒信，不要再发。",
      stats,
      primary: refused[0],
      cta: "查看拒信",
      priority: "refused" as const,
    };
  }
  if (near.length) {
    return {
      lead: "有人临近 14 日计时，先看有效往来。",
      stats,
      primary: near[0],
      cta: "查看计时",
      priority: "near_14d" as const,
    };
  }
  if (interested.length) {
    return {
      lead: "有人已表示有兴趣，按对象往下跟。",
      stats,
      primary: interested[0],
      cta: "打开这位",
      priority: "interested" as const,
    };
  }
  return {
    lead: cards.length ? "按跟进名单往下看。" : "还没有跟进中的红人。",
    stats,
    primary: cards[0] || null,
    cta: "打开这位",
    priority: "other" as const,
  };
}

export default function FollowedBrief({
  cards,
  busy,
  onPrimary,
}: {
  cards: FollowedKolCardModel[];
  busy?: boolean;
  onPrimary: (card: FollowedKolCardModel) => void;
}) {
  if (!cards.length) return null;
  const brief = briefingForFollowed(cards);
  const primary = brief.primary;
  return (
    <section className="followed-brief" data-followed-brief data-brief-priority={brief.priority} aria-label="跟进简报">
      <p className="followed-brief-lead">{brief.lead}</p>
      <p className="followed-brief-stats">{brief.stats}</p>
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
