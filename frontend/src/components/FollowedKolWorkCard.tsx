import {
  KolCardActions,
  KolCardEvidence,
  KolCardIdentity,
  KolCardMeta,
  KolCardReview,
  KolCardSelection,
  KolCardShell,
  KolCardSummary,
} from "./kol/KolCardShell";
import KolAvatar from "./kol/KolAvatar";
import KolAction from "./kol/KolCardActions";
import { KolFactIcon } from "./kol/KolFactIcon";
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

function ctaText(label: string): string {
  return String(label || "").replace(/\s*→\s*$/, "");
}

function ctaHasArrow(label: string): boolean {
  return /\s*→\s*$/.test(String(label || ""));
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
  releaseBusy = false,
  releaseError,
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
  releaseBusy?: boolean;
  releaseError?: string;
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
  const emphasized = ctaEmphasis === "strong";
  const showMail = Boolean(fact.thread_id);
  const stageLabel = formatStageBadge(card.current_state.stage_label);
  const factSourceLabel = fact.thread_id ? "邮件摘要" : fact.kind === "confirmed" ? "任务记录" : "互动记录";
  const hasEvidence = card.evidence.kind !== "none" && Boolean(card.evidence.label);

  /** 14 日保鲜期倒计时：用户心智是「剩几天」，不是「已过几天」的统计。 */
  const daysSince = card.source.days_since_interaction;
  const hasTimer = card.source.countdown !== false
    && (card.source.release_due_at || card.source.last_interaction_at);
  const timerChip = !hasTimer
    ? { id: "countdown", label: "尚未有效往来", tone: undefined as "warn" | undefined }
    : daysSince != null && Number.isFinite(Number(daysSince))
      ? (() => {
        const remain = 14 - Number(daysSince);
        return remain > 0
          ? {
            id: "countdown",
            label: `剩 ${remain} 天`,
            tone: (remain <= 3 ? "warn" : undefined) as "warn" | undefined,
            title: `14 天无有效互动将自动回公海${card.source.last_interaction_at ? ` · 上次互动 ${formatFactTime(card.source.last_interaction_at)}` : ""}`,
          }
          : {
            id: "countdown",
            label: `已过 ${Number(daysSince)} 天`,
            tone: "warn" as const,
            title: "已超过 14 天无有效互动，请核对",
          };
      })()
      : card.source.last_interaction_at
        ? { id: "countdown", label: `上次互动 ${formatFactTime(card.source.last_interaction_at)}`, tone: undefined as "warn" | undefined }
        : { id: "countdown", label: "尚未有效往来", tone: undefined as "warn" | undefined };
  const refused = /拒绝|拒信/.test(`${stageLabel} ${card.identity.display}`);
  const marker = RISK_MARKER_ORDER
    .map((id) => card.risk.chips.find((chip) => chip.id === id))
    .find((chip) => chip && !(chip.id === "refused" && refused));
  const quietRisk = card.risk.chips.filter((chip) => chip.id !== marker?.id && chip.id !== "near-14d" && chip.id !== "refused");
  /**
   * 元信息行只保留扫读必需：平台 · 粉丝 · 地区 · 产品 · 倒计时 · 未读。
   * 品牌/负责人/停留天数进详情（本页是「我的红人」，负责人恒为本人）。
   */
  const meta = [
    card.identity.platform ? { id: "platform", label: card.identity.platform } : null,
    card.scope.region ? { id: "region", label: card.scope.region } : null,
    card.source.followers ? { id: "followers", label: `粉丝 ${card.source.followers}` } : null,
    card.scope.product ? { id: "product", label: card.scope.product } : null,
    timerChip,
    ...quietRisk,
    card.unread_count > 0 ? { id: "unread", label: `未读 ${card.unread_count}` } : null,
  ].filter(Boolean) as { id: string; label: string; tone?: "warn"; title?: string }[];
  const rootClassName = [
    card.risk.exception ? "is-exception" : "",
    card.current_state.unbound ? "is-unbound" : "",
    hovered ? "is-hovered" : "",
  ].filter(Boolean).join(" ");

  return (
    <KolCardShell
      variant="followed"
      className={rootClassName}
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
      <KolCardIdentity data-kol-band="identity">
        <KolCardSelection
          data-followed-select={card.id}
          checked={selected}
          aria-label={`选择 ${card.identity.display}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onToggleSelect?.(event.target.checked)}
        />
        <KolAvatar
          name={card.identity.display}
          src={card.identity.avatar_url}
          identityKey={card.source.kol_uid || card.id}
        />
        <strong className="kol-card-name" data-kol-identity data-kol-name title={card.identity.display}>{card.identity.display}</strong>
        <span
          className="kol-card-stage"
          data-current-state
          data-current-stage
          data-stage-code={card.current_state.stage_code || undefined}
        >
          <span data-stage-label>{stageLabel}</span>
        </span>
        {marker ? (
          <span
            className="kol-card-risk"
            data-kol-chip={marker.id}
            data-unbound={marker.id === "unbound" ? "true" : undefined}
            title={marker.label}
          >
            <KolFactIcon type="alert" />
            {marker.label}
          </span>
        ) : null}
      </KolCardIdentity>

      {meta.length ? (
        <KolCardMeta data-kol-scope>
          {meta.map((chip) => (
            <span
              key={chip.id + chip.label}
              className={[
                "kol-card-meta-item",
                chip.id === "unread" ? "is-unread" : "",
                chip.id === "unread" && marker ? "is-quiet" : "",
                chip.tone === "warn" ? "is-countdown-warn" : "",
              ].filter(Boolean).join(" ")}
              data-kol-chip={chip.id}
              data-unread-count={chip.id === "unread" ? card.unread_count : undefined}
              title={chip.title || chip.label}
            >
              {chip.id === "followers" ? <KolFactIcon type="followers" /> : null}
              {chip.id === "countdown" && chip.tone === "warn" ? <KolFactIcon type="alert" /> : null}
              {chip.id === "followers" ? <>粉丝 <b>{card.source.followers}</b></> : chip.label}
            </span>
          ))}
        </KolCardMeta>
      ) : null}

      <KolCardReview className="kol-card-fact" data-kol-band="fact" data-kol-split>
        <div data-latest-fact data-fact-kind={fact.kind}>
          <KolCardSummary
            label={`最近互动 · ${factSourceLabel}`}
            text={fact.summary}
            data-fact-source
            data-mail-summary={fact.thread_id || undefined}
          />
        </div>
      </KolCardReview>

      <KolCardReview data-kol-band="action">
        <div
          className="kol-card-recommendation"
          data-recommended-action={rec.kind}
          data-confidence={rec.kind === "insufficient" ? "low" : "ok"}
        >
          <p className="kol-card-suggestion">
            {rec.kind === "insufficient" ? <KolFactIcon type="alert" /> : null}
            <span className="kol-card-suggestion-title">{headline}</span>
            {rec.why ? <span className="kol-card-why" data-action-why>· {rec.why}</span> : null}
          </p>
        </div>
        <KolCardActions data-kol-band="cta">
          {showCompose ? (
            <KolAction
              className="kol-cta-work"
              emphasized={emphasized}
              data-kol-primary-action={primary}
              data-cta-role={rec.kind === "compose" ? "draft" : "send"}
              data-cta-visual="text"
              onClick={onCompose || onPrimary}
            >
              <span>{ctaText(rec.label)}</span>
              {ctaHasArrow(rec.label) ? <KolFactIcon type="arrow" /> : null}
            </KolAction>
          ) : null}
          {showConfirm ? (
            <KolAction
              className="kol-cta-work"
              emphasized={emphasized}
              data-kol-primary-action="confirm-stage"
              data-cta-role="stage"
              data-cta-visual="text"
              data-confirm-enter-stage
              data-confirm-stage-priority="primary"
              data-target-stage={rec.target_stage_code}
              data-confirm-stage-busy={actionBusy ? "true" : undefined}
              disabled={actionBusy}
              onClick={onConfirmStage || onPrimary}
            >
              <span>{actionBusy ? "正在打开…" : ctaText(rec.label)}</span>
              {!actionBusy && ctaHasArrow(rec.label) ? <KolFactIcon type="arrow" /> : null}
            </KolAction>
          ) : null}
          {primary && !showCompose && !showConfirm ? (
            <KolAction
              className="kol-cta-work"
              emphasized={emphasized}
              data-kol-primary-action={primary}
              data-cta-role="other"
              data-cta-visual="text"
              disabled={actionBusy}
              onClick={onPrimary}
            >
              <span>{actionBusy ? "正在打开…" : ctaText(rec.label)}</span>
              {!actionBusy && ctaHasArrow(rec.label) ? <KolFactIcon type="arrow" /> : null}
            </KolAction>
          ) : null}
          <KolAction
            data-open-kol-detail
            title="查看该红人的详情"
            onClick={onOpenDetail}
          >
            详情
          </KolAction>
          {showMail ? (
            <KolAction
              data-open-original-mail
              data-thread-id={fact.thread_id}
              title="查看该红人的互动记录"
              onClick={onOpenMail}
            >
              互动
            </KolAction>
          ) : null}
          {onRelease ? (
            <KolAction
              className="is-danger"
              data-release-follow
              data-home-entry="release-follow"
              disabled={releaseBusy}
              title="解除跟进关系，该红人将回到公海"
              onClick={onRelease}
            >
              {releaseBusy ? "正在放回…" : "放回公海"}
            </KolAction>
          ) : null}
        </KolCardActions>
      </KolCardReview>

      {hasEvidence ? (
        <KolCardEvidence
          label="依据"
          data-action-evidence={card.evidence.kind}
        >
          <p>{card.evidence.label}</p>
        </KolCardEvidence>
      ) : null}
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
      {releaseError ? <p className="error" data-release-follow-error role="alert">{releaseError}</p> : null}
    </KolCardShell>
  );
}
