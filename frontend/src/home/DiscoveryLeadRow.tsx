import { useRef, useState } from "react";
import { displayMetric, type HomeDiscoveryCandidate } from "./discoveryHome";
import {
  briefFitText, collectedAtMinute, confidenceLabel, ingestReadinessLabel,
  ingestReadinessReason, isIngestSelectable, libraryLabel, matchReasonText,
  maskedContactEmail, MISSING_TEXT, playsValue, sampleNote, scoreParts,
  SOURCE_MISSING_LABEL, sourceState, viewFollowerPercent,
} from "./discoveryLeadFields";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";
import KolAvatar from "../components/kol/KolAvatar";
import KolAction from "../components/kol/KolCardActions";
import { KolFactIcon } from "../components/kol/KolFactIcon";
import { KolCardActions, KolCardIdentity, KolCardMeta, KolCardReview, KolCardSelection, KolCardShell } from "../components/kol/KolCardShell";

/** 旧运行结果仍沿用原回调、选择与行内确认契约，仅复用统一呈现。 */
export default function DiscoveryLeadRow({
  candidate, brief, selected, expanded, followedUp, onToggleSelect,
  onToggleExpand, onIngestCandidate, onFollowUpCandidate, onIgnore,
}: {
  candidate: HomeDiscoveryCandidate;
  brief: DiscoveryBrief;
  selected: boolean;
  expanded: boolean;
  followedUp: boolean;
  onToggleSelect: (on: boolean) => void;
  onToggleExpand: () => void;
  onIngestCandidate: () => Promise<void>;
  onFollowUpCandidate: () => Promise<void>;
  onIgnore: () => void;
}) {
  const [confirming, setConfirming] = useState<"ingest" | "follow" | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const runAction = async (kind: "ingest" | "follow") => {
    // 同帧双击也只能进入一次原回调，不替代后端版本与幂等校验。
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "ingest") await onIngestCandidate();
      else await onFollowUpCandidate();
      setConfirming(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作没有完成。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const cancel = () => { if (!busyRef.current) { setConfirming(null); setActionError(null); } };
  const source = sourceState(candidate);
  const plays = playsValue(candidate);
  const note = sampleNote(candidate);
  const email = maskedContactEmail(candidate);
  const selectable = isIngestSelectable(candidate);
  const readiness = ingestReadinessLabel(candidate);
  const readinessReason = ingestReadinessReason(candidate);
  const name = candidate.nickname || candidate.handle || MISSING_TEXT;
  return <KolCardShell variant="discovery"
    data-discovery-candidate={candidate.handle || candidate.id}
    data-candidate-id={candidate.id} data-discovery-origin="discovery"
    data-lead-confidence={confidenceLabel(candidate)} data-lead-library={candidate.libraryStatus}
    data-lead-readiness={candidate.ingestReadiness} data-lead-expanded={expanded ? "true" : undefined}
    data-selected={selected || undefined}>
    <KolCardIdentity data-discovery-candidate-identity>
      <KolCardSelection checked={selected} disabled={!selectable} title={readinessReason || undefined}
        aria-label={`${selectable ? "选择" : `不可入库：${readiness}`} ${candidate.handle || candidate.nickname || "线索"}`}
        onChange={event => onToggleSelect(event.target.checked)} data-discovery-select={candidate.id} />
      <KolAvatar name={name} src={candidate.avatarUrl} identityKey={candidate.id} />
      <strong data-kol-name>{name}</strong>
      <span className="kol-card-state">{candidate.platform ? platformLabel(candidate.platform) : MISSING_TEXT}</span>
      {candidate.in_library && !["already_in_library", "already_followed"].includes(candidate.ingestReadiness)
        ? <span className="kol-card-state" data-discovery-in-library>已在库</span> : null}
      {followedUp ? <span className="kol-card-state" data-lead-followup>已跟进</span> : null}
      <span className="kol-card-state" data-lead-readiness>{readiness}</span>
    </KolCardIdentity>
    <KolCardMeta data-discovery-candidate-meta>
      <span>账号 {candidate.platformCreatorId || MISSING_TEXT}</span>
      <span><KolFactIcon type="followers" />粉丝 <b>{displayMetric(candidate.followers)}</b></span>
      <span><KolFactIcon type="avg-plays" />近10均播 <b>{displayMetric(plays)}</b>{note ? ` · ${note}` : ""}</span>
      <span>播放/粉丝比 {viewFollowerPercent(candidate)}</span>
      <span data-lead-score>{candidate.score == null ? `推荐分 ${MISSING_TEXT}` : `推荐分 ${candidate.score}`}</span>
      <span data-lead-confidence-chip>置信度 {confidenceLabel(candidate)}</span>
    </KolCardMeta>
    <KolCardMeta data-lead-fit><span>{briefFitText(candidate, brief)}</span></KolCardMeta>
    {email ? <KolCardMeta data-lead-email><span>联系邮箱 {email}</span></KolCardMeta> : null}
    <KolCardReview>
      <span data-discovery-candidate-reason>匹配：{matchReasonText(candidate)}</span>
      <KolCardActions>
        {"href" in source ? <a className="kol-card-link" data-discovery-source={candidate.id}
          href={source.href} target="_blank" rel="noreferrer">看来源<KolFactIcon type="external" /></a>
          : <span className="kol-card-state" data-discovery-source-missing title={SOURCE_MISSING_LABEL}
            aria-disabled="true" aria-label={`看来源 · ${SOURCE_MISSING_LABEL}`}>看来源 · {SOURCE_MISSING_LABEL}</span>}
        <KolAction data-lead-expand aria-expanded={expanded}
          aria-label={expanded ? "收起线索详情" : "查看线索详情"} onClick={onToggleExpand}>
          {expanded ? "收起" : "查看详情"}
        </KolAction>
        {!candidate.in_library ? confirming === "ingest" ? <>
          <KolAction data-lead-ingest-confirm={candidate.id} disabled={busy} onClick={() => void runAction("ingest")}>
            {busy ? "入库中…" : "确认加入公海"}
          </KolAction>
          <KolAction disabled={busy} onClick={cancel}>取消</KolAction>
        </> : <KolAction data-lead-ingest={candidate.id} title="将公开资料写入 Starry 并进入公海（R3，需确认）"
          onClick={() => setConfirming("ingest")}>加入公海</KolAction> : null}
        {!followedUp ? confirming === "follow" ? <>
          <KolAction data-lead-followup-confirm={candidate.id} disabled={busy} onClick={() => void runAction("follow")}>
            {busy ? "创建中…" : "确认跟进"}
          </KolAction>
          <KolAction disabled={busy} onClick={cancel}>取消</KolAction>
        </> : <KolAction data-discovery-followup={candidate.id} title="创建线索并更新 Starry 库表"
          onClick={() => setConfirming("follow")}>跟进</KolAction> : null}
        <KolAction data-discovery-ignore={candidate.id} onClick={onIgnore}>忽略</KolAction>
      </KolCardActions>
    </KolCardReview>
    {actionError ? <p className="kol-card-error" data-lead-action-error role="alert">{actionError}</p> : null}
    {expanded ? <dl className="kol-card-evidence-body kol-card-detail" data-lead-detail>
      <div><dt>播放中位数</dt><dd>{displayMetric(candidate.viewMedian)}</dd></div>
      <div><dt>稳定度</dt><dd>{candidate.stability == null || !Number.isFinite(candidate.stability)
        ? MISSING_TEXT : `${Math.round(candidate.stability * 100)}%`}</dd></div>
      <div><dt>采集时间</dt><dd data-lead-collected>{collectedAtMinute(candidate)}</dd></div>
      <div><dt>在库状态</dt><dd data-lead-library-label>{libraryLabel(candidate)}</dd></div>
      <div><dt>转化准备度</dt><dd>{readiness}</dd></div>
      <div><dt>推荐分构成</dt><dd>{scoreParts(candidate)}</dd></div>
      <div><dt>匹配词</dt><dd>{candidate.matchedKeywords.length ? candidate.matchedKeywords.join("、") : MISSING_TEXT}</dd></div>
      {readinessReason ? <div data-lead-readiness-reason><dt>需要处理</dt><dd>{readinessReason}</dd></div> : null}
    </dl> : null}
  </KolCardShell>;
}
