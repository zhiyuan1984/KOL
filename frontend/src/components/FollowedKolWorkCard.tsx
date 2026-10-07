import { useState } from "react";
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

/**
 * 主 CTA 统一 L3 文字按钮（DESIGN §24.6：行内重复出现的动作一律 L3）。
 * 强调靠 data-cta-emphasis 属性（hover/focus 单张卡）驱动：默认 L3 文字按钮，
 * 被强调时（hover / 键盘焦点）变实底，保证键盘用户看得见焦点位置
 * （仓库硬契约 e8f3b50a「实底 CTA 跟住焦点」，e2e home-followed-focus 覆盖）。
 * `kol-cta-work` 是该契约的标记类，勿删。
 */
function workCtaClass(emphasized: boolean): string {
  return ["kol-cta-main", "kol-cta-work", emphasized ? "is-emphasized" : ""]
    .filter(Boolean)
    .join(" ");
}

/** 箭头不再是文本字符：label 结尾的「→」拆出来交给统一 SVG 图标。 */
function ctaText(label: string): string {
  return String(label || "").replace(/\s*→\s*$/, "");
}

function ctaHasArrow(label: string): boolean {
  return /\s*→\s*$/.test(String(label || ""));
}

const FALLBACK_AVATARS = [
  "/avatars/kol-fallback/thumbs-up.png",
  "/avatars/kol-fallback/strong.png",
  "/avatars/kol-fallback/great.png",
];

function stableAvatarIndex(value: string): number {
  return Array.from(String(value || "kol")).reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 7) % FALLBACK_AVATARS.length;
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
  const [avatarFailed, setAvatarFailed] = useState(false);
  const fact = card.latest_fact;
  const headline = recommendedActionHeadline(rec);
  const primary = primaryKind(rec.kind);
  const showConfirm = rec.kind === "confirm-stage" && rec.can_write_stage && Boolean(rec.target_stage_label);
  const showCompose = rec.kind === "compose" || rec.kind === "confirm-send";
  const emphasized = ctaEmphasis === "strong";
  const showMail = Boolean(fact.thread_id);
  const stageLabel = formatStageBadge(card.current_state.stage_label);
  const fallbackAvatar = FALLBACK_AVATARS[stableAvatarIndex(card.source.kol_uid || card.id)];
  const avatarSource = card.identity.avatar_url && !avatarFailed ? card.identity.avatar_url : fallbackAvatar;
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
    card.source.followers ? { id: "followers", label: `粉丝 ${card.source.followers}` } : null,
    card.scope.region ? { id: "region", label: card.scope.region } : null,
    card.scope.product ? { id: "product", label: card.scope.product } : null,
    timerChip,
    ...quietRisk,
    card.unread_count > 0 ? { id: "unread", label: `未读 ${card.unread_count}` } : null,
  ].filter(Boolean) as { id: string; label: string; tone?: "warn"; title?: string }[];

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
        <span className="kol-avatar" data-kol-avatar data-avatar-source={card.identity.avatar_url && !avatarFailed ? "kol" : "fallback"} aria-hidden>
          <img
            src={avatarSource}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              if (card.identity.avatar_url && !avatarFailed) setAvatarFailed(true);
            }}
          />
        </span>
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
            <div className="kol-cta-primary">
              {showCompose ? (
                <button
                  type="button"
                  className={workCtaClass(emphasized)}
                  data-kol-primary-action={primary}
                  data-cta-role={rec.kind === "compose" ? "draft" : "send"}
                  data-cta-visual="text"
                  onClick={onCompose || onPrimary}
                >
                  <span>{ctaText(rec.label)}</span>
                  {ctaHasArrow(rec.label) ? <IconArrow /> : null}
                </button>
              ) : null}
              {showConfirm ? (
                <button
                  type="button"
                  className={workCtaClass(emphasized)}
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
                  {!actionBusy && ctaHasArrow(rec.label) ? <IconArrow /> : null}
                </button>
              ) : null}
              {primary && !showCompose && !showConfirm ? (
                <button
                  type="button"
                  className={workCtaClass(emphasized)}
                  data-kol-primary-action={primary}
                  data-cta-role="other"
                  data-cta-visual="text"
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
      {/* 元信息独立成行：整行左对齐，不再挤在 identity-main 的 flex 行内 */}
      {meta.length ? (
        <div className="kol-chip-row" data-kol-scope>
          {meta.map((chip) => (
            <span
              key={chip.id + chip.label}
              className={
                "kol-chip"
                + (chip.id === "unread" ? " is-unread" : "")
                + (chip.id === "unread" && marker ? " is-quiet" : "")
                + (chip.tone === "warn" ? " is-countdown-warn" : "")
              }
              data-kol-chip={chip.id}
              data-unread-count={chip.id === "unread" ? card.unread_count : undefined}
              title={chip.title || chip.label}
            >
              {chip.id === "countdown" && chip.tone === "warn" ? <IconAlert /> : null}
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="kol-split" data-kol-split>
        <div className="kol-band kol-band-fact" data-kol-band="fact">
          <div className="kol-state-block" data-latest-fact data-fact-kind={fact.kind}>
            <p className="kol-band-label" data-fact-source>{`最近互动 · ${factSourceLabel}`}</p>
            <p className="kol-mail-digest" data-mail-summary={fact.thread_id || undefined}>
              {fact.summary}
            </p>
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
              <span>{headline}</span>
              {rec.why ? <span className="kol-why-inline" data-action-why>· {rec.why}</span> : null}
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
                  className="kol-cta-link is-danger"
                  data-release-follow
                  data-home-entry="release-follow"
                  title="解除跟进关系，该红人将回到公海"
                  onClick={onRelease}
                >
                  回公海
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
