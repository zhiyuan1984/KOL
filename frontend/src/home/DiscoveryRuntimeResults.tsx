import { useState } from "react";
import { api, type RuntimeActionView } from "../api";
import type { DiscoveryBrief } from "./discoveryTemplate";

export default function DiscoveryRuntimeResults({ actions, brief, onAnalyze, analyzing }: {
  actions: RuntimeActionView[]; brief: DiscoveryBrief; onAnalyze?: (taskId: string) => void; analyzing?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(30);
  const runs = actions.filter(a => a.operation === "start_crawl" && a.crawl);
  if (!runs.length) return <p className="muted" data-discovery-results>尚未取得采集回执。确认范围后，候选结果会保存在这里。</p>;
  return <section data-discovery-results aria-label="发现候选">
    <h2>发现候选</h2>
    {error ? <p role="alert">{error}</p> : null}
    {runs.map(action => {
      const crawl = action.crawl!;
      const result = crawl.result_json;
      return <article key={action.id}>
        <p>采集编号：{crawl.remote_task_id || "等待回执"}</p>
        {["failed", "partial"].includes(crawl.result_state || "") ? <div role="status">
          <strong>{crawl.result_state === "partial" ? "本轮读取已达分页预算，可继续读取余下候选" : "候选读取未完成"}</strong>
          {crawl.result_state === "failed" ?
          <p>{["crawl_result_scope_unsupported", "crawl_result_task_mismatch"].includes(crawl.result_error || "")
            ? "采集服务尚未提供可验证的本任务候选结果。请由管理员核对任务隔离接口；未读取全局候选。"
            : crawl.result_error === "crawl_result_snapshot_changed" ? "远端结果在分页间发生变化，已保留原快照。请核对数据源，暂不将两版结果合并。"
            : "结果读取失败，采集记录仍保留。可重试读取，不会重新采集。"}</p> : null}
          <button className="btn ghost" disabled={Boolean(busy)} onClick={async () => {
            setBusy(action.id); setError("");
            try { await api.retryCrawlResults(action.id); setError("已安排重新读取，稍后刷新结果。"); }
            catch { setError("未能安排读取，请核对当前权限和任务状态。"); }
            finally { setBusy(null); }
          }}>{crawl.result_state === "partial" ? "继续读取候选" : "重试读取结果"}</button>
        </div> : null}
        {!result && crawl.result_state !== "failed" ? <p>{["failed", "uncertain"].includes(crawl.state) ? "采集未成功结束，请在中栏核对失败或待核实原因。" : "等待采集结束并整理本次候选。"}</p> : null}
        {result ? <>
          <p>{result.candidates.length} 位候选 · {result.complete ? "结果读取完成" : "部分结果，尚未读取完整"}{crawl.state === "cancelled" ? " · 采集已取消，仅保留已取得候选" : ""}</p>
          <p>期望 {brief.expect_count} 位；当前返回数量不代表全部符合条件。</p>
          <p className="muted">来源时间：{new Date(result.captured_at).toLocaleString()}。以下是候选记录，未导入正式库；地区和方向需核验。</p>
          {onAnalyze && result.candidates.length > 0 ? <button className="btn ghost" disabled={analyzing} onClick={() => onAnalyze(result.task_id)}>让线索智能体分析候选</button> : null}
          {!result.candidates.length ? <p>本次采集返回空结果，可调整条件新建发现任务。</p> : null}
          {result.candidates.slice(0, visible).map(row => <div className="artifact" key={row.id}>
            <strong>{row.name}</strong><p>{row.platform} · {row.id}</p>
            {row.source_url && /^https?:\/\//i.test(row.source_url) ? <a href={row.source_url} target="_blank" rel="noreferrer">查看原始主页</a> : <span className="muted">未提供主页链接</span>}
            <p>粉丝：{row.followers === null ? "无法核验" : row.followers.toLocaleString()}{row.followers_evidence?.state === "source_recorded"
              ? row.followers !== null && (row.followers < brief.min_followers || row.followers > brief.max_followers) ? " · 采集值不符合当前门槛" : ""
              : " · 缺少可核验来源，暂不判定门槛"}</p>
            {row.followers_evidence?.raw_text ? <p className="muted">订阅数原文：{row.followers_evidence.raw_text}
              {row.followers_evidence.captured_at ? ` · ${new Date(row.followers_evidence.captured_at).toLocaleString()}` : ""}</p> : null}
            <p>近10条均播：{row.avg_views_10 === null ? "数据不足，无法核验" : Math.round(row.avg_views_10).toLocaleString()}{row.avg_views_10 !== null && row.avg_views_10 < brief.min_avg_plays_10 ? " · 低于当前门槛" : ""}</p>
            {row.sampled_views_count ? <p>本次采集样本 {row.sampled_views_count} 条 · 样本均播：{row.sampled_views_avg == null ? "无法核验" : Math.round(row.sampled_views_avg).toLocaleString()}（未证明覆盖最近10条）</p> : null}
            <p>地区：{row.region || "未提供"} · 待核验</p>
          </div>)}
          {result.candidates.length > visible ? <button className="btn ghost" onClick={() => setVisible(v => v + 30)}>显示更多候选</button> : null}
        </> : null}
      </article>;
    })}
  </section>;
}
