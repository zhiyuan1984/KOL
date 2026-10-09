import { useState } from "react";
import { api, type RuntimeActionView } from "../api";
import type { DiscoveryBrief } from "./discoveryTemplate";
import DiscoveryCandidateBatch from "./DiscoveryCandidateBatch";
import "./discovery-results.css";

export default function DiscoveryRuntimeResults({ actions, brief, onRefresh, candidateIds, selectedIds, onSelect }: {
  actions: RuntimeActionView[]; brief: DiscoveryBrief;
  onRefresh?: () => void; candidateIds?: string[]; selectedIds?: string[]; onSelect?: (id: string, on: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(30);
  const [showIgnored, setShowIgnored] = useState(false);
  const runs = actions.filter(a => a.operation === "start_crawl" && a.crawl);
  if (!runs.length) {
    const attempted = actions.some(action => action.operation === "start_crawl"
      && (Boolean(action.execution) || action.state !== "pending"));
    return <p className="muted" data-discovery-results>{attempted
      ? "尚未取得候选资料。执行状态与恢复入口见中栏。"
      : "确认采集范围后，候选资料会显示在这里。"}</p>;
  }
  const hasIgnored = runs.some(action => action.crawl?.result_json?.candidates.some(row => row.ignored));
  return <section className="discovery-runtime-results" data-discovery-results aria-label="发现候选">
    {hasIgnored || showIgnored ? <button type="button" className="link-button" aria-pressed={showIgnored} onClick={() => setShowIgnored(value => !value)}>{showIgnored ? "返回候选" : "已忽略"}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
    {runs.map(action => {
      const crawl = action.crawl!;
      const result = crawl.result_json;
      return <article key={action.id}>
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
          <header className="discovery-results-summary" data-discovery-results-summary>
            <div><strong>{crawl.state === "cancelled" ? "采集已取消" : result.complete ? "结果读取完成" : "部分结果"}</strong>
              <span>{result.candidates.length} 位候选 / 期望 {brief.expect_count} 位</span>
              <span>已评分 {result.candidates.filter(row => row.assessment?.state === "scored").length} 位</span></div>
            <p>当前数量不代表全部符合条件；缺失指标逐条标出。评分自动更新，跟进与加入公海分别执行。</p>
          </header>
          {!result.candidates.length ? <p>本次采集返回空结果，可调整条件新建发现任务。</p> : null}
          {result.candidates.length ? <DiscoveryCandidateBatch rows={result.candidates.filter(row => Boolean(row.ignored) === showIgnored && (showIgnored || !candidateIds || candidateIds.includes(row.id))).slice(0, visible)}
            selectedIds={selectedIds} onSelect={onSelect} actionId={action.id} brief={brief} capturedAt={result.captured_at}
            refresh={() => { onRefresh?.(); window.dispatchEvent(new Event("discovery:candidates-refresh")); }} /> : null}
          {showIgnored && !result.candidates.some(row => row.ignored) ? <p>本次发现没有已忽略的候选。</p> : null}
          {result.candidates.filter(row => Boolean(row.ignored) === showIgnored).length > visible ? <button className="btn ghost" onClick={() => setVisible(v => v + 30)}>显示更多候选</button> : null}
        </> : null}
      </article>;
    })}
  </section>;
}
