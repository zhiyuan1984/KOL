import type { FollowedKolCardModel } from "../followedKolCard";
import "./followed-brief.css";

export type FollowedLane = "stop" | "advance" | "wait" | "work";

export function followedLane(card: FollowedKolCardModel): FollowedLane {
  const stage = `${card.current_state.stage_code || ""} ${card.current_state.stage_label || ""}`;
  if (card.risk.exception || card.owner === "exception" || /拒绝|REJECTED/i.test(stage)) return "stop";
  if (card.recommended_action.kind === "confirm-stage" || card.waiting_confirm) return "advance";
  if (card.owner === "them") return "wait";
  return "work";
}

export function briefingForFollowed(cards: FollowedKolCardModel[]) {
  const stop = cards.filter((card) => followedLane(card) === "stop");
  const advance = cards.filter((card) => followedLane(card) === "advance");
  const wait = cards.filter((card) => followedLane(card) === "wait");
  const stats = `${cards.length}人在跟 · ${stop.length}异常/已拒绝 · ${advance.length}待确认阶段 · ${wait.length}等对方`;
  if (stop.length) {
    return {
      lead: "先处理已拒绝和异常，不要再发信。",
      stats,
      primary: stop[0],
      cta: "看这条异常",
    };
  }
  if (advance.length) {
    return {
      lead: "有人在等你确认阶段。",
      stats,
      primary: advance[0],
      cta: advance[0].recommended_action.label || "去确认阶段",
    };
  }
  if (wait.length) {
    return {
      lead: "这几位在等对方，先看有没有新邮件。",
      stats,
      primary: wait[0],
      cta: "查看互动",
    };
  }
  return {
    lead: cards.length ? "按名单往下跟。" : "还没有跟进中的红人。",
    stats,
    primary: cards[0] || null,
    cta: "打开这位",
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
    <section className="today-brief followed-brief" data-followed-brief aria-label="跟进简报">
      <p className="today-brief-lead">
        <span aria-hidden>📋</span> {brief.lead}
      </p>
      <p className="today-brief-stats">{brief.stats}</p>
      {primary ? (
        <div className="today-primary" data-followed-primary={primary.id}>
          <p className="today-primary-kicker">现在做这一件</p>
          <p className="today-primary-title">{primary.identity.display}</p>
          <p className="today-primary-meta">
            {[primary.current_state.stage_label, primary.latest_fact.summary].filter(Boolean).join(" · ")}
          </p>
          <button
            type="button"
            className="todo-card-act today-primary-cta"
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
