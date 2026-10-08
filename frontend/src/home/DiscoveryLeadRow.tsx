import { useState } from "react";
import { displayMetric, type HomeDiscoveryCandidate } from "./discoveryHome";
import {
  briefFitText,
  collectedAtMinute,
  confidenceLabel,
  ingestReadinessLabel,
  ingestReadinessReason,
  isIngestSelectable,
  libraryLabel,
  matchReasonText,
  maskedContactEmail,
  MISSING_TEXT,
  playsValue,
  sampleNote,
  scoreParts,
  SOURCE_MISSING_LABEL,
  sourceState,
  viewFollowerPercent,
} from "./discoveryLeadFields";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";

function CartoonAvatar() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <circle cx="18" cy="18" r="18" fill="currentColor" opacity="0.12" />
      <path d="M9.5 30c1.2-5.2 4.3-7.8 8.5-7.8s7.3 2.6 8.5 7.8" fill="currentColor" opacity="0.72" />
      <circle cx="18" cy="14.2" r="6.2" fill="currentColor" opacity="0.9" />
      <path d="M12.3 13.8c.7-4.2 3.1-6.3 5.7-6.3 3 0 5.1 2.2 5.7 6.3-2.1-1.6-3.9-2.2-5.7-2.2s-3.6.6-5.7 2.2Z" fill="var(--bg)" opacity="0.72" />
    </svg>
  );
}

/**
 * Creator lead / Row：身份、指标、理由和文字操作依次排列，点「查看详情」展开二级指标。
 * 所有缺失都渲染缺失文案，不编造；无 URL 时「看来源」禁用。
 *
 * 二期 CTA：「加入公海」（L2，全卡唯一，入 Starry 库）与「跟进」（L3，创建线索 +
 * 更新 Starry 库表）。两个都是 consequential 动作，行内二次确认后执行。
 */
