import { displayMetric, type HomeDiscoveryCandidate } from "./discoveryHome";
import {
  collectedAtMinute,
  confidenceLabel,
  contactEmail,
  libraryLabel,
  matchReasonText,
  MISSING_TEXT,
  playsValue,
  sampleNote,
  scoreParts,
  SOURCE_MISSING_LABEL,
  sourceState,
  viewFollowerPercent,
} from "./discoveryLeadFields";
import { platformLabel } from "./discoveryTemplate";

function initialOf(candidate: HomeDiscoveryCandidate): string {
  const source = String(candidate.nickname || candidate.platformCreatorId || "").trim();
  return source ? source.slice(0, 1).toUpperCase() : "?";
}

/**
 * Creator lead / Row：默认紧凑行（最小高 76），点「查看详情」展开二级指标。
 * 所有缺失都渲染缺失文案，不编造；无 URL 时「看来源」禁用。
 */
export default function DiscoveryLeadRow({
  candidate,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onIgnore,
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
  const email = contactEmail(candidate);
  const score = candidate.score;
  return (
    <article
      className={"discovery-lead" + (expanded ? " is-expanded" : "")}
      data-discovery-candidate={candidate.handle || candidate.id}
      data-candidate-id={candidate.id}
      data-discovery-origin="discovery"
      data-lead-confidence={confidenceLabel(candidate)}
      data-lead-library={candidate.libraryStatus}
      data-lead-expanded={expanded ? "true" : undefined}
    >
      <label className="discovery-lead-select">
        <input
          type="checkbox"
          data-discovery-select={candidate.id}
          checked={selected}
          onChange={(event) => onToggleSelect(event.target.checked)}
        />
        <span className="sr-only">选择 {candidate.handle || candidate.nickname || "线索"}</span>
      </label>

      <span className="discovery-lead-avatar" aria-hidden>{initialOf(candidate)}</span>

      <div className="discovery-lead-main">
        <p className="discovery-lead-identity" data-discovery-candidate-identity>
          <strong className="discovery-lead-nickname">{candidate.nickname || MISSING_TEXT}</strong>
          <span className="discovery-chip discovery-chip-soft">
            {candidate.platform ? platformLabel(candidate.platform) : MISSING_TEXT}
          </span>
          {candidate.in_library ? (
            <span className="discovery-chip discovery-chip-soft" data-discovery-in-library>已在库</span>
          ) : null}
          <span className="discovery-lead-tag" data-lead-score>
            {score == null ? `推荐分 ${MISSING_TEXT}` : `推荐分 ${score}`}
          </span>
          <span className="discovery-lead-tag" data-lead-confidence-chip>
            {`置信度 ${confidenceLabel(candidate)}`}
          </span>
        </p>
        <p className="discovery-lead-meta" data-discovery-candidate-meta>
          {`账号 ${candidate.platformCreatorId || MISSING_TEXT} · 粉丝 ${displayMetric(candidate.followers)}`
            + ` · 近10均播 ${displayMetric(plays)}${note ? ` · ${note}` : ""}`
            + ` · 播放/粉丝比 ${viewFollowerPercent(candidate)}`}
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
        <button
          type="button"
          className="discovery-follow-quiet"
          data-discovery-ignore={candidate.id}
          onClick={onIgnore}
        >
          忽略
        </button>
      </div>

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
          <div className="discovery-lead-detail-item is-wide">
            <dt>推荐分构成</dt>
            <dd>{scoreParts(candidate)}</dd>
          </div>
          <div className="discovery-lead-detail-item is-wide">
            <dt>匹配词</dt>
            <dd>{candidate.matchedKeywords.length ? candidate.matchedKeywords.join("、") : MISSING_TEXT}</dd>
          </div>
        </dl>
      ) : null}
    </article>
  );
}
