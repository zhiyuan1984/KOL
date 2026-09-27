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

/** 箭头不再是文本字符：label 结尾的「→」拆出来交给统一 SVG 图标。 */
function ctaText(label: string): string {
  return String(label || "").replace(/\s*→\s*$/, "");
}

function ctaHasArrow(label: string): boolean {
  return /\s*→\s*$/.test(String(label || ""));
}

function IconAlert() {
  return (
    <svg className="kol-ico" aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path d="M8 2.9 14 13.1H2L8 2.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.8v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r=".8" fill="currentColor" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg className="kol-ico" aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7.3v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r=".85" fill="currentColor" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg className="kol-ico" aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.9 8h9.2M8.5 4.6 11.9 8l-3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg className="kol-ico kol-chevron" aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="m4.2 6.4 3.8 3.6 3.8-3.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 一行最多一个状态强调点：按风险等级取第一个做描边标记，其余降为弱文本。
 * 「临近14日」不再出现 —— 同一份数据（未互动天数）已由 14 日计时那一行承载。
 */
const RISK_MARKER_ORDER = ["exception", "high-risk", "refused", "overdue", "unbound"];

export default function FollowedKolWorkCard({
  card,
  onOpenDetail,
  onPrimary,
  onOpenMail,
  onCompose,
  onConfirmStage,
  onRelease,
  actionBusy = false,
  actionNotice,
  actionTone = "info",
  selected = false,
  hovered = false,
  ctaEmphasis = "quiet",
  onHoverChange,
  onFocusChange,
  onToggleSelect,
}: {
  card: FollowedKolCardModel;
  onOpenDetail: () => void;
  onPrimary: () => void;
  onOpenMail?: () => void;
  onCompose?: () => void;
  onConfirmStage?: () => void;
  onRelease?: () => void;
  actionBusy?: boolean;
  actionNotice?: string;
  actionTone?: "info" | "error";
  selected?: boolean;
  hovered?: boolean;
  ctaEmphasis?: "quiet" | "strong";
  onHoverChange?: (hovered: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  onToggleSelect?: (on: boolean) => void;
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
  const initial = card.identity.display.replace(/^@/, "").slice(0, 1) || "红";
  const hasEvidence = card.evidence.kind !== "none" && Boolean(card.evidence.label);
  const factMeta = [fact.source || (fact.thread_id ? "邮件" : ""), fact.at ? formatFactTime(fact.at) : ""]
    .filter(Boolean)
    .join(" · ");
  const refused = /拒绝|拒信/.test(`${stageLabel} ${card.identity.display}`);
  const marker = RISK_MARKER_ORDER
    .map((id) => card.risk.chips.find((chip) => chip.id === id))
    .find((chip) => chip && !(chip.id === "refused" && refused));
  const quietRisk = card.risk.chips.filter((chip) => chip.id !== marker?.id && chip.id !== "near-14d" && chip.id !== "refused");
  const meta = [
    card.identity.platform ? { id: "platform", label: card.identity.platform } : null,
    card.scope.brand ? { id: "brand", label: card.scope.brand } : null,
    card.scope.region ? { id: "region", label: card.scope.region } : null,
    card.scope.owner ? { id: "owner", label: card.scope.owner } : null,
    ...quietRisk,
    card.unread_count > 0 ? { id: "unread", label: `未读 ${card.unread_count}` } : null,
  ].filter(Boolean) as { id: string; label: string }[];

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
      onMouseMove={(event) => {
        // 只有指针真的在卡片上移动才算悬停。用 mousemove 而不是 mouseenter：
        // 滚动会让指针底下换一张卡并补发 mouseenter（Chromium 不补 mousemove），
        // 那种「悬停」会顺手 blur 掉键盘焦点、把实底 CTA 从正在操作的对象上挪走。
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
    >
      <div className="kol-band kol-band-identity" data-kol-band="identity">
        <label className="followed-kol-select" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            data-followed-select={card.id}
            checked={selected}
            onChange={(event) => onToggleSelect?.(event.target.checked)}
          />
          <span className="sr-only">选择 {card.identity.display}</span>
        </label>
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
            {marker ? (
              <span
                className="kol-chip is-risk"
                data-kol-chip={marker.id}
                data-unbound={marker.id === "unbound" ? "true" : undefined}
                title={marker.label}
              >
                <IconAlert />
                {marker.label}
              </span>
            ) : null}
            {days != null && days > 0 ? (
              <span className="kol-stage-stay" data-days-in-stage={days} data-kol-chip="stay">
                停留 {days} 天
              </span>
            ) : null}
          </div>
          {meta.length ? (
            <span className="kol-chip-row" data-kol-scope>
              {meta.map((chip) => (
                <span
                  key={chip.id + chip.label}
                  className={
                    "kol-chip"
                    + (chip.id === "unread" ? " is-unread" : "")
                    + (chip.id === "unread" && marker ? " is-quiet" : "")
                  }
                  data-kol-chip={chip.id}
                  data-unread-count={chip.id === "unread" ? card.unread_count : undefined}
                  title={chip.label}
                >
                  {chip.label}
                </span>
              ))}
            </span>
          ) : null}
          {card.source.countdown !== false && (card.source.release_due_at || card.source.last_interaction_at) ? (
            <p className="kol-mail-meta" data-release-timer data-release-scheduler="false">
              14 日计时（只读）
              {card.source.last_interaction_at ? ` · 上次互动 ${formatFactTime(card.source.last_interaction_at)}` : ""}
              {card.source.days_since_interaction != null ? ` · 已过 ${card.source.days_since_interaction} 天` : ""}
            </p>
          ) : (
            <p className="kol-mail-meta" data-release-timer data-release-scheduler="false" data-clock-none>
              尚未有效往来
            </p>
          )}
        </div>
      </div>

      <div className="kol-split" data-kol-split>
        <div className="kol-band kol-band-fact" data-kol-band="fact">
          <div className="kol-state-block" data-latest-fact data-fact-kind={fact.kind}>
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
          <div
            className="kol-state-block"
            data-recommended-action={rec.kind}
            data-confidence={rec.kind === "insufficient" ? "low" : "ok"}
          >
            <p className="kol-suggestion">
              {rec.kind === "insufficient" ? <IconInfo /> : null}
              {headline}
            </p>
            <p className="kol-ai-why">
              <span className="kol-split-kicker">AI 建议</span>
              {rec.why ? <span className="kol-judgment" data-action-why>{rec.why}</span> : null}
            </p>
          </div>
          <div className="kol-band kol-band-actions" data-kol-band="cta">
            <div className="kol-cta-secondary">
              {hasEvidence ? (
                <details className="kol-evidence-disclosure" data-action-evidence={card.evidence.kind}>
                  <summary>
                    <span className="kol-when-closed">依据</span>
                    <span className="kol-when-open">收起依据</span>
                    <IconChevron />
                  </summary>
                  <p className="kol-evidence">{card.evidence.label}</p>
                </details>
              ) : null}
              <button
                type="button"
                className="kol-cta-link"
                data-open-kol-detail
                title="查看该红人的详情"
                onClick={onOpenDetail}
              >
                详情
              </button>
              {showMail ? (
                <button
                  type="button"
                  className="kol-cta-link"
                  data-open-original-mail
                  data-thread-id={fact.thread_id}
                  title="查看该红人的互动记录"
                  onClick={onOpenMail}
                >
                  互动
                </button>
              ) : null}
              {onRelease ? (
                <button
                  type="button"
                  className="kol-cta-link"
                  data-release-follow
                  data-home-entry="release-follow"
                  onClick={onRelease}
                >
                  回公海
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
                  <span>{ctaText(rec.label)}</span>
                  {ctaHasArrow(rec.label) ? <IconArrow /> : null}
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
                  <span>{actionBusy ? "正在打开…" : ctaText(rec.label)}</span>
                  {!actionBusy && ctaHasArrow(rec.label) ? <IconArrow /> : null}
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
                  <span>{actionBusy ? "正在打开…" : ctaText(rec.label)}</span>
                  {!actionBusy && ctaHasArrow(rec.label) ? <IconArrow /> : null}
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