export default function DiscoveryLeadRow({
  candidate,
  brief,
  selected,
  expanded,
  followedUp,
  onToggleSelect,
  onToggleExpand,
  onIngestCandidate,
  onFollowUpCandidate,
  onIgnore,
}: {
  candidate: HomeDiscoveryCandidate;
  /** 本次 brief 门槛：只用于前端算门槛符合度，不发请求。 */
  brief: DiscoveryBrief;
  selected: boolean;
  expanded: boolean;
  /** 已跟进（线索已创建）：隐藏「跟进」按钮，显示状态。 */
  followedUp: boolean;
  onToggleSelect: (on: boolean) => void;
  onToggleExpand: () => void;
  onIngestCandidate: () => Promise<void>;
  onFollowUpCandidate: () => Promise<void>;
  onIgnore: () => void;
}) {
  const [confirming, setConfirming] = useState<"ingest" | "follow" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (kind: "ingest" | "follow") => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "ingest") await onIngestCandidate();
      else await onFollowUpCandidate();
      setConfirming(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作没有完成。");
    } finally {
      setBusy(false);
    }
  };
  const source = sourceState(candidate);
  const plays = playsValue(candidate);
  const note = sampleNote(candidate);
  const email = maskedContactEmail(candidate);
  const score = candidate.score;
  const selectable = isIngestSelectable(candidate);
  const readiness = ingestReadinessLabel(candidate);
  const readinessReason = ingestReadinessReason(candidate);
  return (
    <article
      className={"discovery-lead" + (expanded ? " is-expanded" : "")}
      data-discovery-candidate={candidate.handle || candidate.id}
      data-candidate-id={candidate.id}
      data-discovery-origin="discovery"
      data-lead-confidence={confidenceLabel(candidate)}
      data-lead-library={candidate.libraryStatus}
      data-lead-readiness={candidate.ingestReadiness}
      data-lead-expanded={expanded ? "true" : undefined}
    >
      <label className="discovery-lead-select">
        <input
          type="checkbox"
          data-discovery-select={candidate.id}
          checked={selected}
          disabled={!selectable}
          title={readinessReason || undefined}
          onChange={(event) => onToggleSelect(event.target.checked)}
        />
        <span className="sr-only">
          {selectable ? "选择" : `不可入库：${readiness}`} {candidate.handle || candidate.nickname || "线索"}
        </span>
      </label>

      {candidate.avatarUrl ? (
        <img
          className="discovery-lead-avatar"
          data-discovery-avatar="source"
          src={candidate.avatarUrl}
          alt={`${candidate.nickname || candidate.handle || "红人"}头像`}
        />
      ) : (
        <span
          className="discovery-lead-avatar is-cartoon"
          data-discovery-avatar="cartoon"
          aria-label={`${candidate.nickname || candidate.handle || "红人"}默认头像`}
        >
          <CartoonAvatar />
        </span>
      )}

      <div className="discovery-lead-main">
        <p className="discovery-lead-identity" data-discovery-candidate-identity>
          <strong className="discovery-lead-nickname">{candidate.nickname || MISSING_TEXT}</strong>
          <span className="discovery-chip discovery-chip-soft">
            {candidate.platform ? platformLabel(candidate.platform) : MISSING_TEXT}
          </span>
          {candidate.in_library && !["already_in_library", "already_followed"].includes(candidate.ingestReadiness) ? (
            <span className="discovery-chip discovery-chip-soft" data-discovery-in-library>已在库</span>
          ) : null}
          {followedUp ? (
            <span className="discovery-lead-tag is-followup" data-lead-followup>已跟进</span>
          ) : null}
          <span className={`discovery-lead-tag is-readiness is-${candidate.ingestReadiness}`} data-lead-readiness>
            {readiness}
          </span>
        </p>
        <p className="discovery-lead-meta" data-discovery-candidate-meta data-lead-fit>
          <span>{`${briefFitText(candidate, brief)} · 账号 ${candidate.platformCreatorId || MISSING_TEXT} · 粉丝 ${displayMetric(candidate.followers)}`
            + ` · 近10均播 ${displayMetric(plays)}${note ? ` · ${note}` : ""}`
            + ` · 播放/粉丝比 ${viewFollowerPercent(candidate)}`}</span>
          <span data-lead-score>{score == null ? `推荐分 ${MISSING_TEXT}` : `推荐分 ${score}`}</span>
          <span data-lead-confidence-chip>{`置信度 ${confidenceLabel(candidate)}`}</span>
        </p>
        {email ? (
          <p className="discovery-lead-meta" data-lead-email>
            {`联系邮箱 ${email}`}
          </p>
        ) : null}
        <p className="discovery-lead-reason" data-discovery-candidate-reason>
          {`匹配：${matchReasonText(candidate)}`}
        </p>
      </div>

      <div className="discovery-lead-actions">
        {("href" in source) ? (
          <a
            className="discovery-follow-quiet"
            data-discovery-source={candidate.id}
            href={source.href}
            target="_blank"
            rel="noreferrer"
          >
            看来源
          </a>
        ) : (
          <span
            className="discovery-follow-quiet is-disabled"
            data-discovery-source-missing
            title={SOURCE_MISSING_LABEL}
            aria-disabled="true"
            aria-label={`看来源 · ${SOURCE_MISSING_LABEL}`}
          >
            {`看来源 · ${SOURCE_MISSING_LABEL}`}
          </span>
        )}
        <button
          type="button"
          className="discovery-follow-quiet"
          data-lead-expand
          aria-expanded={expanded}
          aria-label={expanded ? "收起线索详情" : "查看线索详情"}
          onClick={onToggleExpand}
        >
          {expanded ? "收起" : "查看详情"}
        </button>
        {!candidate.in_library ? (
          confirming === "ingest" ? (
            <>
              <button
                type="button"
                className="pool-claim-button"
                data-lead-ingest-confirm={candidate.id}
                disabled={busy}
                onClick={() => void runAction("ingest")}
              >
                {busy ? "入库中…" : "确认加入公海"}
              </button>
              <button
                type="button"
                className="discovery-follow-quiet"
                disabled={busy}
                onClick={() => { if (!busy) { setConfirming(null); setActionError(null); } }}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pool-claim-button"
              data-lead-ingest={candidate.id}
              title="将公开资料写入 Starry 并进入公海（L3，需确认）"
              onClick={() => setConfirming("ingest")}
            >
              加入公海
            </button>
          )
        ) : null}
        {!followedUp ? (
          confirming === "follow" ? (
            <>
              <button
                type="button"
                className="discovery-follow-quiet"
                data-lead-followup-confirm={candidate.id}
                disabled={busy}
                onClick={() => void runAction("follow")}
              >
                {busy ? "创建中…" : "确认跟进"}
              </button>
              <button
                type="button"
                className="discovery-follow-quiet"
                disabled={busy}
                onClick={() => { if (!busy) { setConfirming(null); setActionError(null); } }}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="discovery-follow-quiet"
              data-discovery-followup={candidate.id}
              title="创建线索并更新 Starry 库表"
              onClick={() => setConfirming("follow")}
            >
              跟进
            </button>
          )
        ) : null}
        <button
          type="button"
          className="discovery-follow-quiet"
          data-discovery-ignore={candidate.id}
          onClick={onIgnore}
        >
          忽略
        </button>
      </div>
      {actionError ? (
        <p className="discovery-lead-action-error" data-lead-action-error role="alert">{actionError}</p>
      ) : null}

      {expanded ? (
        <dl className="discovery-lead-detail" data-lead-detail>
          <div className="discovery-lead-detail-item">
            <dt>播放中位数</dt>
            <dd>{displayMetric(candidate.viewMedian)}</dd>
          </div>
          <div className="discovery-lead-detail-item">
            <dt>稳定度</dt>
            <dd>
              {candidate.stability == null || !Number.isFinite(candidate.stability)
                ? MISSING_TEXT
                : `${Math.round(candidate.stability * 100)}%`}
            </dd>
          </div>
          <div className="discovery-lead-detail-item">
            <dt>采集时间</dt>
            <dd data-lead-collected>{collectedAtMinute(candidate)}</dd>
          </div>
          <div className="discovery-lead-detail-item">
            <dt>在库状态</dt>
            <dd data-lead-library-label>{libraryLabel(candidate)}</dd>
          </div>
          <div className="discovery-lead-detail-item">
            <dt>转化准备度</dt>
            <dd>{readiness}</dd>
          </div>
          <div className="discovery-lead-detail-item is-wide">
            <dt>推荐分构成</dt>
            <dd>{scoreParts(candidate)}</dd>
          </div>
          <div className="discovery-lead-detail-item is-wide">
            <dt>匹配词</dt>
            <dd>{candidate.matchedKeywords.length ? candidate.matchedKeywords.join("、") : MISSING_TEXT}</dd>
          </div>
          {readinessReason ? (
            <div className="discovery-lead-detail-item is-wide" data-lead-readiness-reason>
              <dt>需要处理</dt>
              <dd>{readinessReason}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </article>
  );
}
