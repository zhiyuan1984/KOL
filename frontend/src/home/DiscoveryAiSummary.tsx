import {
  runCountsLabel,
  runHeadline,
  type HomeDiscoveryEmptyKind,
  type HomeDiscoveryRun,
} from "./discoveryHome";
import { discoveryRunStatusLabel } from "./discoveryLeadFields";

type FailureView = {
  kind?: string;
  title: string;
  message: string;
  detail?: string | null;
  retryLabel?: string;
  retryDisabled?: boolean;
  checkConnection?: boolean;
} | null;

/** The result and the process own the figures and evidence; the summary is one status line. */
export default function DiscoveryAiSummary({
  run,
  visibleCount,
  inFlight,
  failure,
  emptyKind,
  emptyMessage,
  retryBusy = false,
  onRetry,
  onCheckConnection,
  connection,
}: {
  run: HomeDiscoveryRun | null;
  visibleCount: number;
  inFlight: boolean;
  failure: FailureView;
  emptyKind: HomeDiscoveryEmptyKind;
  emptyMessage: string;
  retryBusy?: boolean;
  onRetry?: () => void;
  onCheckConnection?: () => void;
  connection?: { status: string; label: string; message: string } | null;
}) {
  const contract = run?.status_contract;
  const status = failure ? "需要处理" : inFlight ? "检索中"
    : run ? discoveryRunStatusLabel(run) : emptyKind === "down" ? "服务不可用" : "等待发现";
  const headline = failure?.title || contract?.title || (
    run ? runHeadline(run) : emptyKind === "down" ? "暂时无法开始发现红人"
      : inFlight ? "正在发现红人线索" : "准备发现红人线索"
  );
  const counts = run ? runCountsLabel(run, visibleCount)
    : visibleCount ? `入围 ${visibleCount}` : emptyKind === "down" ? "检索尚未开始" : "尚未开始";
  const tone = failure || emptyKind === "down" ? "warning" : inFlight ? "running" : visibleCount ? "ready" : "idle";
  const finding = failure
    ? failure.kind === "generic" ? "检索没有完成，可稍后重试。" : failure.message
    : emptyKind === "down"
      ? "发现服务当前不可用，本次任务尚未启动，因此没有采集、筛选或排序结果。已有输入会保留，可稍后重试。"
      : emptyKind === "filtered" && !visibleCount ? emptyMessage
      : contract?.message || (inFlight ? "正在按已确认条件检索。" : "");
  const showFinding = Boolean(failure || emptyKind === "down" || (emptyKind === "filtered" && !visibleCount)
    || (inFlight && !run));
  const lastHeartbeat = contract?.diagnostics.last_heartbeat;
  const showHeartbeat = Boolean(lastHeartbeat && !Number.isNaN(Date.parse(lastHeartbeat)));

  return (
    <section className={`discovery-ai-summary is-${tone}`} data-discovery-ai-summary
      data-discovery-summary-state={tone} aria-label="AI 发现摘要">
      <div className="discovery-ai-summary-line">
        <span className="discovery-ai-summary-kicker" data-discovery-run-status-label>{status}</span>
        <h2 data-discovery-headline>{headline}</h2>
        <span className="discovery-ai-summary-counts" data-discovery-counts>{counts}</span>
        {showHeartbeat && lastHeartbeat ? (
          <time className="discovery-ai-summary-time" data-discovery-last-updated
            dateTime={lastHeartbeat}>
            最近更新：{new Date(lastHeartbeat).toLocaleString("zh-CN", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
          </time>
        ) : null}
        {run?.memory_validity === "stale" ? <span data-discovery-memory-validity="stale">来源已变化</span> : null}
      </div>
      {showFinding ? <p data-discovery-primary-finding>{finding}</p> : null}
      {contract?.diagnostics.error_code ? (
        <details data-discovery-diagnostics><summary>查看任务详情</summary>
          <p>错误代码：{contract.diagnostics.error_code}{contract.diagnostics.request_id ? `；请求编号：${contract.diagnostics.request_id}` : ""}</p>
        </details>
      ) : null}
      {emptyKind === "down" && !failure ? (
        <dl className="discovery-ai-summary-facts" data-discovery-service-state>
          <div><dt>任务状态</dt><dd>未启动</dd></div>
          <div><dt>采集与筛选</dt><dd>尚未开始</dd></div>
          <div><dt>输入条件</dt><dd>已保留</dd></div>
        </dl>
      ) : null}
      {failure ? (
        <div className="discovery-ai-summary-actions" data-discovery-failure-actions>
          {onRetry ? <button type="button" className="btn ghost sm" data-discovery-retry
            data-home-entry="retry-discovery-run" disabled={retryBusy || failure.retryDisabled} onClick={onRetry}>
            {retryBusy ? "重试中…" : failure.retryLabel || "重试"}
          </button> : null}
          <details className="discovery-error-details" data-discovery-error-details>
            <summary aria-label="展开技术错误详情" data-discovery-error-details-toggle>
              <span className="sr-only">展开技术错误详情</span>
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5 7 5 5 5-5" /></svg>
            </summary>
            <div className="discovery-error-details-body">
              <p data-discovery-error-detail>{`生成服务结束状态：${run?.status === "rank_failed" ? "failed" : run?.status || "failed"}；${failure.detail || "未返回更多技术错误详情。"}`}</p>
              {failure.checkConnection && onCheckConnection ? <button type="button" className="btn ghost sm" data-discovery-check-connection onClick={onCheckConnection}>检查采集服务</button> : null}
              {connection ? <p data-discovery-connection={connection.status}>{`采集服务：${connection.label}${connection.message && connection.message !== connection.label ? ` · ${connection.message}` : ""}`}</p> : null}
            </div>
          </details>
        </div>
      ) : null}
      {emptyKind === "down" && !failure ? (
        <div className="discovery-ai-summary-actions" data-discovery-service-actions>
          {onRetry ? <button type="button" className="btn work sm" data-discovery-retry
            data-home-entry="retry-discovery-run" disabled={retryBusy} onClick={onRetry}>{retryBusy ? "重试中…" : "重新尝试"}</button> : null}
          {onCheckConnection ? <button type="button" className="btn ghost sm" data-discovery-check-connection onClick={onCheckConnection}>检查服务</button> : null}
        </div>
      ) : null}
    </section>
  );
}
