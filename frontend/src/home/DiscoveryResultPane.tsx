import { Link } from "react-router-dom";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import DiscoveryRunStatusCard from "./DiscoveryRunStatusCard";
import { platformLabel } from "./discoveryTemplate";
import { runCountsLabel, runHeadline } from "./discoveryHome";
import type { DiscoveryState } from "./useDiscovery";

/**
 * 右栏 = Codex 结果区：运行状态（成功页 / 失败页）、结果摘要、线索明细，
 * 以及入库公海的 L3 确认与各种终态提示。状态由 useDiscovery 提供，这里不发请求。
 * 跑批中也要有状态（真实等待必须有原因与状态，DESIGN §不变量 3），所以状态卡
 * 跟着 run 走，而不是跟着结果条数走。
 */
export default function DiscoveryResultPane({ state }: { state: DiscoveryState }) {
  const {
    run,
    runId,
    runHistory,
    historyLoading,
    selectRun,
    visible,
    selected,
    selectedIds,
    selectedPlatforms,
    inFlight,
    stage,
    failure,
    emptyKind,
    emptyMessage,
    connection,
    retryBusy,
    retryRun,
    checkCollector,
    toggleSelected,
    selectAll,
    expandedIds,
    toggleExpanded,
    ignoreCandidate,
    ingestOpen,
    ingestBusy,
    ingestError,
    pendingConfirm,
    approvalState,
    ingestMissing,
    toast,
    openIngest,
    confirmIngest,
    cancelIngest,
  } = state;
  const showResults = visible.length > 0;

  return (
    <div
      className="discovery-panel"
      data-discovery-panel
      data-discovery-live="false"
      data-discovery-stage={stage}
      data-discovery-running={inFlight ? "true" : undefined}
    >
      {failure ? (
        <section className="task-empty discovery-error" data-discovery-error role="alert">
          <strong>{failure.title}</strong>
          <p data-discovery-error-message>{failure.message}</p>
          {failure.detail ? <p data-discovery-error-detail>{failure.detail}</p> : null}
          {runId ? (
            <div className="discovery-error-actions">
              <button
                type="button"
                className="btn ghost sm"
                data-discovery-retry
                data-home-entry="retry-discovery-run"
                disabled={retryBusy || (!runId && failure.retryDisabled)}
                onClick={() => void retryRun()}
              >
                {failure.retryLabel}
              </button>
              {failure.checkConnection ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  data-discovery-check-connection
                  onClick={() => void checkCollector()}
                >
                  检查采集服务
                </button>
              ) : null}
            </div>
          ) : null}
          {connection ? (
            <p data-discovery-connection={connection.status}>
              {`采集服务：${connection.label}${connection.message && connection.message !== connection.label ? ` · ${connection.message}` : ""}`}
            </p>
          ) : null}
        </section>
      ) : null}

      {approvalState === "brief_mismatch" ? (
        <section className="task-empty" data-discovery-brief-mismatch role="alert">
          <strong>确认已作废</strong>
          <p>发现 Brief 已变化，原确认作废。请按当前 Brief 重新确认入库。不会建联，也不会领取跟进。</p>
        </section>
      ) : approvalState === "cancelled" ? (
        <section className="task-empty" data-discovery-ingest-cancelled role="status">
          <strong>已取消入库</strong>
          <p>该确认已取消，未写入达人库。不会建联，也不会领取跟进。</p>
        </section>
      ) : approvalState ? (
        <section className="task-empty" data-discovery-approval={approvalState} role="status">
          <strong>待审批</strong>
          <p>入库已提交，正在等待审批。审批链由服务端返回，前端不自行推算。</p>
        </section>
      ) : null}

      {ingestMissing ? (
        <div className="task-empty" data-discovery-empty="ingest-missing">
          <strong>入库接口尚未提供</strong>
          <p>不会建联，不会发信，也不会领取跟进。可稍后重试。</p>
        </div>
      ) : null}

      {run ? <DiscoveryRunStatusCard run={run} shortlistFallback={visible.length} /> : null}

      {run ? (
        <header className="discovery-result-head">
          <p className="discovery-result-context">{runHistory[0]?.id === run.id ? "当前最新结果" : "历史运行结果"}</p>
          <h2 data-discovery-headline>{runHeadline(run)}</h2>
          <p data-discovery-counts>{runCountsLabel(run, visible.length)}</p>
        </header>
      ) : null}

      {runHistory.length > 1 ? (
        <details className="discovery-history">
          <summary>历史发现 <span>{runHistory.length - 1}</span></summary>
          <label className="discovery-history-picker">
            <span>查看其他运行</span>
            <select value={run?.id || ""} disabled={historyLoading} aria-busy={historyLoading} onChange={(event) => void selectRun(event.target.value)}>
              {runHistory.map((item) => (
                <option key={item.id} value={item.id}>
                  {`${item.headline || "发现运行"} · ${item.created_at || item.started_at || item.id}`}
                </option>
              ))}
            </select>
          </label>
        </details>
      ) : null}

      {showResults ? (
        <>
          <div
            className={"discovery-run-bar" + (selected.length ? " is-selecting" : "")}
            data-discovery-run-bar
          >
            <span className="discovery-run-count" data-discovery-candidate-count>
              {`候选 ${visible.length} 位`}
            </span>
            <span className="discovery-run-sort" data-discovery-sort-note>按推荐分与匹配度排序</span>
            <label className="discovery-candidate-select">
              <input
                type="checkbox"
                data-discovery-select-all
                checked={visible.length > 0 && selected.length === visible.length}
                onChange={(event) => selectAll(event.target.checked)}
              />
              <span>{`已选 ${selected.length} 人`}</span>
            </label>
            <button
              type="button"
              className="btn work sm"
              data-discovery-ingest
              data-home-entry="discovery-ingest"
              disabled={!selected.length}
              onClick={openIngest}
            >
              {selected.length ? `入库公海（${selected.length}）` : "入库公海"}
            </button>
          </div>
          <ol className="discovery-candidate-list" data-discovery-candidates>
            {visible.map((candidate) => (
              <li key={candidate.id}>
                <DiscoveryLeadRow
                  candidate={candidate}
                  selected={selectedIds.includes(candidate.id)}
                  expanded={expandedIds.includes(candidate.id)}
                  onToggleSelect={(on) => toggleSelected(candidate.id, on)}
                  onToggleExpand={() => toggleExpanded(candidate.id)}
                  onIgnore={() => ignoreCandidate(candidate.id)}
                />
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {toast ? (
        <p className="discovery-toast" data-discovery-toast role="status">
          <Link to="/?tab=pool" data-discovery-pool-link>{toast}</Link>
        </p>
      ) : null}

      {/* 空态：服务不可用 / 筛选无结果。idle 不占位（没有 run 时结果区为空）。 */}
      {!inFlight && !showResults && !failure && emptyKind !== "idle" ? (
        <div className="task-empty" data-discovery-empty={emptyKind}>
          <strong>{emptyKind === "down" ? "服务不可用" : "筛选无结果"}</strong>
          <p>{emptyMessage}</p>
        </div>
      ) : null}
      {!run && !inFlight && !failure && emptyKind === "idle" ? (
        <div className="task-empty" data-discovery-empty="no-history">
          <strong>暂无发现结果</strong>
          <p>完成中栏的筛选条件并提交后，结果会显示在这里。历史运行会保留在此处供切换查看。</p>
        </div>
      ) : null}

      <DiscoveryIngestConfirm
        open={ingestOpen}
        busy={ingestBusy}
        error={ingestError}
        confirmDisabled={!selected.length}
        onConfirm={() => void confirmIngest()}
        onCancel={() => void cancelIngest()}
      >
        <p data-discovery-ingest-summary>
          {`将把 ${selected.length} 条线索写入 Starry 并进入公海。`}
          {` 平台：${selectedPlatforms.length ? selectedPlatforms.map((code) => platformLabel(code)).join("、") : "无"}。`}
          {` 来源运行：${run?.id || runId || "无"}。`}
          不会建联，不会发信，也不会改阶段或认领跟进。
        </p>
      </DiscoveryIngestConfirm>
    </div>
  );
}
