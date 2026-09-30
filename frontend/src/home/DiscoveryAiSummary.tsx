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

function primaryFinding(input: {
  run: HomeDiscoveryRun | null;
  visibleCount: number;
  inFlight: boolean;
  failure: FailureView;
  emptyKind: HomeDiscoveryEmptyKind;
  emptyMessage: string;
}): string {
  if (input.failure) {
    return input.failure.kind === "generic" ? "检索没有完成，可稍后重试。" : input.failure.message;
  }
  if (input.emptyKind === "down") {
    return "发现服务当前不可用，本次任务尚未启动，因此没有采集、筛选或排序结果。已有输入会保留，可稍后重试。";
  }
  if (input.inFlight) return "AI 正在按已确认的条件检索、去重并排序；完成后结果会自动出现。";
  if (input.visibleCount > 0) return `已得到 ${input.visibleCount} 条可复核线索，可查看匹配依据后再选择入库。`;
  if (input.run && input.emptyKind === "filtered") return input.emptyMessage;
  return "填写条件并提交后，AI 会在这里汇总发现结果与下一步建议。";
}

/**
 * Right-rail decision summary. It reuses the real discovery run state instead
 * of asking the model to invent a conclusion, so the first screen remains
 * concise and traceable in every run state.
 */
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
  const progress = contract?.progress;
  const snapshot = contract?.condition_snapshot || {};
  const snapshotText = [
    Array.isArray(snapshot.keywords) && snapshot.keywords.length ? `关键词：${snapshot.keywords.join("、")}` : null,
    snapshot.region ? `地区：${String(snapshot.region)}` : null,
    snapshot.min_followers != null || snapshot.max_followers != null
      ? `粉丝：${snapshot.min_followers ?? "不限"}–${snapshot.max_followers ?? "不限"}` : null,
  ].filter(Boolean).join("｜");
  const progressLabel = (value: number | null | undefined) => value == null
    ? (contract?.execution_started ? "暂无数据" : "尚未开始")
    : String(value);
  const status = failure
    ? "需要处理"
    : inFlight
      ? "检索中"
      : run
        ? discoveryRunStatusLabel(run)
        : emptyKind === "down"
          ? "服务不可用"
          : "等待发现";
  const headline = failure?.title || contract?.title || (
    run
      ? runHeadline(run)
      : emptyKind === "down"
        ? "暂时无法开始发现红人"
        : inFlight
          ? "正在发现红人线索"
          : "准备发现红人线索"
  );
  const counts = run
    ? runCountsLabel(run, visibleCount)
    : visibleCount
      ? `入围 ${visibleCount}`
      : emptyKind === "down"
        ? "检索尚未开始"
        : "尚未开始";
  const tone = failure || emptyKind === "down" ? "warning" : inFlight ? "running" : visibleCount ? "ready" : "idle";

  return (
    <section
      className={`discovery-ai-summary is-${tone}`}
      data-discovery-ai-summary
      data-discovery-summary-state={tone}
      aria-label="AI 发现摘要"
    >
      <div className="discovery-ai-summary-head">
        <span className="discovery-ai-summary-kicker" data-discovery-run-status-label>{status}</span>
        <h2 data-discovery-headline>{headline}</h2>
      </div>
      <div className="discovery-ai-summary-meta">
        <span data-discovery-counts>{counts}</span>
        {run?.memory_validity === "stale" ? <span data-discovery-memory-validity="stale">来源已变化</span> : null}
      </div>
      <p data-discovery-primary-finding>{failure ? primaryFinding({ run, visibleCount, inFlight, failure, emptyKind, emptyMessage }) : contract?.message || primaryFinding({ run, visibleCount, inFlight, failure, emptyKind, emptyMessage })}</p>
      {contract ? (
        <div className="discovery-ai-summary-contract" data-discovery-status-contract>
          <div className="discovery-ai-summary-progress" data-discovery-progress>
            {([ ["已采集", progress?.collected], ["已解析", progress?.parsed], ["已去重", progress?.deduplicated], ["匹配结果", progress?.matched] ] as const).map(([label, value]) => (
              <span key={label}><b>{label}</b><em>{progressLabel(value)}</em></span>
            ))}
          </div>
          {snapshotText ? <p className="discovery-ai-summary-snapshot" data-discovery-condition-snapshot><b>本次任务条件</b>{snapshotText}</p> : null}
          <p className="discovery-ai-summary-freshness" data-discovery-last-updated>
            最近更新：{contract.diagnostics.last_heartbeat ? new Date(contract.diagnostics.last_heartbeat).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "无"}
          </p>
          {contract.diagnostics.error_code ? <details data-discovery-diagnostics><summary>查看任务详情</summary><p>错误代码：{contract.diagnostics.error_code}{contract.diagnostics.request_id ? `；请求编号：${contract.diagnostics.request_id}` : ""}</p></details> : null}
        </div>
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
          {onRetry ? (
            <button
              type="button"
              className="btn ghost sm"
              data-discovery-retry
              data-home-entry="retry-discovery-run"
              disabled={retryBusy || failure.retryDisabled}
              onClick={onRetry}
            >
              {retryBusy ? "重试中…" : failure.retryLabel || "重试"}
            </button>
          ) : null}
          <details className="discovery-error-details" data-discovery-error-details>
            <summary aria-label="展开技术错误详情" data-discovery-error-details-toggle>
              <span className="sr-only">展开技术错误详情</span>
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5 7 5 5 5-5" /></svg>
            </summary>
            <div className="discovery-error-details-body">
              <p data-discovery-error-detail>
                {`生成服务结束状态：${run?.status === "rank_failed" ? "failed" : run?.status || "failed"}；${failure.detail || "未返回更多技术错误详情。"}`}
              </p>
              {failure.checkConnection && onCheckConnection ? (
                <button type="button" className="btn ghost sm" data-discovery-check-connection onClick={onCheckConnection}>
                  检查采集服务
                </button>
              ) : null}
              {connection ? (
                <p data-discovery-connection={connection.status}>
                  {`采集服务：${connection.label}${connection.message && connection.message !== connection.label ? ` · ${connection.message}` : ""}`}
                </p>
              ) : null}
            </div>
          </details>
        </div>
      ) : null}
      {emptyKind === "down" && !failure ? (
        <div className="discovery-ai-summary-actions" data-discovery-service-actions>
          {onRetry ? (
            <button type="button" className="btn work sm" data-discovery-retry data-home-entry="retry-discovery-run" disabled={retryBusy} onClick={onRetry}>
              {retryBusy ? "重试中…" : "重新尝试"}
            </button>
          ) : null}
          {onCheckConnection ? (
            <button type="button" className="btn ghost sm" data-discovery-check-connection onClick={onCheckConnection}>
              检查服务
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
