import { Link } from "react-router-dom";
import DiscoveryAiSummary from "./DiscoveryAiSummary";
import { DiscoveryIngestConfirm } from "./DiscoveryIngestConfirm";
import DiscoveryLeadRow from "./DiscoveryLeadRow";
import DiscoveryNextPlan from "./DiscoveryNextPlan";
import { platformLabel } from "./discoveryTemplate";
import type { DiscoveryState } from "./useDiscovery";

/**
 * Right rail: a compact decision sequence — AI summary, result details, then
 * the next plan. It consumes useDiscovery state only; reads, polling, writes,
 * and L3 confirmation all remain in the hook and existing confirmation flow.
 */
export default function DiscoveryResultPane({ state }: { state: DiscoveryState }) {
  const {
    run,
    runId,
    runHistory,
    historyLoading,
    selectRun,
    available,
    visible,
    resultFilter,
    setResultFilter,
    selected,
    selectableVisible,
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
    ingestReceipt,
    openIngest,
    confirmIngest,
    cancelIngest,
    showCard,
  } = state;
  const showResults = available.length > 0;
  const selecting = selected.length > 0;
  const readyCount = available.filter((candidate) => candidate.ingestReadiness === "ready").length;
  const reviewCount = available.filter((candidate) => candidate.ingestReadiness === "needs_review").length;
  const existingCount = available.filter((candidate) => (
    candidate.ingestReadiness === "already_in_library" || candidate.ingestReadiness === "already_followed"
  )).length;
  const blockedCount = available.filter((candidate) => candidate.ingestReadiness === "needs_contact").length;
  const reviewSelected = selected.filter((candidate) => candidate.ingestReadiness === "needs_review").length;
  const allSelectableShown = selectableVisible.length > 0
    && selectableVisible.every((candidate) => selectedIds.includes(candidate.id));

  return (
    <div
      className="discovery-panel"
      data-discovery-panel
      data-discovery-live="false"
      data-discovery-stage={stage}
      data-discovery-running={inFlight ? "true" : undefined}
    >
      <DiscoveryAiSummary
        run={run}
        visibleCount={visible.length}
        inFlight={inFlight}
        failure={failure}
        emptyKind={emptyKind}
        emptyMessage={emptyMessage}
      />

      {available.length ? (
        <section className="discovery-conversion-overview" data-discovery-conversion-overview aria-label="线索转化概览">
          <div>
            <h3>转化概览</h3>
            <p>以下为采集与评分的只读预检；正式写入仍需在 L3 确认后由 Starry 网关复核。</p>
          </div>
          <dl>
            <div data-discovery-conversion-count="ready"><dt>可入库</dt><dd>{readyCount}</dd></div>
            <div data-discovery-conversion-count="review"><dt>待复核</dt><dd>{reviewCount}</dd></div>
            <div data-discovery-conversion-count="blocked"><dt>待补资料</dt><dd>{blockedCount}</dd></div>
            <div data-discovery-conversion-count="existing"><dt>已在 Starry</dt><dd>{existingCount}</dd></div>
          </dl>
        </section>
      ) : null}

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
        <section className="discovery-result-detail" aria-label="结果明细">
          <header className="discovery-result-detail-head">
            <div>
              <h3>结果明细</h3>
              <p className="discovery-run-count" data-discovery-candidate-count>
                {`显示 ${visible.length}/${available.length} 位 · 按推荐分与匹配度排序`}
              </p>
            </div>
            {!selecting ? <p className="discovery-selection-hint">优先复核证据，再选择可入库线索</p> : null}
          </header>

          <div className={"discovery-result-filters" + (resultFilter !== "all" ? " is-filtered" : "")} data-discovery-result-filters>
            {[
              ["all", `全部 ${available.length}`],
              ["ready", `可入库 ${readyCount}`],
              ["review", `待复核 ${reviewCount}`],
              ["blocked", `待补资料 ${blockedCount}`],
              ["existing", `已在 Starry ${existingCount}`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="discovery-filter-chip"
                aria-pressed={resultFilter === key}
                data-discovery-result-filter={key}
                onClick={() => setResultFilter(key as typeof resultFilter)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={"discovery-run-bar" + (selecting ? " is-selecting" : "")} data-discovery-run-bar>
            <span className="discovery-run-count" data-discovery-selected-count>{`已选 ${selected.length} 人`}</span>
            <label className="discovery-candidate-select">
              <input
                type="checkbox"
                data-discovery-select-all
                checked={allSelectableShown}
                disabled={!selectableVisible.length}
                onChange={(event) => selectAll(event.target.checked)}
              />
              <span>全选当前结果</span>
            </label>
            <button
              type="button"
              className="btn work sm"
              data-discovery-ingest
              data-home-entry="discovery-ingest"
              disabled={!selecting}
              onClick={openIngest}
            >
              {`入库公海（${selected.length}）`}
            </button>
          </div>

          {visible.length ? (
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
          ) : (
            <div className="task-empty discovery-filter-empty" data-discovery-filter-empty={resultFilter}>
              <strong>当前筛选没有线索</strong>
              <p>可切换到“全部”查看本次采集到的其他候选与其转化状态。</p>
            </div>
          )}
        </section>
      ) : null}

      {ingestReceipt ? (
        <section className="discovery-ingest-receipt" data-discovery-ingest-receipt role="status">
          <strong>Starry 入库回执</strong>
          <p>{`本次已写入 ${ingestReceipt.ingested.length} 位${ingestReceipt.failed.length ? `，${ingestReceipt.failed.length} 位未写入` : ""}。`}</p>
          {ingestReceipt.failed.length ? (
            <ul>
              {ingestReceipt.failed.map((item) => <li key={item.id}>{item.message || item.handle || item.id}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {toast ? (
        <p className="discovery-toast" data-discovery-toast role="status">
          <Link to="/?tab=pool" data-discovery-pool-link>{toast}</Link>
        </p>
      ) : null}

      {!inFlight && !showResults && !failure && emptyKind !== "idle" ? (
        <div className="task-empty" data-discovery-empty={emptyKind}>
          <strong>{emptyKind === "down" ? "服务不可用" : "筛选无结果"}</strong>
          <p>{emptyMessage}</p>
        </div>
      ) : null}

      <DiscoveryNextPlan
        run={run}
        visibleCount={visible.length}
        selectedCount={selected.length}
        inFlight={inFlight}
        failure={failure}
        emptyKind={emptyKind}
        runHistoryCount={runHistory.length}
        onEditConditions={showCard}
        onRetry={() => void retryRun()}
        onCheckConnection={() => void checkCollector()}
        onOpenIngest={openIngest}
      />

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
          {reviewSelected ? ` 其中 ${reviewSelected} 条仍需人工复核其评分与来源证据。` : ""}
          不会建联，不会发信，也不会改阶段或认领跟进。
        </p>
      </DiscoveryIngestConfirm>
    </div>
  );
}
