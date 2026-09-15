import {
  formatStageBadge,
  recommendedActionHeadline,
  type FollowedKolCardModel,
  type RecommendedKind,
} from "../followedKolCard";

function formatFactTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))} 小时前`;
  if (diff < 2 * 86_400_000) return "昨天";
  if (diff < 7 * 86_400_000) return `${Math.max(2, Math.round(diff / 86_400_000))} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function primaryKind(kind: RecommendedKind): string | undefined {
  if (kind === "insufficient") return undefined;
  return kind;
}

function workCtaClass(opts: {
  kind: RecommendedKind;
  emphasized: boolean;
  demoteDraft: boolean;
}): string {
  const draftQuiet = opts.kind === "compose" && opts.demoteDraft;
  const filled = opts.emphasized && !draftQuiet;
  return [
    "btn",
    filled ? "work" : "ghost",
    "sm",
    "kol-cta-btn",
    "kol-cta-work",
    draftQuiet ? "is-draft-quiet" : "",
  ].filter(Boolean).join(" ");
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
  selected = false,
  hovered = false,
  ctaEmphasis = "quiet",
  onHoverChange,
  onFocusChange,
  onSelect,
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
  selected?: boolean;
  hovered?: boolean;
  ctaEmphasis?: "quiet" | "strong";
  onHoverChange?: (hovered: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  onSelect?: () => void;
}) {
  const rec = card.recommended_action;
  const fact = card.latest_fact;
  const headline = recommendedActionHeadline(rec);
  const primary = primaryKind(rec.kind);
  const showConfirm = rec.kind === "confirm-stage" && rec.can_write_stage && Boolean(rec.target_stage_label);
  const showCompose = rec.kind === "compose" || rec.kind === "confirm-send";
  const demoteDraft = rec.kind === "compose" && showConfirm;
  const emphasized = ctaEmphasis === "strong";
  const showMail = Boolean(fact.thread_id);
  const days = card.current_state.days_in_stage;
  const stageLabel = formatStageBadge(card.current_state.stage_label);
  const chips = [
    card.identity.platform ? { id: "platform", label: card.identity.platform } : null,
    card.scope.brand ? { id: "brand", label: card.scope.brand } : null,
    card.scope.region ? { id: "region", label: card.scope.region } : null,
    card.scope.owner ? { id: "owner", label: card.scope.owner } : null,
    ...card.risk.chips,
    card.unread_count > 0 ? { id: "unread", label: `未读 ${card.unread_count}` } : null,
  ].filter(Boolean) as { id: string; label: string }[];
  const initial = card.identity.display.replace(/^@/, "").slice(0, 1) || "红";
  const hasEvidence = card.evidence.kind !== "none" && Boolean(card.evidence.label);
  const factMeta = [fact.source || (fact.thread_id ? "邮件" : ""), fact.at ? formatFactTime(fact.at) : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={
        "followed-kol-card"
        + (card.risk.exception ? " is-exception" : "")
        + (card.current_state.unbound ? " is-unbound" : "")
        + (hovered ? " is-hovered" : "")
      }
      data-followed-kol={card.handle}
      data-kol-work-card
      data-action-owner={card.owner}
      data-cta-emphasis={emphasized ? "strong" : "quiet"}
      data-selected={selected ? "true" : undefined}
      onMouseEnter={(event) => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && !event.currentTarget.contains(active)) {
          active.blur();
        }
        onHoverChange?.(true);
      }}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocusCapture={() => onFocusChange?.(true)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(next)) onFocusChange?.(false);
      }}
      onClick={onSelect}
    >
      <div className="kol-band kol-band-identity" data-kol-band="identity">
        <span className="kol-avatar" data-kol-avatar aria-hidden>{initial}</span>
        <div className="kol-identity-main">
          <div className="kol-identity-line">
            <strong className="kol-name" data-kol-identity data-kol-name>{card.identity.display}</strong>
            <span
              className="kol-stage-badge"
              data-current-state
              data-current-stage
              data-stage-code={card.current_state.stage_code || undefined}
            >
              <span className="kol-stage" data-stage-label>{stageLabel}</span>
            </span>
            {days != null && days > 0 ? (
              <span className="kol-stage-stay" data-days-in-stage={days} data-kol-chip="stay">
                停留 {days} 天
              </span>
            ) : null}
          </div>
          {chips.length ? (
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
          ) : null}
        </div>
      </div>

      <div className="kol-split" data-kol-split>
        <div className="kol-band kol-band-fact" data-kol-band="fact">
          <div className="kol-state-block" data-latest-fact data-fact-kind={fact.kind}>
            <p className="kol-split-kicker">最新互动</p>
            <p className="kol-mail-digest" data-mail-summary={fact.thread_id || undefined}>
              {fact.summary}
            </p>
            {factMeta ? (
              <p className="kol-mail-meta">
                {factMeta}
                {fact.at ? <span data-thread-time className="sr-only">{fact.at}</span> : null}
              </p>
            ) : null}
          </div>
        </div>

        <div className="kol-band kol-band-recommend" data-kol-band="action">
          <div className="kol-state-block" data-recommended-action={rec.kind}>
            <p className="kol-split-kicker">✦ AI 建议</p>
            <p className="kol-suggestion">{headline}</p>
            {rec.why ? <p className="kol-judgment" data-action-why>{rec.why}</p> : null}
          </div>
          {hasEvidence ? (
            <details className="kol-evidence-disclosure" data-action-evidence={card.evidence.kind}>
              <summary>查看判断依据</summary>
              <p className="kol-evidence">{card.evidence.label}</p>
            </details>
          ) : null}
          <div className="kol-band kol-band-actions" data-kol-band="cta">
            <div className="kol-cta-secondary">
              <button type="button" className="kol-cta-link" data-open-kol-detail onClick={onOpenDetail}>
                查看详情
              </button>
              {showMail ? (
                <button
                  type="button"
                  className="kol-cta-link"
                  data-open-original-mail
                  data-thread-id={fact.thread_id}
                  onClick={onOpenMail}
                >
                  原邮件
                </button>
              ) : null}
            </div>
            <div className="kol-cta-primary">
              {showCompose ? (
                <button
                  type="button"
                  className={workCtaClass({ kind: rec.kind, emphasized, demoteDraft })}
                  data-kol-primary-action={primary}
                  data-cta-role={rec.kind === "compose" ? "draft" : "send"}
                  data-cta-visual={emphasized && !demoteDraft ? "filled" : "ghost"}
                  onClick={onCompose || onPrimary}
                >
                  {rec.label}
                </button>
              ) : null}
              {showConfirm ? (
                <button
                  type="button"
                  className={workCtaClass({ kind: "confirm-stage", emphasized, demoteDraft: false })}
                  data-kol-primary-action="confirm-stage"
                  data-cta-role="stage"
                  data-cta-visual={emphasized ? "filled" : "ghost"}
                  data-confirm-enter-stage
                  data-confirm-stage-priority="primary"
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
                  className={workCtaClass({ kind: rec.kind, emphasized, demoteDraft: false })}
                  data-kol-primary-action={primary}
                  data-cta-role="other"
                  data-cta-visual={emphasized ? "filled" : "ghost"}
                  disabled={actionBusy}
                  onClick={onPrimary}
                >
                  {actionBusy ? "正在打开…" : rec.label}
                </button>
              ) : null}
            </div>
          </div>
        </div>
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
