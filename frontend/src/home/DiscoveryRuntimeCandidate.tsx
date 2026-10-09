import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type RuntimeActionView } from "../api";
import { friendlyApiError } from "../labels";
import { PoolAvatar, FactIcon } from "./PoolPane";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";

export type Candidate = NonNullable<NonNullable<RuntimeActionView["crawl"]>["result_json"]>["candidates"][number];
export default function DiscoveryRuntimeCandidate({ row, actionId, brief, capturedAt, refresh, selected, onSelect }: {
  row: Candidate; actionId: string; brief: DiscoveryBrief; capturedAt: string; refresh: () => void;
  selected?: boolean; onSelect?: (checked: boolean) => void;
}) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const snapshot = row.snapshot_version;
  async function command(verb: "follow" | "ignore" | "restore" | "ingest") {
    if (busy || !snapshot) return;
    setBusy(true); setError("");
    try {
      const result = await api.discoveryCandidateCommand(actionId, row.id, verb, snapshot);
      if (!result.ok) throw new Error("操作结果尚未确认，请刷新核对。");
      if (verb === "follow") {
        if (result.starry_imported === false) {
          setError(`已跟进，但 Starry 入库未完成：${String(result.starry_error || "未知原因").replace(/[。.!！]+$/, "")}。`);
          refresh();
        } else nav("/?tab=lifecycle");
      }
      else if (verb === "ingest") { if (row.followed) refresh(); else nav("/?tab=pool"); }
      else refresh();
      setConfirm(false);
    } catch (error) { setError(friendlyApiError(error, "操作未完成，请刷新核对当前状态。")); }
    finally { setBusy(false); }
  }
  const followersMatch = row.followers != null && row.followers >= brief.min_followers
    && (brief.max_followers == null || row.followers <= brief.max_followers);
  const followerVerified = row.followers_evidence?.state === "source_recorded";
  const source = row.source_url && /^https?:\/\//i.test(row.source_url) ? row.source_url : undefined;
  const assessment = row.assessment;
  const scoreState = assessment?.state || "unscored";
  const score = scoreState === "scored" ? assessment?.potential_score : null;
  const confidence = assessment?.potential_confidence;
  return <article className="discovery-runtime-candidate" data-kol-work-card data-discovery-candidate={row.id} data-selected={selected || undefined}>
    <div className="discovery-candidate-heading">
    {onSelect ? <label className="discovery-candidate-selection"><input type="checkbox" aria-label={`选择 ${row.name}`} checked={Boolean(selected)}
      disabled={!snapshot || row.followed || row.in_pool || row.ignored} onChange={event => onSelect(event.target.checked)} /></label> : null}
    <PoolAvatar card={{ kol_uid: row.id, identity: { display: row.name, platform: row.platform, avatar_url: row.avatar_url || undefined }, metrics: {} }} />
      <strong className="discovery-candidate-name">{row.name}</strong>
      <span className="discovery-candidate-state">{row.followed ? "已跟进" : row.in_pool ? "已加入公海" : row.ignored ? "已忽略" : "候选"}</span>
      <span className="discovery-candidate-score" data-candidate-score={scoreState} role={scoreState === "scoring" ? "status" : undefined}>
        {score != null ? <>评分 <b>{Math.round(score)}</b> / 100{confidence != null && confidence < 0.7 ? " · 需复核" : ""}</>
          : scoreState === "scoring" ? assessment?.execution_state === "queued" ? "排队评分" : "评分中…" : scoreState === "failed" ? "评分失败" : scoreState === "scored" ? "评分资料不足" : "未评分"}
      </span>
    </div>
      <div className="discovery-candidate-meta"><span>{platformLabel(row.platform)}</span>
        <span>{row.region || "地区待核验"}</span>
        <span className="pool-row-metrics">
        <span><FactIcon type="followers" />粉丝 <b>{row.followers == null ? "无法核验" : row.followers.toLocaleString()}</b></span>
        <span><FactIcon type="avg-plays" />近10条均播 <b>{row.avg_views_10 == null ? "无法核验" : Math.round(row.avg_views_10).toLocaleString()}</b></span>
      </span>
        {source ? <a className="pool-profile-link" href={source} target="_blank" rel="noopener noreferrer">主页 ↗</a> : <span>主页未提供</span>}
      </div>
      <div className="discovery-candidate-review">
      <p className="discovery-candidate-fit">{followerVerified ? followersMatch ? "粉丝符合当前条件" : "粉丝不符合当前条件" : "粉丝缺少可核验来源"}
        {row.avg_views_10 != null ? row.avg_views_10 >= brief.min_avg_plays_10 ? " · 均播符合当前条件" : " · 均播低于当前门槛" : " · 近10条资料不足"}</p>
      <div className="discovery-candidate-actions">
        {!row.ignored ? <span className="discovery-candidate-state">R3</span> : null}
        {row.ignored ? <button type="button" className="link-button" disabled={busy || !snapshot} onClick={() => void command("restore")}>恢复考虑</button> : <>
          <button type="button" className="link-button" title="R3 · 点击即确认归你跟进，其他员工受排他跟进规则限制" disabled={busy || !snapshot || row.followed} onClick={() => void command("follow")}>{busy ? "处理中…" : "跟进"}</button>
          <button type="button" className="link-button" disabled={busy || !snapshot} onClick={() => void command("ignore")}>忽略</button>
          <button type="button" className="link-button" disabled={busy || !snapshot} title={row.followed ? "R3 · 补写 Starry 公海（跟进时入库未完成可点此重试；他人的跟进不可操作）" : "R3 · 确认后将公开资料加入公海"} onClick={() => row.in_pool ? nav("/?tab=pool") : setConfirm(true)}>{row.in_pool ? "查看公海" : "加入公海"}</button>
        </>}
      </div>
      </div>
      <details className="discovery-candidate-evidence"><summary>资料与筛选依据{scoreState === "scored" ? " · 评分依据" : ""}</summary>
        <p>资料取得时间：{new Date(capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
        <p>方向：{row.direction || "待核验"}；地区和方向需按来源核验。</p>
        {row.followers_evidence?.raw_text ? <p>粉丝来源原文：{row.followers_evidence.raw_text}</p> : null}
        {row.sampled_views_count ? <p>本次采样 {row.sampled_views_count} 条，样本均播 {row.sampled_views_avg == null ? "无法核验" : Math.round(row.sampled_views_avg).toLocaleString()}；未证明覆盖最近10条。</p> : null}
        {scoreState === "scoring" ? <p role="status">正在依据公开资料与本次发现条件评分；结果会自动更新，可继续筛选候选。</p> : null}
        {scoreState === "failed" ? <p>{assessment?.error || "评分未完成，候选资料仍保留。"}可使用列表顶部“补全评分”。</p> : null}
        {scoreState === "scored" ? <>
          <p>潜力分：{assessment?.potential_score ?? "资料不足"}；信息与匹配风险分：{assessment?.risk_score ?? "资料不足"}。评分仅供人工复核，不改变跟进、入库或阶段。</p>
          <p>依据：平台、账号、公开主页、粉丝、可核验近10条均播、方向与地区；缺失字段不补造。</p>
          <p>评分口径：{assessment?.criteria_summary || "公开资料通用口径；未声明目标条件，不能推断匹配。"}</p>
          <p>潜力置信度：{confidence == null ? "未提供" : `${Math.round(confidence * 100)}%`}；风险置信度：{assessment?.risk_confidence == null ? "未提供" : `${Math.round(assessment.risk_confidence * 100)}%`}。</p>
          <p>评分时间：{assessment?.assessed_at ? new Date(assessment.assessed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "未提供"}；规则版本：{assessment?.version?.replace(/^jev-kol-/, "") || "未提供"}。</p>
        </> : null}
        {!row.ignored && !row.followed ? <p>R3 · 跟进：点击即确认归你跟进；加入公海另行确认。</p> : null}
      </details>
      {!snapshot ? <p role="status">此历史结果缺少资料版本，请刷新核对后操作。</p> : null}
      {error && !confirm ? <p role="alert">{error}</p> : null}
    <DiscoveryIngestConfirm open={confirm} busy={busy} error={error} risk="R3" confirmText="确认入库公海"
      rows={[
        { label: "对象", value: `${row.name} · ${platformLabel(row.platform)} / ${row.id}` },
        { label: "资料", value: `公开身份与主页；本次发现于 ${new Date(capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` },
        { label: "操作", value: "加入正式公海；不取得个人跟进、不发信、不改变阶段。已有指标保留，缺失联系方式不补造。" },
      ]} onConfirm={() => void command("ingest")} onCancel={() => { if (!busy) { setConfirm(false); setError(""); } }} />
  </article>;
}
