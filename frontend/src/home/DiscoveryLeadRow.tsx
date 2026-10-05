import { displayMetric, type HomeDiscoveryCandidate } from "./discoveryHome";
import {
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
import { platformLabel } from "./discoveryTemplate";

/** Compact default row; long IDs and secondary metrics remain readable in the expanded detail. */
export default function DiscoveryLeadRow({
  candidate, selected, expanded, onToggleSelect, onToggleExpand, onIgnore,
}: {
  candidate: HomeDiscoveryCandidate;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: (on: boolean) => void;
  onToggleExpand: () => void;
  onIgnore: () => void;
}) {
  const source = sourceState(candidate);
  const plays = playsValue(candidate);
  const note = sampleNote(candidate);
  const email = maskedContactEmail(candidate);
  const selectable = isIngestSelectable(candidate);
  const readiness = ingestReadinessLabel(candidate);
  const readinessReason = ingestReadinessReason(candidate);
  return (
    <article className={"discovery-lead" + (expanded ? " is-expanded" : "")}
      data-discovery-candidate={candidate.handle || candidate.id}
      data-candidate-id={candidate.id} data-discovery-origin="discovery"
      data-lead-confidence={confidenceLabel(candidate)} data-lead-library={candidate.libraryStatus}
      data-lead-readiness={candidate.ingestReadiness} data-lead-expanded={expanded ? "true" : undefined}>
      <label className="discovery-lead-select">
        <input type="checkbox" data-discovery-select={candidate.id} checked={selected}
          disabled={!selectable} title={readinessReason || undefined}
          onChange={(event) => onToggleSelect(event.target.checked)} />
        <span className="sr-only">{selectable ? "选择" : `不可入库：${readiness}`} {candidate.handle || candidate.nickname || "线索"}</span>
      </label>
      {candidate.avatarUrl ? (
        <img className="discovery-lead-avatar" data-discovery-avatar="source"
          src={candidate.avatarUrl} alt={`${candidate.nickname || candidate.handle || "红人"}头像`} />
      ) : (
        <span className="discovery-lead-avatar is-initial" data-discovery-avatar="cartoon"
          aria-label={`${candidate.nickname || candidate.handle || "红人"}默认头像`}>
          {String(candidate.nickname || candidate.handle || "?").trim().slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="discovery-lead-main">
        <p className="discovery-lead-identity" data-discovery-candidate-identity>
          <strong className="discovery-lead-nickname">{candidate.nickname || MISSING_TEXT}</strong>
          <span className="discovery-chip discovery-chip-soft">{candidate.platform ? platformLabel(candidate.platform) : MISSING_TEXT}</span>
          <span className="discovery-lead-tag" data-lead-score>{candidate.score == null ? `推荐分 ${MISSING_TEXT}` : `推荐分 ${candidate.score}`}</span>
          <span className={`discovery-lead-tag is-readiness is-${candidate.ingestReadiness}`}
            data-lead-readiness {...(candidate.in_library ? { "data-discovery-in-library": true } : {})}>{readiness}</span>
        </p>
        <p className="discovery-lead-meta" data-discovery-candidate-meta>
          <span>粉丝 {displayMetric(candidate.followers)}</span>
          <span>近10均播 {displayMetric(plays)}{note ? ` · ${note}` : ""}</span>
          <span data-lead-confidence-chip>置信度 {confidenceLabel(candidate)}</span>
          <span className="discovery-lead-match" data-discovery-candidate-reason
            title={`匹配：${matchReasonText(candidate)}`}>
            {`匹配：${matchReasonText(candidate)}`}
          </span>
        </p>
      </div>
      <div className="discovery-lead-actions">
        {("href" in source) ? (
          <a className="discovery-follow-quiet" data-discovery-source={candidate.id}
            href={source.href} target="_blank" rel="noreferrer">看来源</a>
        ) : (
          <span className="discovery-follow-quiet is-disabled" data-discovery-source-missing
            title={SOURCE_MISSING_LABEL} aria-disabled="true" aria-label={`看来源 · ${SOURCE_MISSING_LABEL}`}>
            {`看来源 · ${SOURCE_MISSING_LABEL}`}
          </span>
        )}
        <button type="button" className="discovery-follow-quiet" data-lead-expand
          aria-expanded={expanded} aria-label={expanded ? "收起线索详情" : "查看线索详情"}
          onClick={onToggleExpand}>{expanded ? "收起" : "查看详情"}</button>
        <button type="button" className="discovery-follow-quiet" data-discovery-ignore={candidate.id}
          onClick={onIgnore}>忽略</button>
      </div>
      {expanded ? (
        <dl className="discovery-lead-detail" data-lead-detail>
          <div className="discovery-lead-detail-item is-wide"><dt>平台账号 ID</dt><dd>{candidate.platformCreatorId || MISSING_TEXT}</dd></div>
          <div className="discovery-lead-detail-item is-wide"><dt>匹配依据</dt><dd>{matchReasonText(candidate)}</dd></div>
          {email ? <div className="discovery-lead-detail-item is-wide" data-lead-email><dt>联系邮箱</dt><dd>{email}</dd></div> : null}
          <div className="discovery-lead-detail-item"><dt>播放/粉丝比</dt><dd>{viewFollowerPercent(candidate)}</dd></div>
          <div className="discovery-lead-detail-item"><dt>播放中位数</dt><dd>{displayMetric(candidate.viewMedian)}</dd></div>
          <div className="discovery-lead-detail-item"><dt>稳定度</dt><dd>{candidate.stability == null || !Number.isFinite(candidate.stability) ? MISSING_TEXT : `${Math.round(candidate.stability * 100)}%`}</dd></div>
          <div className="discovery-lead-detail-item"><dt>采集时间</dt><dd data-lead-collected>{collectedAtMinute(candidate)}</dd></div>
          <div className="discovery-lead-detail-item"><dt>在库状态</dt><dd data-lead-library-label>{libraryLabel(candidate)}</dd></div>
          <div className="discovery-lead-detail-item"><dt>转化准备度</dt><dd>{readiness}</dd></div>
          <div className="discovery-lead-detail-item is-wide"><dt>推荐分构成</dt><dd>{scoreParts(candidate)}</dd></div>
          <div className="discovery-lead-detail-item is-wide"><dt>匹配词</dt><dd>{candidate.matchedKeywords.length ? candidate.matchedKeywords.join("、") : MISSING_TEXT}</dd></div>
          {readinessReason ? <div className="discovery-lead-detail-item is-wide" data-lead-readiness-reason>
            <dt>需要处理</dt><dd>{readinessReason}</dd>
          </div> : null}
        </dl>
      ) : null}
    </article>
  );
}
