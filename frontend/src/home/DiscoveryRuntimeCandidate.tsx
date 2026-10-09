import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type RuntimeActionView } from "../api";
import { friendlyApiError } from "../labels";
import { PoolAvatar, FactIcon } from "./PoolPane";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import { platformLabel, type DiscoveryBrief } from "./discoveryTemplate";

type Candidate = NonNullable<NonNullable<RuntimeActionView["crawl"]>["result_json"]>["candidates"][number];
export default function DiscoveryRuntimeCandidate({ row, actionId, brief, capturedAt, refresh }: {
  row: Candidate; actionId: string; brief: DiscoveryBrief; capturedAt: string; refresh: () => void;
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
        // 跟进成功后会顺带写 Starry 公海；失败不破坏跟进，但必须如实告知。
        if (result.starry_imported === false) {
          setError(`已跟进，但 Starry 入库未完成：${result.starry_error || "未知原因"}。`);
          refresh();
        } else {
          nav("/?tab=lifecycle");
        }
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
  return <article className="discovery-runtime-candidate" data-kol-work-card data-discovery-candidate={row.id}>
    <div className="pool-row-content">
      <div className="pool-row-heading">
        <PoolAvatar card={{ kol_uid: row.id, identity: { display: row.name, platform: row.platform, avatar_url: row.avatar_url || undefined }, metrics: {} }} />
        <strong className="pool-row-name">{row.name}</strong>
        <span className="pool-row-status">{row.followed ? "已跟进" : row.in_pool ? "已加入公海" : row.ignored ? "已忽略" : "候选"}</span></div>
      <div className="pool-row-meta"><span>{platformLabel(row.platform)}</span>
        {source ? <a className="pool-profile-link" href={source} target="_blank" rel="noopener noreferrer">主页 ↗</a> : <span>主页未提供</span>}</div>
      <div className="pool-row-facts"><span className="pool-row-metrics">
        <span><FactIcon type="followers" />粉丝 <b>{row.followers == null ? "无法核验" : row.followers.toLocaleString()}</b></span>
        <span><FactIcon type="avg-plays" />近10条均播 <b>{row.avg_views_10 == null ? "无法核验" : Math.round(row.avg_views_10).toLocaleString()}</b></span>
      </span></div>
      <p className="pool-row-intro">{[row.direction, row.region].filter(Boolean).join(" · ") || "方向与地区待核验"}</p>
      <p className="discovery-candidate-fit">{followerVerified ? followersMatch ? "粉丝符合当前条件" : "粉丝不符合当前条件" : "粉丝缺少可核验来源"}
        {row.avg_views_10 != null ? row.avg_views_10 >= brief.min_avg_plays_10 ? " · 均播符合当前条件" : " · 均播低于当前门槛" : " · 近10条资料不足"}</p>
      <details><summary>资料与筛选依据</summary>
        <p>资料取得时间：{new Date(capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
        {row.followers_evidence?.raw_text ? <p>粉丝来源原文：{row.followers_evidence.raw_text}</p> : null}
        {row.sampled_views_count ? <p>本次采样 {row.sampled_views_count} 条，样本均播 {row.sampled_views_avg == null ? "无法核验" : Math.round(row.sampled_views_avg).toLocaleString()}；未证明覆盖最近10条。</p> : null}
      </details>
      <div className="pool-row-actions discovery-candidate-actions">
        {row.ignored ? <button type="button" className="pool-claim-button" disabled={busy || !snapshot} onClick={() => void command("restore")}>恢复考虑</button> : <>
          <button type="button" className="pool-claim-button is-quiet" title="点击即确认归你跟进，其他员工受排他跟进规则限制（L3）" disabled={busy || !snapshot} onClick={() => void command("follow")}>{busy ? "处理中…" : "跟进"}</button>
          <button type="button" className="pool-claim-button is-quiet" disabled={busy || !snapshot} onClick={() => void command("ignore")}>忽略</button>
          <button type="button" className="pool-claim-button" disabled={busy || !snapshot} title={row.followed ? "补写 Starry 公海（跟进时入库未完成可点此重试；他人的跟进不可操作）" : undefined} onClick={() => row.in_pool ? nav("/?tab=pool") : setConfirm(true)}>加入公海</button>
        </>}
      </div>
      {!snapshot ? <p role="status">此历史结果缺少资料版本，请刷新核对后操作。</p> : null}
      {error && !confirm ? <p role="alert">{error}</p> : null}
    </div>
    <DiscoveryIngestConfirm open={confirm} busy={busy} error={error} onConfirm={() => void command("ingest")} onCancel={() => { if (!busy) { setConfirm(false); setError(""); } }}
      rows={[
        { label: "对象", value: row.name },
        { label: "平台", value: <>{platformLabel(row.platform)} · <code>{row.id}</code></> },
        { label: "来源", value: <>本次发现任务 · {new Date(capturedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</> },
        { label: "说明", value: "导入公开身份和主页；缺失联系方式不补造；不建联、不发信、不改阶段、不取个人跟进" },
      ]}
    />
  </article>;
}
