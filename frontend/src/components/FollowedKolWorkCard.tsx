import type { FollowedKolCardModel, RecommendedKind } from "../followedKolCard";

function formatFactTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function primaryKind(kind: RecommendedKind): string | undefined {
  if (kind === "insufficient") return undefined;
  return kind;
}

export default function FollowedKolWorkCard({
  card,
  onOpenDetail,
  onPrimary,
  onOpenMail,
  onCompose,
  onConfirmStage,
  actionBusy = false,
  actionNotice,
  actionTone = "info",
}: {
  card: FollowedKolCardModel;
  onOpenDetail: () => void;
  onPrimary: () => void;
  onOpenMail?: () => void;
  onCompose?: () => void;
  onConfirmStage?: () => void;
  actionBusy?: boolean;
  actionNotice?: string;
  actionTone?: "info" | "error";
}) {
  const rec = card.recommended_action;
  const fact = card.latest_fact;
  const primary = primaryKind(rec.kind);
  const showConfirm = rec.kind === "confirm-stage" && rec.can_write_stage && Boolean(rec.target_stage_label);
  const showCompose = rec.kind === "compose" || rec.kind === "confirm-send";
  const showMail = Boolean(fact.thread_id);
  const days = card.current_state.days_in_stage;
  const chips = [
    card.identity.platform ? { id: "platform", label: card.identity.platform } : null,
    card.scope.brand ? { id: "brand", label: card.scope.brand } : null,
    card.scope.region ? { id: "region", label: card.scope.region } : null,
    card.scope.owner ? { id: "owner", label: card.scope.owner } : null,
    card.scope.mailbox ? { id: "mailbox", label: card.scope.mailbox } : null,
    ...card.risk.chips,
    card.unread_count > 0 ? { id: "unread", label: `未读 ${card.unread_count}` } : null,
  ].filter(Boolean) as { id: string; label: string }[];
  const factLine = [fact.source, fact.summary].filter(Boolean).join(" · ");
  const initial = card.identity.display.replace(/^@/, "").slice(0, 1) || "红";

  return (
    <article
      className={
        "followed-kol-card"
        + (card.risk.exception ? " is-exception" : "")
        + (card.current_state.unbound ? " is-unbound" : "")
      }
      data-followed-kol={card.handle}
      data-kol-work-card
      data-action-owner={card.owner}
    >
      <div className="kol-band kol-band-identity" data-kol-band="identity">
        <span className="kol-avatar" data-kol-avatar aria-hidden>{initial}</span>
        <div className="kol-identity-main">
          <div className="kol-identity-line">
            <strong data-kol-identity data-kol-name>{card.identity.display}</strong>
            <span className="kol-chip-row" data-kol-scope>
              {chips.map((chip) => (
                <span
                  key={chip.id + chip.label}
                  className={
                    "kol-chip"
                    + (chip.id === "unread" ? " is-unread" : "")
                    + (chip.id === "exception" || chip.id === "high-risk" ? " is-risk" : "")
                  }
                  data-kol-chip={chip.id}
                  data-unread-count={chip.id === "unread" ? card.unread_count : undefined}
                >
                  {chip.label}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      <div className="kol-band kol-band-state" data-kol-band="state">
        <div className="kol-state-block" data-current-state data-current-stage>
          <div className="kol-state-fields">
            <p data-stage-code={card.current_state.stage_code || undefined} data-stage-label>
              {card.current_state.stage_label}
            </p>
            {days != null && days > 0 ? (
              <span className="kol-chip" data-days-in-stage={days} data-kol-chip="stay">
                停留 {days} 天
              </span>
            ) : null}
          </div>
        </div>
        <div className="kol-state-block" data-recommended-action={rec.kind}>
          <p>{rec.label}</p>
        </div>
      </div>

      <div className="kol-band kol-band-recommend" data-kol-band="action">
        <div className="kol-state-block" data-latest-fact data-fact-kind={fact.kind}>
          <p data-mail-summary={fact.thread_id || undefined} title={factLine}>
            {factLine}
            {fact.at ? <span data-thread-time> · {formatFactTime(fact.at)}</span> : null}
          </p>
        </div>
        <div className="kol-state-block" data-action-evidence={card.evidence.kind}>
          <p title={rec.why}>{rec.why}</p>
        </div>
      </div>

      <div className="kol-band kol-band-actions" data-kol-band="cta">
        <button type="button" className="btn ghost sm" data-open-kol-detail onClick={onOpenDetail}>
          查看详情
        </button>
        {showMail ? (
          <button
            type="button"
            className="btn ghost sm"
            data-open-original-mail
            data-thread-id={fact.thread_id}
            onClick={onOpenMail}
          >
            查看原邮件
          </button>
        ) : null}
        {showCompose ? (
          <button
            type="button"
            className="btn work sm"
            data-kol-primary-action={primary}
            onClick={onCompose || onPrimary}
          >
            {rec.label}
          </button>
        ) : null}
        {showConfirm ? (
          <button
            type="button"
            className="btn work sm"
            data-kol-primary-action="confirm-stage"
            data-confirm-enter-stage
            data-target-stage={rec.target_stage_code}
            data-confirm-stage-busy={actionBusy ? "true" : undefined}
            disabled={actionBusy}
            onClick={onConfirmStage || onPrimary}
          >
            {actionBusy ? "正在打开…" : rec.label}
          </button>
        ) : null}
        {primary && !showCompose && !showConfirm ? (
          <button
            type="button"
            className="btn work sm"
            data-kol-primary-action={primary}
            disabled={actionBusy}
            onClick={onPrimary}
          >
            {actionBusy ? "正在打开…" : rec.label}
          </button>
        ) : null}
      </div>
      {actionNotice ? (
        <p
          className={actionTone === "error" ? "error" : "muted"}
          data-confirm-stage-feedback
          data-tone={actionTone}
          role={actionTone === "error" ? "alert" : "status"}
        >
          {actionNotice}
        </p>
      ) : null}
    </article>
  );
}
